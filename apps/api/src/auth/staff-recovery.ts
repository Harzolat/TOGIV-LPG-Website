import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaClient, User } from "@prisma/client";
import { normalizeNgPhone } from "../common/phone";
import { hashPassword, generateTemporaryPassword } from "./password";

/**
 * Staff account recovery primitives shared by the authenticated admin
 * console and the server-side break-glass CLI.
 *
 * Security invariants:
 * - Password recovery only replaces `passwordHash`; the TOTP secret and
 *   enrollment timestamp are never touched here. Normal sign-in therefore
 *   still requires the authenticator after recovery.
 * - Authenticator recovery is a separate operation that clears TOTP so the
 *   person re-enrolls on their next sign-in. It never changes the password.
 * - Both operations revoke every existing session for the target account.
 * - Audit rows record the action and actor, never a password/hash/secret.
 */

export type StaffRecoverySource = "console" | "break_glass";

export interface StaffRecoveryTarget {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  totpEnrolled: boolean;
}

const ACTION = {
  console: {
    password: "staff.password_reset_authorized",
    authenticator: "staff.authenticator_reset",
  },
  break_glass: {
    password: "staff.password_reset_break_glass",
    authenticator: "staff.authenticator_reset_break_glass",
  },
} as const;

export async function findStaffByIdentifier(
  prisma: PrismaClient,
  identifier: string,
): Promise<User | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const asEmail = trimmed.includes("@") ? trimmed.toLowerCase() : null;
  // Operators may type a phone the local way (0803…) while stored numbers
  // are E.164 (+234803…); accept both forms.
  const phoneVariants = new Set<string>([trimmed]);
  try {
    phoneVariants.add(normalizeNgPhone(trimmed));
  } catch {
    // Not a phone number — the email branch (if any) still applies.
  }
  return prisma.user.findFirst({
    where: {
      kind: "staff",
      deletedAt: null,
      OR: [
        ...(asEmail ? [{ email: asEmail }] : []),
        { phone: { in: [...phoneVariants] } },
      ],
    },
  });
}

async function loadTarget(
  prisma: PrismaClient,
  userId: string,
): Promise<StaffRecoveryTarget & { passwordHash: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      staffProfile: { select: { totpEnrolledAt: true, fullName: true } },
    },
  });
  if (!user || user.kind !== "staff" || user.deletedAt) {
    throw new NotFoundException("Staff account not found.");
  }
  if (user.status !== "active") {
    throw new BadRequestException(
      "This account is not active. Restore it before recovery.",
    );
  }
  return {
    id: user.id,
    email: user.email,
    phone: user.phone ?? null,
    fullName: user.staffProfile?.fullName ?? "—",
    totpEnrolled: Boolean(user.staffProfile?.totpEnrolledAt),
    passwordHash: user.passwordHash,
  };
}

/**
 * Replace a staff member's password with a random temporary one and revoke
 * their sessions. Returns the temporary password exactly once.
 */
export async function applyStaffPasswordReset(
  prisma: PrismaClient,
  userId: string,
  actorId: string | null,
  source: StaffRecoverySource,
): Promise<StaffRecoveryTarget & { temporaryPassword: string }> {
  const target = await loadTarget(prisma, userId);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: ACTION[source].password,
        entityType: "user",
        entityId: userId,
        after: {
          source,
          totpPreserved: target.totpEnrolled,
          sessionsRevoked: true,
        },
      },
    });
  });

  return {
    id: target.id,
    email: target.email,
    phone: target.phone,
    fullName: target.fullName,
    totpEnrolled: target.totpEnrolled,
    temporaryPassword,
  };
}

/**
 * Clear a staff member's TOTP enrollment so they re-enroll at next sign-in.
 * Password is preserved; sessions are revoked because the second factor is
 * being replaced. Always a separate, explicitly confirmed operation.
 */
export async function applyStaffAuthenticatorReset(
  prisma: PrismaClient,
  userId: string,
  actorId: string | null,
  source: StaffRecoverySource,
): Promise<StaffRecoveryTarget> {
  const target = await loadTarget(prisma, userId);
  if (!target.totpEnrolled) {
    throw new BadRequestException("Two-factor authentication is not enrolled.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.staffProfile.update({
      where: { userId },
      data: { totpSecret: null, totpEnrolledAt: null },
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: ACTION[source].authenticator,
        entityType: "user",
        entityId: userId,
        before: { totpEnrolled: true },
        after: { source, totpEnrolled: false, passwordPreserved: true },
      },
    });
  });

  return {
    id: target.id,
    email: target.email,
    phone: target.phone,
    fullName: target.fullName,
    totpEnrolled: false,
  };
}

/** Used by the console to refuse self-service through the recovery screen. */
export function assertNotSelf(
  actorId: string,
  targetId: string,
  operation: "password" | "authenticator",
): void {
  if (actorId === targetId) {
    throw new ForbiddenException(
      operation === "password"
        ? "Use “Change password” in Settings for your own account."
        : "Your own authenticator must be recovered by another super administrator.",
    );
  }
}
