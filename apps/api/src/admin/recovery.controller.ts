import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { AuthedRequest, RequireAudience, RequirePermission } from "../auth/auth.guard";
import type { CookieAwareRequest } from "../auth/cookies";
import { RecoveryService } from "../auth/recovery.service";
import { assertNotSelf } from "../auth/staff-recovery";

/**
 * Admin-console recovery authorization.
 *
 * Customer PIN reset requires `customer:reset_pin` (admin/super_admin).
 * Staff recovery requires `staff:manage` (super_admin only):
 * - Password reset TOKEN: operator-authorized, single-use token the staff
 *   member redeems to set a new password (TOTP preserved).
 * - Password reset (temporary password): replaces password directly (TOTP
 *   preserved).
 * - Authenticator reset: clears TOTP enrollment for re-enrollment (password
 *   preserved). These are separate, explicit operations.
 */

const noteSchema = z.object({
  note: z.string().trim().max(300).optional(),
});

const confirmSchema = z.object({
  confirm: z.literal(true),
});

@Controller("admin")
@RequireAudience("admin")
export class AdminRecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  /** Recent PIN-reset authorizations, newest first. */
  @Get("recovery/pin-resets")
  @RequirePermission("customer:reset_pin")
  async listPinResets(@Query("limit") limit?: string) {
    const parsed = Number(limit ?? 50);
    return {
      resets: await this.recovery.listPinResets(
        Number.isFinite(parsed) ? parsed : 50,
      ),
    };
  }

  /** Issue a short-lived, single-use PIN reset token for a verified customer. */
  @Post("customers/:id/pin-reset")
  @RequirePermission("customer:reset_pin")
  @Header("Cache-Control", "no-store")
  @HttpCode(201)
  async authorizePinReset(
    @Param("id") customerId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest & CookieAwareRequest,
  ) {
    const parsed = noteSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Keep the verification note under 300 characters.");
    }

    const issued = await this.recovery.authorizePinReset(
      customerId,
      req.user!.id,
      req.ip,
      parsed.data.note,
    );

    return {
      ok: true,
      resetToken: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      authorizationId: issued.id,
      customer: issued.customer,
      notice:
        "Give this token to the customer only after identity verification. It can be used once and expires shortly.",
    };
  }

  /** Cancel a pending authorization (e.g. token shared with the wrong person). */
  @Post("recovery/pin-resets/:id/revoke")
  @RequirePermission("customer:reset_pin")
  @HttpCode(200)
  async revokePinReset(@Param("id") id: string, @Req() req: AuthedRequest & CookieAwareRequest) {
    await this.recovery.revokePinReset(id, req.user!.id);
    return { ok: true };
  }

  /** Recent staff password reset token authorizations, newest first. */
  @Get("recovery/staff-password-resets")
  @RequirePermission("staff:manage")
  async listStaffPasswordResets(@Query("limit") limit?: string) {
    const parsed = Number(limit ?? 50);
    return {
      resets: await this.recovery.listStaffPasswordResets(
        Number.isFinite(parsed) ? parsed : 50,
      ),
    };
  }

  /** Issue a one-time staff password reset token (manual verification). */
  @Post("staff/:id/password-reset-token")
  @RequirePermission("staff:manage")
  @Header("Cache-Control", "no-store")
  @HttpCode(201)
  async authorizeStaffPasswordResetToken(
    @Param("id") staffId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest & CookieAwareRequest,
  ) {
    assertNotSelf(req.user!.id, staffId, "password");
    const parsed = noteSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Keep the verification note under 300 characters.");
    }

    const issued = await this.recovery.authorizeStaffPasswordReset(
      staffId,
      req.user!.id,
      req.ip,
      parsed.data.note,
    );

    return {
      ok: true,
      resetToken: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
      authorizationId: issued.id,
      staff: issued.staff,
      notice:
        "Give this token to the staff member only after identity verification. It can be used once, expires shortly, and lets them set a new password. Their authenticator stays enrolled and is still required at sign-in.",
    };
  }

  /** Cancel a pending staff password reset token authorization. */
  @Post("recovery/staff-password-resets/:id/revoke")
  @RequirePermission("staff:manage")
  @HttpCode(200)
  async revokeStaffPasswordReset(
    @Param("id") id: string,
    @Req() req: AuthedRequest & CookieAwareRequest,
  ) {
    await this.recovery.revokeStaffPasswordReset(id, req.user!.id);
    return { ok: true };
  }

  /** Replace a staff password with a one-time temporary password (legacy/operator-direct). */
  @Post("staff/:id/password-reset")
  @RequirePermission("staff:manage")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  async resetStaffPassword(@Param("id") id: string, @Req() req: AuthedRequest & CookieAwareRequest) {
    assertNotSelf(req.user!.id, id, "password");
    const result = await this.recovery.resetStaffPassword(id, req.user!.id);
    return {
      ok: true,
      staff: {
        id: result.id,
        fullName: result.fullName,
        email: result.email,
        phone: result.phone,
        totpEnrolled: result.totpEnrolled,
      },
      temporaryPassword: result.temporaryPassword,
      notice:
        "Share this temporary password with the staff member through a verified channel. Their authenticator stays enrolled and is still required at sign-in. Prefer issuing a password reset token when the staff member should choose their own new password.",
    };
  }

  /**
   * Clear a staff member's TOTP enrollment so they re-enroll at next sign-in.
   * Separate operation; the password is preserved.
   */
  @Post("staff/:id/authenticator-reset")
  @RequirePermission("staff:manage")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  async resetStaffAuthenticator(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest & CookieAwareRequest,
  ) {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        "Confirm the authenticator reset before continuing.",
      );
    }
    assertNotSelf(req.user!.id, id, "authenticator");

    const result = await this.recovery.resetStaffAuthenticator(id, req.user!.id);
    return {
      ok: true,
      staff: result,
      notice:
        "Authenticator enrollment cleared. The staff member's password is unchanged; they must set up an authenticator again at next sign-in.",
    };
  }
}
