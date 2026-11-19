import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { assertOrigin } from "./cookies";
import type { CookieAwareRequest } from "./cookies";
import { AuthedRequest, RequireAudience } from "./auth.guard";
import { hashToken } from "../common/tokens";
import { LoginThrottle } from "./login-throttle";
import { Public } from "./public.decorator";
import { RecoveryService } from "./recovery.service";
import { RecoveryThrottle } from "./recovery-throttle";

/**
 * Public recovery endpoints + authenticated password change.
 *
 * Self-service password reset (email + one-time token, non-enumerating):
 * - POST /auth/customer/forgot-password  → request reset token
 * - POST /auth/customer/reset-password   → redeem token, set new password
 * - POST /auth/staff/forgot-password     → request reset token
 * - POST /auth/staff/reset-password      → redeem token, set new password
 *
 * Legacy/operator-issued token redemption endpoints are kept for compatibility.
 */

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(200)
  .transform((v) => v.toLowerCase());

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20).max(300),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200).optional(),
  })
  .refine((v) => v.confirmPassword == null || v.newPassword === v.confirmPassword, {
    message: "Password confirmation does not match.",
    path: ["confirmPassword"],
  });

// Legacy operator-issued customer PIN reset (kept for compatibility where needed)
const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits.");
const legacyPinResetSchema = z
  .object({
    token: z.string().trim().min(20).max(300),
    newPin: pinSchema,
    confirmPin: pinSchema,
  })
  .refine((v) => v.newPin === v.confirmPin, {
    message: "PIN confirmation does not match.",
    path: ["confirmPin"],
  });

const recoveryRequestSchema = z.object({
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
});

const staffRecoveryRequestSchema = z.object({
  identifier: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
});

const staffPasswordResetSchema = z
  .object({
    token: z.string().trim().min(20).max(300),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200).optional(),
  })
  .refine((v) => v.confirmPassword == null || v.newPassword === v.confirmPassword, {
    message: "Password confirmation does not match.",
    path: ["confirmPassword"],
  });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

@Controller("auth")
export class RecoveryController {
  constructor(
    private readonly recovery: RecoveryService,
    private readonly throttle: LoginThrottle,
    private readonly quota: RecoveryThrottle,
  ) {}

  /** Business contact details for recovery/help pages (no account data). */
  @Public()
  @Get("recovery-info")
  async recoveryInfo() {
    const contact = await this.recovery.recoveryContact();
    return {
      ...contact,
      instructions:
        "Forgot your password? Enter your email address and we’ll send a password reset link to your email if an account exists.",
      staffInstructions:
        "Staff/admin: enter your work email address and we’ll send a password reset link to your email if an account exists.",
      selfService: true,
    };
  }

  // ── Self-service: customer ────────────────────────────────────────

  @Public()
  @Post("customer/forgot-password")
  @HttpCode(200)
  async customerForgotPassword(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = forgotPasswordSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Enter a valid email address.");
    }
    assertOrigin(req);

    const wait = this.quota.hit(`${req.ip}|customer-forgot-password`);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many requests. Please try again later.",
        429,
      );
    }

    await this.recovery.requestSelfServicePasswordReset(
      parsed.data.email,
      "customer",
      req.ip,
    );
    return {
      ok: true,
      message:
        "If an account exists for this email, a password reset link has been sent.",
    };
  }

  @Public()
  @Post("customer/reset-password")
  @HttpCode(200)
  async customerResetPassword(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "Check the form and try again.",
      );
    }
    assertOrigin(req);

    const ipWait = this.quota.hit(`${req.ip}|customer-reset-password`);
    if (ipWait > 0) {
      res.setHeader("Retry-After", Math.ceil(ipWait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    const key = `${req.ip}|customer-reset-password|${hashToken(parsed.data.token).slice(0, 16)}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    try {
      await this.recovery.consumeSelfServicePasswordReset(
        parsed.data.token,
        parsed.data.newPassword,
        "customer",
        req.ip,
      );
      this.throttle.reset(key);
    } catch (err) {
      this.throttle.fail(key);
      throw err;
    }

    return { ok: true };
  }

  // ── Self-service: staff/admin ─────────────────────────────────────

  @Public()
  @Post("staff/forgot-password")
  @HttpCode(200)
  async staffForgotPassword(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = forgotPasswordSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Enter a valid email address.");
    }
    assertOrigin(req);

    const wait = this.quota.hit(`${req.ip}|staff-forgot-password`);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many requests. Please try again later.",
        429,
      );
    }

    await this.recovery.requestSelfServicePasswordReset(
      parsed.data.email,
      "staff",
      req.ip,
    );
    return {
      ok: true,
      message:
        "If an account exists for this email, a password reset link has been sent.",
    };
  }

  @Public()
  @Post("staff/reset-password")
  @HttpCode(200)
  async staffResetPasswordSelfService(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "Check the form and try again.",
      );
    }
    assertOrigin(req);

    const ipWait = this.quota.hit(`${req.ip}|staff-reset-password-self`);
    if (ipWait > 0) {
      res.setHeader("Retry-After", Math.ceil(ipWait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    const key = `${req.ip}|staff-reset-password-self|${hashToken(parsed.data.token).slice(0, 16)}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    try {
      await this.recovery.consumeSelfServicePasswordReset(
        parsed.data.token,
        parsed.data.newPassword,
        "staff",
        req.ip,
      );
      this.throttle.reset(key);
    } catch (err) {
      this.throttle.fail(key);
      throw err;
    }

    return { ok: true };
  }

  // ── Legacy / compatibility endpoints ──────────────────────────────

  /** @deprecated Use POST /auth/customer/forgot-password (kept for compatibility). */
  @Public()
  @Post("customer/recovery-request")
  @HttpCode(200)
  async recoveryRequest(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = recoveryRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Check the form and try again.");
    }
    assertOrigin(req);

    const wait = this.quota.hit(`${req.ip}|customer-recovery-request`);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many recovery requests. Please try again later.",
        429,
      );
    }

    const email = parsed.data.email?.trim().toLowerCase();
    if (email && z.string().email().safeParse(email).success) {
      await this.recovery.requestSelfServicePasswordReset(email, "customer", req.ip);
    }
    return {
      ok: true,
      message:
        "If an account exists for this email, a password reset link has been sent.",
    };
  }

  /** Legacy operator-issued PIN token redemption (kept; sets password hash). */
  @Public()
  @Post("customer/pin-reset")
  @HttpCode(200)
  async resetPin(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = legacyPinResetSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "Check the form and try again.",
      );
    }
    assertOrigin(req);

    const ipWait = this.quota.hit(`${req.ip}|customer-pin-reset`);
    if (ipWait > 0) {
      res.setHeader("Retry-After", Math.ceil(ipWait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    const key = `${req.ip}|customer-pin-reset|${hashToken(parsed.data.token).slice(0, 16)}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    try {
      await this.recovery.consumePinReset(
        parsed.data.token,
        parsed.data.newPin,
        req.ip,
      );
      this.throttle.reset(key);
    } catch (err) {
      this.throttle.fail(key);
      throw err;
    }

    return { ok: true };
  }

  /** @deprecated Use POST /auth/staff/forgot-password (kept for compatibility). */
  @Public()
  @Post("staff/recovery-request")
  @HttpCode(200)
  async staffRecoveryRequest(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = staffRecoveryRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Check the form and try again.");
    }
    assertOrigin(req);

    const wait = this.quota.hit(`${req.ip}|staff-recovery-request`);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many recovery requests. Please try again later.",
        429,
      );
    }

    const email = (parsed.data.email ?? parsed.data.identifier ?? "")
      .trim()
      .toLowerCase();
    if (email && z.string().email().safeParse(email).success) {
      await this.recovery.requestSelfServicePasswordReset(email, "staff", req.ip);
    }
    return {
      ok: true,
      message:
        "If an account exists for this email, a password reset link has been sent.",
    };
  }

  /** Operator-issued staff password reset token redemption (preserves TOTP in legacy model). */
  @Public()
  @Post("staff/password-reset")
  @HttpCode(200)
  async resetStaffPasswordWithToken(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = staffPasswordResetSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "Check the form and try again.",
      );
    }
    assertOrigin(req);

    const ipWait = this.quota.hit(`${req.ip}|staff-password-reset`);
    if (ipWait > 0) {
      res.setHeader("Retry-After", Math.ceil(ipWait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    const key = `${req.ip}|staff-password-reset|${hashToken(parsed.data.token).slice(0, 16)}`;
    const wait = this.throttle.retryAfterMs(key);
    if (wait > 0) {
      res.setHeader("Retry-After", Math.ceil(wait / 1000));
      throw new HttpException(
        "Too many attempts. Please wait and try again.",
        429,
      );
    }

    try {
      await this.recovery.consumeStaffPasswordReset(
        parsed.data.token,
        parsed.data.newPassword,
        req.ip,
      );
      this.throttle.reset(key);
    } catch (err) {
      this.throttle.fail(key);
      throw err;
    }

    return { ok: true };
  }

  /** Authenticated staff password change (session + audience required). */
  @Post("staff/password")
  @HttpCode(200)
  @RequireAudience("admin")
  async changeOwnPassword(
    @Body() body: unknown,
    @Req() req: AuthedRequest & CookieAwareRequest,
  ) {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Enter your current password and a new password of at least 8 characters.",
      );
    }
    assertOrigin(req);

    await this.recovery.changeOwnPassword(
      req.user!.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      req.sessionToken,
    );
    return { ok: true };
  }
}
