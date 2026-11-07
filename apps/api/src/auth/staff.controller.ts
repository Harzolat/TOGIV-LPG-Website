import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient, User } from "@prisma/client";
import { decryptSecret, encryptSecret } from "../common/crypto";
import {
  signState,
  StateTokenError,
  verifyState,
} from "../common/tokens";
import { generateTotpSecret, totpAuthUri, verifyTotp } from "../common/totp";
import { assertOrigin, issueCsrf, setSessionCookie } from "./cookies";
import type { CookieAwareRequest } from "./cookies";
import { RequireAudience } from "./auth.guard";
import type { AuthedRequest } from "./auth.guard";
import { LoginThrottle } from "./login-throttle";
import { SessionService } from "./session.service";

/**
 * Staff authentication — v1.2 §12: password + TOTP second factor.
 *
 * Three-step flow, enumeration-resistant and uniformly timed:
 *  1. POST /auth/staff/login  (password only)
 *       → { step: "enroll", enrollmentToken }  first login: enroll TOTP
 *       → { step: "totp" }                     password ok, code needed
 *       → { ok, csrfToken }                    both factors ok → session
 *  2. POST /auth/staff/enroll/setup   → { secret, otpauthUri } (shown once)
 *  3. POST /auth/staff/enroll/verify  → secret validated, encrypted at rest,
 *                                       admin session issued
 *
 * The enrollment challenge is an HMAC-signed self-expiring state token —
 * no server-side pending rows. Password check runs against a dummy hash
 * when the account is unknown (uniform timing). Throttling: LoginThrottle
 * progressive lockout keyed by ip|identifier; totp guesses count too.
 */

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(8).max(200),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

const enrollSetupSchema = z.object({
  enrollmentToken: z.string().min(20).max(600),
});

const enrollVerifySchema = z.object({
  enrollmentToken: z.string().min(20).max(600),
  secret: z.string().regex(/^[A-Z2-7]{16,64}$/, "Invalid TOTP secret format."),
  code: z.string().regex(/^\d{6}$/),
});

const ENROLL_TTL_MS = 15 * 60_000;
const BCRYPT_COST = 10;

/** Lazy dummy hash so unknown-account logins cost the same as known ones. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(
    `timing-equalizer-${Math.random()}-${Date.now()}`,
    BCRYPT_COST,
  );
  return dummyHashPromise;
}

type EnrollmentState = { uid: string; purpose: string };

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

    const identifier = parsed.data.identifier;
    const key = `${req.ip}|${identifier.toLowerCase()}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException("Too many attempts. Please wait and try again.", 429);
    }

    const user = await this.findStaff(identifier);
    const passwordOk = await bcrypt.compare(
      parsed.data.password,
      user?.passwordHash ?? (await dummyHash()),
    );

    if (!user || !passwordOk || !user.passwordHash) {
      this.throttle.fail(key);
      throw new ForbiddenException("Incorrect credentials.");
    }

    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      this.throttle.fail(key);
      throw new ForbiddenException("Incorrect credentials.");
    }

    // First login: no TOTP yet → start enrollment (password already proven)
    if (!profile.totpEnrolledAt || !profile.totpSecret) {
      this.throttle.reset(key);
      const enrollmentToken = signState(
        { uid: user.id, purpose: "totp-enroll" },
        ENROLL_TTL_MS,
      );
      return { step: "enroll" as const, enrollmentToken };
    }

    // Password ok, second factor pending
    if (!parsed.data.totpCode) {
      return { step: "totp" as const };
    }

    const secret = decryptSecret(profile.totpSecret);
    if (!verifyTotp(secret, parsed.data.totpCode)) {
      this.throttle.fail(key); // code guesses count toward lockout
      throw new ForbiddenException("Incorrect credentials.");
    }

    this.throttle.reset(key);
    return this.issueSession(user, req, res);
  }

  @Post("enroll/setup")
  @HttpCode(200)
  async enrollSetup(@Body() body: unknown) {
    const parsed = enrollSetupSchema.safeParse(body);
    if (!parsed.success) throw new ForbiddenException("Invalid payload.");

    const state = this.readEnrollment(parsed.data.enrollmentToken);
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: state.uid },
    });
    if (!profile) throw new ForbiddenException("Enrollment is not available.");
    if (profile.totpEnrolledAt) {
      throw new ForbiddenException("Two-factor is already set up. Sign in.");
    }

    // Generated here, NOT persisted — only the client holds it until
    // enroll/verify proves a valid code, then it is encrypted at rest.
    const secret = generateTotpSecret();
    const account = profile.employeeRef ?? (await this.accountLabel(state.uid));
    return { secret, otpauthUri: totpAuthUri(secret, account) };
  }

  @Post("enroll/verify")
  @HttpCode(200)
  async enrollVerify(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = enrollVerifySchema.safeParse(body);
    if (!parsed.success) throw new ForbiddenException("Invalid payload.");

    const state = this.readEnrollment(parsed.data.enrollmentToken);

    if (!verifyTotp(parsed.data.secret, parsed.data.code)) {
      throw new ForbiddenException(
        "That code didn't match. Open your authenticator app and enter the current code.",
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: state.uid } });
    if (
      !user ||
      user.kind !== "staff" ||
      user.status !== "active" ||
      user.deletedAt
    ) {
      throw new ForbiddenException("Account is not active.");
    }

    await this.prisma.staffProfile.update({
      where: { userId: user.id },
      data: {
        totpSecret: encryptSecret(parsed.data.secret),
        totpEnrolledAt: new Date(),
      },
    });

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
      totpEnrolled: Boolean(user.staffProfile?.totpEnrolledAt),
    };
  }

  // ── helpers ─────────────────────────────────────────────────────

  private async findStaff(identifier: string): Promise<User | null> {
    const asEmail = identifier.includes("@") ? identifier.toLowerCase() : null;
    return this.prisma.user.findFirst({
      where: {
        kind: "staff",
        deletedAt: null,
        OR: [...(asEmail ? [{ email: asEmail }] : []), { phone: identifier }],
      },
    });
  }

  private readEnrollment(token: string): EnrollmentState {
    try {
      const state = verifyState<EnrollmentState>(token);
      if (state.purpose !== "totp-enroll" || !state.uid) {
        throw new StateTokenError("Wrong purpose.");
      }
      return state;
    } catch {
      throw new ForbiddenException("Enrollment session expired. Sign in again.");
    }
  }

  private async accountLabel(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true },
    });
    return user?.email ?? user?.phone ?? "staff";
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
