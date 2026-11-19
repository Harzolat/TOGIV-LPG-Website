import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient, User } from "@prisma/client";
import { normalizeNgPhone } from "../common/phone";
import { assertOrigin, issueCsrf, setSessionCookie } from "./cookies";
import type { CookieAwareRequest } from "./cookies";
import { RequireAudience } from "./auth.guard";
import type { AuthedRequest } from "./auth.guard";
import { LoginThrottle } from "./login-throttle";
import { SessionService } from "./session.service";

/**
 * Staff authentication — email + password (TOTP removed per current auth model).
 * Enumeration-resistant and uniformly timed: password check runs against a
 * dummy hash when the account is unknown.
 */

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(200)
  .transform((v) => v.toLowerCase());

const loginSchema = z.object({
  // Accept `email` (preferred) or legacy `identifier` containing an email.
  email: emailSchema.optional(),
  identifier: z.string().trim().min(3).max(200).optional(),
  password: z.string().min(1).max(200),
});

const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  department: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: emailSchema.nullable().optional(),
});

const BCRYPT_COST = 10;

let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(
    `timing-equalizer-${Math.random()}-${Date.now()}`,
    BCRYPT_COST,
  );
  return dummyHashPromise;
}

@Controller("auth/staff")
export class StaffAuthController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottle,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new ForbiddenException("Invalid payload.");
    assertOrigin(req);

    const rawEmail = parsed.data.email ?? parsed.data.identifier ?? "";
    const emailParsed = emailSchema.safeParse(rawEmail);
    if (!emailParsed.success) {
      await bcrypt.compare(parsed.data.password, await dummyHash());
      throw new ForbiddenException("Incorrect email or password.");
    }
    const email = emailParsed.data;

    const key = `${req.ip}|staff|${email}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    const user = await this.findStaffByEmail(email);
    const passwordOk = await bcrypt.compare(
      parsed.data.password,
      user?.passwordHash ?? (await dummyHash()),
    );

    if (!user || !passwordOk || !user.passwordHash) {
      this.throttle.fail(key);
      throw new ForbiddenException("Incorrect email or password.");
    }
    if (user.status !== "active") {
      throw new ForbiddenException("Account unavailable. Please contact support.");
    }

    this.throttle.reset(key);
    return this.issueSession(user, req, res);
  }

  /** Session-bound staff identity for the admin console bootstrap. */
  @Get("me")
  @RequireAudience("admin")
  async me(@Req() req: AuthedRequest) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        staffProfile: true,
        roles: { include: { role: true } },
      },
    });
    if (!user) throw new ForbiddenException("Account not found.");
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.staffProfile?.fullName ?? null,
      department: user.staffProfile?.department ?? null,
      roles: user.roles.map((ur) => ur.role.key),
      totpEnrolled: false,
    };
  }

  @Patch("profile")
  @RequireAudience("admin")
  async updateProfile(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "field"}: ${i.message}`)
          .join("; "),
      );
    }

    const data = parsed.data;
    const userId = req.user!.id;
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { staffProfile: true },
    });
    if (!existing || existing.kind !== "staff" || existing.deletedAt) {
      throw new ForbiddenException("Account not found.");
    }

    let nextPhone: string | null | undefined;
    if (data.phone !== undefined) {
      const raw = data.phone?.trim() ?? "";
      if (!raw) {
        nextPhone = null;
      } else {
        try {
          nextPhone = normalizeNgPhone(raw);
        } catch {
          throw new BadRequestException("Enter a valid Nigerian phone number.");
        }
        if (nextPhone !== existing.phone) {
          const phoneConflict = await this.prisma.user.findFirst({
            where: { phone: nextPhone, id: { not: userId }, deletedAt: null },
            select: { id: true },
          });
          if (phoneConflict) {
            throw new ConflictException(
              "This phone number is already used by another account.",
            );
          }
        }
      }
    }

    if (data.email !== undefined && data.email !== null) {
      const conflict = await this.prisma.user.findFirst({
        where: {
          id: { not: userId },
          deletedAt: null,
          email: { equals: data.email, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(
          "This email is already used by another account.",
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (data.email !== undefined || nextPhone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(data.email !== undefined ? { email: data.email } : {}),
            ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
          },
        });
      }
      if (data.fullName !== undefined || data.department !== undefined) {
        await tx.staffProfile.upsert({
          where: { userId },
          update: {
            ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
            ...(data.department !== undefined
              ? { department: data.department }
              : {}),
          },
          create: {
            userId,
            fullName: data.fullName ?? existing.staffProfile?.fullName ?? "Staff",
            department: data.department ?? null,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "staff.profile_updated",
          entityType: "user",
          entityId: userId,
          after: {
            ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
            ...(data.department !== undefined
              ? { department: data.department }
              : {}),
            ...(data.email !== undefined ? { email: data.email } : {}),
            ...(nextPhone !== undefined ? { phone: nextPhone } : {}),
          },
        },
      });
    });

    return { ok: true };
  }

  // ── helpers ─────────────────────────────────────────────────────

  private async findStaffByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        kind: "staff",
        deletedAt: null,
        email: { equals: email, mode: "insensitive" },
      },
    });
  }

  private async issueSession(
    user: User,
    req: CookieAwareRequest,
    res: Response,
  ) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const session = await this.sessions.issue(user.id, "admin", {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    setSessionCookie(res, "admin", session.token, session.expiresAt);
    const csrfToken = issueCsrf(res, "admin");
    return { ok: true as const, csrfToken, userId: user.id };
  }
}
