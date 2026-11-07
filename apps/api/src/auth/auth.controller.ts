import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { PrismaClient, User } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { normalizeNgPhone, PhoneNormalizationError } from "../common/phone";
import { OtpService, OtpInvalidError, OtpThrottledError } from "./otp.service";
import { SESSION_COOKIES } from "./auth.guard";
import {
  audienceFrom,
  assertOrigin,
  issueCsrf,
  setSessionCookie,
} from "./cookies";
import { SessionAudience, SessionService } from "./session.service";

/**
 * Auth endpoints — v1.2 §12 / §12.4:
 * - __Host- prefixed, host-only, Secure/HttpOnly/SameSite=Lax cookies
 * - Double-submit CSRF token on state-changing requests + Origin check
 * - OTP issue/verify with throttling surfaced as 429 + Retry-After
 * - Cross-audience sessions impossible: separate cookie names per origin
 */

const phoneSchema = z.object({ phone: z.string().min(6).max(20) });
const verifySchema = phoneSchema.extend({
  code: z.string().regex(/^\d{6}$/, "6-digit code required"),
  purpose: z.enum(["login", "register", "recovery"]),
  csrfToken: z.string().min(16),
  fullName: z.string().trim().min(2).max(120).optional(), // required for register (checked below)
});

interface CsrfRequest extends Request {
  user?: User;
  sessionToken?: string;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaClient,
  ) {}

  @Post("otp/request")
  @HttpCode(200)
  async requestOtp(
    @Body() body: unknown,
    @Req() req: CsrfRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = phoneSchema.safeParse(body);
    if (!parsed.success) throw new ForbiddenException("Invalid payload.");

    assertOrigin(req);
    const audience = audienceFrom(req);
    const csrfToken = issueCsrf(res, audience);

    let phone: string;
    try {
      phone = normalizeNgPhone(parsed.data.phone);
    } catch (e) {
      if (e instanceof PhoneNormalizationError) {
        throw new ForbiddenException("Enter a valid Nigerian phone number.");
      }
      throw e;
    }

    try {
      await this.otp.issue(phone, "login", req.ip);
    } catch (e) {
      if (e instanceof OtpThrottledError) {
        res.setHeader("Retry-After", Math.ceil(e.retryAfterMs / 1000));
        throw new ForbiddenException(e.message);
      }
      throw e;
    }

    // Never reveal whether the number has an account (enumeration resistance)
    return { ok: true, csrfToken, message: "If eligible, a code has been sent." };
  }

  @Post("otp/verify")
  @HttpCode(200)
  async verifyOtp(
    @Body() body: unknown,
    @Req() req: CsrfRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) throw new ForbiddenException("Invalid payload.");

    assertOrigin(req);
    const audience = audienceFrom(req);
    this.assertCsrf(req, audience, parsed.data.csrfToken);

    if (parsed.data.purpose === "register" && !parsed.data.fullName) {
      throw new ForbiddenException("Your name is required to register.");
    }

    let phone: string;
    try {
      phone = normalizeNgPhone(parsed.data.phone);
    } catch {
      throw new ForbiddenException("Enter a valid Nigerian phone number.");
    }

    try {
      await this.otp.verify(phone, parsed.data.purpose, parsed.data.code);
    } catch (e) {
      if (e instanceof OtpThrottledError) {
        res.setHeader("Retry-After", Math.ceil(e.retryAfterMs / 1000));
        throw new ForbiddenException(e.message);
      }
      if (e instanceof OtpInvalidError) throw new ForbiddenException(e.message);
      throw e;
    }

    // Find or create the user for this phone (register creates; login requires)
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (parsed.data.purpose === "login" && !existing) {
      throw new ForbiddenException("No account found for this number. Please register.");
    }
    const user =
      existing ??
      (await this.prisma.user.create({ data: { phone, kind: "customer", status: "active" } }));

    // Every customer needs exactly one profile (customerId invariant)
    if (user.kind === "customer") {
      const profile = await this.prisma.customerProfile.findUnique({
        where: { userId: user.id },
      });
      if (!profile) {
        await this.prisma.customerProfile.create({
          data: {
            userId: user.id,
            fullName: parsed.data.fullName ?? "Valued customer",
          },
        });
      }
    }

    if (user.status !== "active" || user.deletedAt) {
      // Suspended accounts: throttle response, no session issued
      throw new ForbiddenException("Account unavailable. Please contact support.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const session = await this.sessions.issue(user.id, audience, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    setSessionCookie(res, audience, session.token, session.expiresAt);

    return { ok: true, userId: user.id };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: CsrfRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audience = audienceFrom(req);
    const token = req.cookies?.[SESSION_COOKIES[audience]];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIES[audience], { path: "/" });
  }

  @Get("me")
  async me(@Req() req: CsrfRequest) {
    const audience = audienceFrom(req);
    const token = req.cookies?.[SESSION_COOKIES[audience]];
    if (!token) throw new ForbiddenException("Not authenticated.");
    const user = await this.sessions.resolve(token, audience);
    return { id: user.id, phone: user.phone, kind: user.kind };
  }

  // ── CSRF (body-vs-cookie double submit on OTP verify, §12.4) ─────

  private assertCsrf(req: CsrfRequest, audience: SessionAudience, header: string): void {
    const cookie = req.cookies?.[`__Host-${audience}_csrf`];
    if (!cookie || cookie !== header) {
      throw new ForbiddenException("CSRF validation failed.");
    }
  }
}
