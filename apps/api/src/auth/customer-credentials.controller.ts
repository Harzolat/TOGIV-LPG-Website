import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { normalizeNgPhone, PhoneNormalizationError } from "../common/phone";
import { assertOrigin, audienceFrom, issueCsrf, setSessionCookie } from "./cookies";
import type { CookieAwareRequest } from "./cookies";
import { LoginThrottle } from "./login-throttle";
import { hashPassword, verifyPassword } from "./password";
import { SessionService } from "./session.service";

const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits.");

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().min(6).max(20),
    pin: pinSchema,
    confirmPin: pinSchema,
    address: z.string().trim().min(5).max(300),
  })
  .refine((v) => v.pin === v.confirmPin, {
    message: "PIN confirmation does not match.",
    path: ["confirmPin"],
  });

const loginSchema = z.object({
  phone: z.string().min(6).max(20),
  pin: pinSchema,
});

let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(`pin-timing-equalizer-${Math.random()}-${Date.now()}`, 10);
  return dummyHashPromise;
}

/**
 * Customer phone + 4-digit PIN authentication.
 * - Immediate registration (no OTP/verification)
 * - Generic login errors (no phone-number enumeration)
 * - Progressive throttling/temporary lockout on failed login attempts
 * - Secure session cookies + CSRF/origin protections preserved
 */
@Controller("auth")
export class CustomerCredentialsController {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottle,
  ) {}

  @Post("customer/register")
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join("; ") || "Invalid registration details.",
      );
    }

    assertOrigin(req);
    const audience = audienceFrom(req);
    if (audience !== "customer") {
      throw new ForbiddenException("Customer registration is not available here.");
    }

    let phone: string;
    try {
      phone = normalizeNgPhone(parsed.data.phone);
    } catch (e) {
      if (e instanceof PhoneNormalizationError) {
        throw new BadRequestException("Enter a valid Nigerian phone number.");
      }
      throw e;
    }

    const existing = await this.prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ForbiddenException(
        "An account with this phone number already exists. Please sign in instead.",
      );
    }

    const pinHash = await hashPassword(parsed.data.pin);
    const residentialAddress = parsed.data.address.trim();
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          phone,
          kind: "customer",
          status: "active",
          passwordHash: pinHash,
          lastLoginAt: new Date(),
          customerProfile: {
            create: {
              fullName: parsed.data.fullName,
              addresses: {
                create: {
                  label: "Home",
                  line1: residentialAddress,
                  line2: null,
                  city: "-",
                  state: "-",
                  lga: "-",
                  isDefault: true,
                },
              },
            },
          },
        },
      });
    } catch (e) {
      // Concurrent registrations for same number: DB/uniqueness is final arbiter.
      if (isUniqueViolation(e)) {
        throw new ForbiddenException(
          "An account with this phone number already exists. Please sign in instead.",
        );
      }
      throw e;
    }

    const session = await this.sessions.issue(user.id, "customer", {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    setSessionCookie(res, "customer", session.token, session.expiresAt);
    const csrfToken = issueCsrf(res, "customer");

    return { ok: true, csrfToken, userId: user.id };
  }

  @Post("customer/login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      // Generic to avoid leaking validation details as account signals.
      throw new ForbiddenException("Incorrect phone number or PIN.");
    }

    assertOrigin(req);
    const audience = audienceFrom(req);
    if (audience !== "customer") {
      throw new ForbiddenException("Customer sign-in is not available here.");
    }

    let phone: string;
    try {
      phone = normalizeNgPhone(parsed.data.phone);
    } catch {
      // Treat invalid format as failed auth without revealing existence.
      await verifyPassword(parsed.data.pin, await dummyHash());
      throw new ForbiddenException("Incorrect phone number or PIN.");
    }

    const key = `${req.ip}|customer-pin|${phone}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new ForbiddenException("Too many attempts. Please wait and try again.");
    }

    const user = await this.prisma.user.findFirst({
      where: { phone, kind: "customer", deletedAt: null },
    });

    const pinOk = await verifyPassword(parsed.data.pin, user?.passwordHash ?? (await dummyHash()));
    if (!user || !user.passwordHash || !pinOk) {
      this.throttle.fail(key);
      throw new ForbiddenException("Incorrect phone number or PIN.");
    }
    if (user.status !== "active") {
      // Keep response non-revealing relative to credential correctness specifics.
      throw new ForbiddenException("Account unavailable. Please contact support.");
    }

    this.throttle.reset(key);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const session = await this.sessions.issue(user.id, "customer", {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    setSessionCookie(res, "customer", session.token, session.expiresAt);
    const csrfToken = issueCsrf(res, "customer");

    return { ok: true, csrfToken, userId: user.id };
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}
