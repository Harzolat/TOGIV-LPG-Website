import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Get,
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
 * Public surface (narrow, non-enumerating):
 * - GET  /auth/recovery-info              → business contact configuration only
 * - POST /auth/customer/recovery-request  → generic guidance, no account oracle
 * - POST /auth/customer/pin-reset         → redeem operator-issued PIN token
 * - POST /auth/staff/recovery-request     → generic guidance, no account oracle
 * - POST /auth/staff/password-reset       → redeem operator-issued staff token
 *
 * Admin/staff password reset tokens are issued only after manual identity
 * verification (console by authorized operator, or break-glass CLI where
 * applicable). Token redemption sets a new password but preserves TOTP.
 */

const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits.");

const pinResetSchema = z
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
  // Accepted for the operator's context but never stored or inspected for
  // existence. Invalid/absent values get the same guidance.
  phone: z.string().trim().max(40).optional(),
});

const staffRecoveryRequestSchema = z.object({
  // Accepted for operator context but never stored or inspected for existence.
  identifier: z.string().trim().max(200).optional(),
});

const staffPasswordResetSchema = z
  .object({
    token: z.string().trim().min(20).max(300),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
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

  /** Business contact details for the recovery pages (no account data). */
  @Public()
  @Get("recovery-info")
  async recoveryInfo() {
    const contact = await this.recovery.recoveryContact();
    return {
      ...contact,
      instructions:
        "Account recovery is completed after manual identity verification by our team. We will never ask for your PIN or password. Customers use operator-issued PIN reset tokens; staff/admin use operator-issued password reset tokens (authenticator remains required).",
      staffInstructions:
        "Admin password recovery requires identity verification by a super administrator/owner. They may issue a one-time password reset token so you can set a new password (your authenticator stays enrolled). If the initial super administrator is locked out of the console, use the server-side break-glass recovery process on the API host.",
    };
  }

  /**
   * "I need help" request. Always returns identical guidance and stores
   * nothing, so registered and unregistered numbers are indistinguishable.
   */
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

    return this.recovery.recoveryRequestGuidance();
  }

  /** Redeem a single-use PIN reset token issued by an operator. */
  @Public()
  @Post("customer/pin-reset")
  @HttpCode(200)
  async resetPin(
    @Body() body: unknown,
    @Req() req: CookieAwareRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = pinResetSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? "Check the form and try again.",
      );
    }
    assertOrigin(req);

    // Per-IP quota first: it caps the CPU cost of hashing regardless of how
    // many distinct (invalid) tokens one client tries.
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

  /** Staff/admin "need help" request — generic guidance, non-enumerating. */
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

    return this.recovery.staffRecoveryRequestGuidance();
  }

  /** Redeem an operator-issued staff password reset token (preserves TOTP). */
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
