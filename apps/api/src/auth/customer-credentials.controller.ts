import {
  BadRequestException,
  Body,
  ConflictException,
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
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { SessionService } from "./session.service";

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(200)
  .transform((v) => v.toLowerCase());

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required.").max(120),
    email: emailSchema,
    password: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200),
    phone: z.string().trim().max(20).optional().nullable(),
    address: z.string().trim().max(300).optional().nullable(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Password confirmation does not match.",
    path: ["confirmPassword"],
  });

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(
    `pw-timing-equalizer-${Math.random()}-${Date.now()}`,
    10,
  );
  return dummyHashPromise;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

/**
 * Customer email + password authentication.
 * - Immediate registration (no OTP/verification)
 * - Generic login errors (no account enumeration)
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
        parsed.error.issues.map((i) => i.message).join("; ") ||
          "Invalid registration details.",
      );
    }

    assertOrigin(req);
    const audience = audienceFrom(req);
    if (audience !== "customer") {
      throw new ForbiddenException("Customer registration is not available here.");
    }

    const strength = validatePasswordStrength(parsed.data.password);
    if (strength) throw new BadRequestException(strength);

    const email = parsed.data.email;
    const existingEmail = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingEmail) {
      throw new ConflictException(
        "An account with this email already exists. Please sign in instead.",
      );
    }

    let phone: string | null = null;
    const rawPhone = parsed.data.phone?.trim();
    if (rawPhone) {
      try {
        phone = normalizeNgPhone(rawPhone);
      } catch (e) {
        if (e instanceof PhoneNormalizationError) {
          throw new BadRequestException("Enter a valid Nigerian phone number.");
        }
        throw e;
      }
      const existingPhone = await this.prisma.user.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true },
      });
      if (existingPhone) {
        throw new ConflictException(
          "This phone number is already used by an account.",
        );
      }
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const address = parsed.data.address?.trim() || null;

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          phone,
          kind: "customer",
          status: "active",
          passwordHash,
          lastLoginAt: new Date(),
          customerProfile: {
            create: {
              fullName: parsed.data.fullName,
              ...(address
                ? {
                    addresses: {
                      create: {
                        label: "Home",
                        line1: address,
                        line2: null,
                        city: "-",
                        state: "-",
                        lga: "-",
                        isDefault: true,
                      },
                    },
                  }
                : {}),
            },
          },
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          "An account with these details already exists. Please sign in instead.",
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
      throw new ForbiddenException("Incorrect email or password.");
    }

    assertOrigin(req);
    const audience = audienceFrom(req);
    if (audience !== "customer") {
      throw new ForbiddenException("Customer sign-in is not available here.");
    }

    const email = parsed.data.email;
    const key = `${req.ip}|customer-email|${email}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new ForbiddenException("Too many attempts. Please wait and try again.");
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        kind: "customer",
        deletedAt: null,
      },
    });

    if (!user) {
      await verifyPassword(parsed.data.password, await dummyHash());
      throw new ForbiddenException(
        "No account found for this email. Please create an account, then sign in.",
        { description: "account_not_found" } as any,
      );
    }

    const ok = await verifyPassword(
      parsed.data.password,
      user.passwordHash ?? (await dummyHash()),
    );
    if (!user.passwordHash || !ok) {
      this.throttle.fail(key);
      throw new ForbiddenException("Incorrect email or password.");
    }
    if (user.status !== "active") {
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
