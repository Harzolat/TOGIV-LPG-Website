import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { generateOpaqueToken, hashToken } from "../common/tokens";
import { MailerService } from "./mailer.service";
import {
  generateTemporaryPassword,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "./password";
import { SessionService } from "./session.service";
import {
  applyStaffAuthenticatorReset,
  applyStaffPasswordReset,
} from "./staff-recovery";

/**
 * Account recovery orchestration.
 *
 * - Self-service password reset: user requests reset by email, receives a
 *   one-time token (delivered out-of-band; in non-production the token is
 *   logged and may be returned for local use), and redeems it to set a new
 *   password. Responses never reveal whether an account exists.
 * - Operator-authorized flows (legacy/admin-assisted) remain available for
 *   console/break-glass support where applicable.
 */

export const PIN_RESET_TTL_MS = 30 * 60_000;
export const STAFF_PASSWORD_RESET_TTL_MS = 30 * 60_000;
export const SELF_SERVICE_PASSWORD_RESET_TTL_MS = 30 * 60_000;

export type PinResetStatus = "pending" | "completed" | "expired" | "revoked";
export type StaffPasswordResetStatus = PinResetStatus;

export interface PinResetRowStatus {
  consumedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

export function pinResetStatus(
  row: PinResetRowStatus,
  now = Date.now(),
): PinResetStatus {
  if (row.consumedAt) return "completed";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now) return "expired";
  return "pending";
}

export const staffPasswordResetStatus = pinResetStatus;

const INVALID_TOKEN =
  "This reset token is not valid. Request a new password reset and try again.";
const USED_TOKEN =
  "This reset token has already been used. Request a new password reset and try again.";
const EXPIRED_TOKEN =
  "This reset token has expired. Request a new password reset and try again.";

const DEFAULT_COMPANY = "Throne of Grace Integrated Ventures";

export interface RecoveryContact {
  company: string;
  phones: string[];
  hours: string | null;
}

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: SessionService,
    private readonly mailer?: MailerService,
  ) {}

  // ── Self-service password reset (email + token link) ──────────────

  private resetLink(token: string, kind: "customer" | "staff"): string {
    const base =
      kind === "customer"
        ? (process.env.CUSTOMER_APP_URL ?? process.env.WEB_APP_URL ?? "http://localhost:5175").replace(/\/$/, "")
        : (process.env.ADMIN_APP_URL ?? "http://localhost:5176").replace(/\/$/, "");
    const path = kind === "customer" ? "/reset-password" : "/reset-password";
    return `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  private async sendPasswordResetEmail(
    email: string,
    token: string,
    kind: "customer" | "staff",
  ): Promise<void> {
    const link = this.resetLink(token, kind);
    const appLabel = kind === "customer" ? "Throne of Grace LPG" : "Throne of Grace Admin";
    const subject = `${appLabel} password reset`;
    const text = [
      `You requested a password reset for your ${appLabel} account.`,
      "",
      "Use the link below to set a new password (valid for a limited time, one-time use):",
      link,
      "",
      "If you did not request this, you can ignore this message.",
    ].join("\n");
    const html = `<p>You requested a password reset for your <strong>${appLabel}</strong> account.</p>
<p><a href="${link}">Reset your password</a></p>
<p style="font-size:12px;color:#666">Or copy this link: ${link}</p>
<p style="font-size:12px;color:#666">This link is valid for a limited time and can be used once. If you did not request this, you can ignore this message.</p>`;
    if (!this.mailer) {
      this.logger.warn(`[DEV] Password reset link for ${kind} ${email}: ${link}`);
      return;
    }
    await this.mailer.send({ to: email, subject, text, html });
    this.logger.log(`Password reset email dispatched for ${kind} account (${email}).`);
  }

  async requestSelfServicePasswordReset(
    rawEmail: string,
    kind: "customer" | "staff",
    ip?: string,
  ) {
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      return { ok: true as const };
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        kind,
        deletedAt: null,
        status: "active",
      },
      select: { id: true, email: true },
    });

    if (!user) {
      // No enumeration.
      return { ok: true as const };
    }

    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + SELF_SERVICE_PASSWORD_RESET_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Invalidate previous unused tokens for this user.
      await tx.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
          ip: ip ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action:
            kind === "customer"
              ? "customer.password_reset_requested"
              : "staff.password_reset_requested",
          entityType: "user",
          entityId: user.id,
          ip: ip ?? null,
          after: { expiresAt: expiresAt.toISOString(), selfService: true },
        },
      });
    });

    if (this.mailer) {
      await this.sendPasswordResetEmail(user.email ?? email, rawToken, kind);
    } else {
      this.logger.warn(
        `[DEV] Password reset link for ${kind} ${user.email ?? email}: ${this.resetLink(rawToken, kind)}`,
      );
    }

    return { ok: true as const };
  }

  async consumeSelfServicePasswordReset(
    rawToken: string,
    newPassword: string,
    kind: "customer" | "staff",
    ip?: string,
  ) {
    const strength = validatePasswordStrength(newPassword);
    if (strength) throw new BadRequestException(strength);

    const newHash = await hashPassword(newPassword);

    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        user: {
          select: {
            id: true,
            kind: true,
            status: true,
            deletedAt: true,
            customerProfile: { select: { id: true } },
          },
        },
      },
    });

    if (!row) throw new BadRequestException(INVALID_TOKEN);
    if (row.consumedAt) throw new BadRequestException(USED_TOKEN);
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(EXPIRED_TOKEN);
    }
    if (
      row.user.deletedAt ||
      row.user.kind !== kind ||
      row.user.status !== "active"
    ) {
      throw new ForbiddenException(
        "Account unavailable. Please contact support.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException(USED_TOKEN);

      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: newHash },
      });
      await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: row.userId,
          action:
            kind === "customer"
              ? "customer.password_reset_completed"
              : "staff.password_reset_completed",
          entityType: kind === "customer" ? "customer" : "user",
          entityId:
            kind === "customer"
              ? (row.user.customerProfile?.id ?? row.userId)
              : row.userId,
          ip: ip ?? null,
          after: { tokenId: row.id, selfService: true, sessionsRevoked: true },
        },
      });
    });

    return { ok: true as const };
  }

  // ── Customer PIN reset ─────────────────────────────────────────────

  /** Staff-authorized issuance. Returns the raw token exactly once. */
  async authorizePinReset(
    customerId: string,
    actorUserId: string,
    ip?: string,
    note?: string,
  ) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            kind: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });
    if (
      !customer ||
      customer.user.deletedAt ||
      customer.user.kind !== "customer"
    ) {
      throw new NotFoundException("Customer not found.");
    }
    if (customer.user.status !== "active") {
      throw new BadRequestException(
        "This customer account is not active. Restore it before issuing a PIN reset.",
      );
    }

    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + PIN_RESET_TTL_MS);

    const created = await this.prisma.$transaction(async (tx) => {
      // Only the newest authorization can be redeemed.
      await tx.pinResetToken.updateMany({
        where: {
          userId: customer.user.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });

      const row = await tx.pinResetToken.create({
        data: {
          userId: customer.user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
          createdBy: actorUserId,
          ip: ip ?? null,
          note: note?.trim() || null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: "customer.pin_reset_authorized",
          entityType: "customer",
          entityId: customer.id,
          ip: ip ?? null,
          after: {
            tokenId: row.id,
            expiresAt: expiresAt.toISOString(),
            note: note?.trim() || null,
          },
        },
      });

      return row;
    });

    return {
      id: created.id,
      token: rawToken,
      expiresAt,
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.user.phone,
      },
    };
  }

  /** Recent authorizations for the console (never includes token hashes). */
  async listPinResets(limit = 50) {
    const rows = await this.prisma.pinResetToken.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        user: {
          select: {
            phone: true,
            customerProfile: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    const actorIds = [
      ...new Set(
        rows.map((r) => r.createdBy).filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, staffProfile: { select: { fullName: true } } },
        })
      : [];
    const actorName = new Map(
      actors.map((a) => [a.id, a.staffProfile?.fullName ?? null]),
    );

    return rows.map((row) => ({
      id: row.id,
      status: pinResetStatus(row),
      customerId: row.user.customerProfile?.id ?? null,
      customerName: row.user.customerProfile?.fullName ?? null,
      customerPhone: row.user.phone,
      createdBy: row.createdBy,
      createdByName: row.createdBy
        ? (actorName.get(row.createdBy) ?? null)
        : null,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async revokePinReset(id: string, actorUserId: string) {
    const row = await this.prisma.pinResetToken.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Reset authorization not found.");
    if (row.consumedAt) {
      throw new BadRequestException("This reset has already been completed.");
    }

    if (!row.revokedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.pinResetToken.update({
          where: { id },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorId: actorUserId,
            action: "customer.pin_reset_revoked",
            entityType: "customer",
            entityId: row.userId,
            after: { tokenId: row.id },
          },
        });
      });
    }

    return { ok: true };
  }

  /**
   * Redeem a PIN reset token. Timing is kept uniform by hashing the new PIN
   * before the token lookup, so an invalid token costs the same as a valid
   * one. Single-use is enforced atomically (`consumedAt: null` guard).
   */
  async consumePinReset(rawToken: string, newPin: string, ip?: string) {
    const pinHash = await hashPassword(newPin);

    const row = await this.prisma.pinResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            customerProfile: { select: { id: true } },
          },
        },
      },
    });

    if (!row) throw new BadRequestException(INVALID_TOKEN);
    if (row.consumedAt) throw new BadRequestException(USED_TOKEN);
    if (row.revokedAt) throw new BadRequestException(INVALID_TOKEN);
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(EXPIRED_TOKEN);
    }
    if (row.user.deletedAt || row.user.status !== "active") {
      throw new ForbiddenException(
        "Account unavailable. Please contact Throne of Grace.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.pinResetToken.updateMany({
        where: { id: row.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException(USED_TOKEN);

      const updated = await tx.user.updateMany({
        where: {
          id: row.userId,
          kind: "customer",
          status: "active",
          deletedAt: null,
        },
        data: { passwordHash: pinHash },
      });

      if (updated.count !== 1) {
        throw new ForbiddenException(
          "Account unavailable. Please contact Throne of Grace.",
        );
      }
      await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: row.userId,
          action: "customer.pin_reset_completed",
          entityType: "customer",
          entityId: row.user.customerProfile?.id ?? row.userId,
          ip: ip ?? null,
          after: { tokenId: row.id },
        },
      });
    });

    return { ok: true as const };
  }

  // ── Staff password / authenticator recovery ────────────────────────

  resetStaffPassword(staffId: string, actorUserId: string) {
    return applyStaffPasswordReset(
      this.prisma,
      staffId,
      actorUserId,
      "console",
    );
  }

  resetStaffAuthenticator(staffId: string, actorUserId: string) {
    return applyStaffAuthenticatorReset(
      this.prisma,
      staffId,
      actorUserId,
      "console",
    );
  }

  /**
   * Operator-authorized staff password reset token issuance (manual identity
   * verification). Returns the raw token exactly once. The token can be
   * redeemed by the staff member to set a new password; TOTP remains enrolled.
   */
  async authorizeStaffPasswordReset(
    staffId: string,
    actorUserId: string,
    ip?: string,
    note?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: staffId },
      include: { staffProfile: { select: { fullName: true } } },
    });
    if (!user || user.kind !== "staff" || user.deletedAt) {
      throw new NotFoundException("Staff account not found.");
    }
    if (user.status !== "active") {
      throw new BadRequestException(
        "This staff account is not active. Restore it before issuing a password reset.",
      );
    }

    const rawToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + STAFF_PASSWORD_RESET_TTL_MS);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.staffPasswordResetToken.updateMany({
        where: {
          userId: user.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });

      const row = await tx.staffPasswordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
          createdBy: actorUserId,
          ip: ip ?? null,
          note: note?.trim() || null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: "staff.password_reset_token_authorized",
          entityType: "user",
          entityId: user.id,
          ip: ip ?? null,
          after: {
            tokenId: row.id,
            expiresAt: expiresAt.toISOString(),
            note: note?.trim() || null,
            totpPreserved: Boolean(user.staffProfile),
          },
        },
      });

      return row;
    });

    return {
      id: created.id,
      token: rawToken,
      expiresAt,
      staff: {
        id: user.id,
        fullName: user.staffProfile?.fullName ?? "—",
        email: user.email ?? null,
        phone: user.phone,
      },
    };
  }

  /** Recent staff password reset authorizations (never includes token hashes). */
  async listStaffPasswordResets(limit = 50) {
    const rows = await this.prisma.staffPasswordResetToken.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            staffProfile: { select: { fullName: true } },
          },
        },
      },
    });

    const actorIds = [
      ...new Set(
        rows.map((r) => r.createdBy).filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, staffProfile: { select: { fullName: true } } },
        })
      : [];
    const actorName = new Map(
      actors.map((a) => [a.id, a.staffProfile?.fullName ?? null]),
    );

    return rows.map((row) => ({
      id: row.id,
      status: staffPasswordResetStatus(row),
      staffId: row.user.id,
      staffName: row.user.staffProfile?.fullName ?? null,
      staffIdentifier: row.user.email ?? row.user.phone,
      createdBy: row.createdBy,
      createdByName: row.createdBy
        ? (actorName.get(row.createdBy) ?? null)
        : null,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async revokeStaffPasswordReset(id: string, actorUserId: string) {
    const row = await this.prisma.staffPasswordResetToken.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Reset authorization not found.");
    if (row.consumedAt) {
      throw new BadRequestException("This reset has already been completed.");
    }

    if (!row.revokedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.staffPasswordResetToken.update({
          where: { id },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorId: actorUserId,
            action: "staff.password_reset_token_revoked",
            entityType: "user",
            entityId: row.userId,
            after: { tokenId: row.id },
          },
        });
      });
    }

    return { ok: true };
  }

  /**
   * Redeem a staff password reset token. Sets a new password chosen by the
   * staff member and revokes all sessions. TOTP enrollment is preserved so the
   * authenticator remains required at sign-in.
   */
  async consumeStaffPasswordReset(
    rawToken: string,
    newPassword: string,
    ip?: string,
  ) {
    const strength = validatePasswordStrength(newPassword);
    if (strength) throw new BadRequestException(strength);

    const newHash = await hashPassword(newPassword);

    const row = await this.prisma.staffPasswordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        user: {
          select: {
            id: true,
            kind: true,
            status: true,
            deletedAt: true,
            staffProfile: { select: { totpEnrolledAt: true } },
          },
        },
      },
    });

    if (!row) throw new BadRequestException(INVALID_TOKEN);
    if (row.consumedAt) throw new BadRequestException(USED_TOKEN);
    if (row.revokedAt) throw new BadRequestException(INVALID_TOKEN);
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(EXPIRED_TOKEN);
    }
    if (
      row.user.deletedAt ||
      row.user.kind !== "staff" ||
      row.user.status !== "active"
    ) {
      throw new ForbiddenException(
        "Account unavailable. Please contact Throne of Grace.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.staffPasswordResetToken.updateMany({
        where: { id: row.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException(USED_TOKEN);

      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: newHash },
      });
      await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: row.userId,
          action: "staff.password_reset_completed",
          entityType: "user",
          entityId: row.userId,
          ip: ip ?? null,
          after: {
            tokenId: row.id,
            totpPreserved: Boolean(row.user.staffProfile?.totpEnrolledAt),
            sessionsRevoked: true,
          },
        },
      });
    });

    return { ok: true as const };
  }

  /** Public/admin help guidance for staff password recovery (non-enumerating). */
  staffRecoveryRequestGuidance() {
    return {
      ok: true as const,
      message:
        "If an account exists for the email provided, a password reset link has been sent. You can also contact support for assistance if needed.",
    };
  }

  /** Authenticated self-service password change (admin console). */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionToken?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.kind !== "staff" || user.deletedAt) {
      throw new ForbiddenException("Account not found.");
    }
    if (!user.passwordHash) {
      throw new BadRequestException(
        "This account has no password yet. Ask a super administrator to reset it.",
      );
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ForbiddenException("Current password is incorrect.");
    }

    const strength = validatePasswordStrength(newPassword);
    if (strength) throw new BadRequestException(strength);
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new BadRequestException(
        "Choose a password you have not used on this account.",
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "staff.password_changed",
          entityType: "user",
          entityId: userId,
          after: { sessionsRevoked: "all_other" },
        },
      });
    });
    await this.sessions.revokeAllForUserExcept(userId, currentSessionToken);

    return { ok: true as const };
  }

  // ── Public recovery information ────────────────────────────────────

  /**
   * Business contact configuration for the recovery pages. Values come from
   * the existing `company.contact` BusinessSetting (editable without a
   * deploy), falling back to server environment variables.
   */
  async recoveryContact(): Promise<RecoveryContact> {
    const setting = await this.prisma.businessSetting.findUnique({
      where: { key: "company.contact" },
    });
    const value =
      setting && typeof setting.value === "object" && setting.value !== null
        ? (setting.value as Record<string, unknown>)
        : {};

    const pick = (key: string): string | null => {
      const raw = value[key];
      return typeof raw === "string" && raw.trim() ? raw.trim() : null;
    };

    const phones = [
      pick("phone") ?? process.env.BUSINESS_CONTACT_PHONE?.trim() ?? null,
      pick("altPhone") ??
        process.env.BUSINESS_CONTACT_PHONE_ALT?.trim() ??
        null,
    ].filter((v): v is string => Boolean(v));

    return {
      company: pick("company") ?? DEFAULT_COMPANY,
      phones,
      hours: pick("hours"),
    };
  }

  /**
   * Public recovery-intent endpoint helper. It intentionally does not read
   * or store the email and always yields the same guidance, so it cannot be
   * used to discover which emails have accounts.
   */
  recoveryRequestGuidance() {
    return {
      ok: true as const,
      message:
        "If an account exists for the email provided, a password reset link has been sent.",
    };
  }

  /** Exposed for tests / CLI reuse. */
  static temporaryPassword(): string {
    return generateTemporaryPassword();
  }
}
