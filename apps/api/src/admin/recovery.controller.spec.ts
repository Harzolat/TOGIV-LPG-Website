import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PERMISSION_KEY, AUDIENCE_KEY } from "../auth/auth.guard";
import { AdminRecoveryController } from "./recovery.controller";

function makeRecovery() {
  return {
    listPinResets: vi.fn(),
    authorizePinReset: vi.fn(),
    revokePinReset: vi.fn(),
    listStaffPasswordResets: vi.fn(),
    authorizeStaffPasswordReset: vi.fn(),
    revokeStaffPasswordReset: vi.fn(),
    resetStaffPassword: vi.fn(),
    resetStaffAuthenticator: vi.fn(),
  } as any;
}

function req(actorId = "admin-1", ip = "10.0.0.1") {
  return { user: { id: actorId }, ip } as any;
}

describe("AdminRecoveryController authorization controls", () => {
  it("declares admin audience and required permissions on recovery endpoints", () => {
    expect(Reflect.getMetadata(AUDIENCE_KEY, AdminRecoveryController)).toBe("admin");

    const cases: Array<[string, string]> = [
      ["listPinResets", "customer:reset_pin"],
      ["authorizePinReset", "customer:reset_pin"],
      ["revokePinReset", "customer:reset_pin"],
      ["listStaffPasswordResets", "staff:manage"],
      ["authorizeStaffPasswordResetToken", "staff:manage"],
      ["revokeStaffPasswordReset", "staff:manage"],
      ["resetStaffPassword", "staff:manage"],
      ["resetStaffAuthenticator", "staff:manage"],
    ];

    for (const [method, permission] of cases) {
      const handler = (AdminRecoveryController.prototype as any)[method];
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
    }
  });

  it("rejects self-targeted staff password reset token issuance (cannot bypass authorization)", async () => {
    const recovery = makeRecovery();
    const ctrl = new AdminRecoveryController(recovery);

    await expect(
      ctrl.authorizeStaffPasswordResetToken("admin-1", {}, req("admin-1")),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(recovery.authorizeStaffPasswordReset).not.toHaveBeenCalled();
  });

  it("issues a staff password reset token for another staff member when authorized", async () => {
    const recovery = makeRecovery();
    recovery.authorizeStaffPasswordReset.mockResolvedValue({
      id: "auth-1",
      token: "raw-token-value-that-is-long-enough",
      expiresAt: new Date("2026-01-01T00:30:00.000Z"),
      staff: { id: "staff-2", fullName: "Staff Two", email: "s2@example.com", phone: "+2348011111111" },
    });
    const ctrl = new AdminRecoveryController(recovery);

    const out = await ctrl.authorizeStaffPasswordResetToken(
      "staff-2",
      { note: "Verified in person" },
      req("admin-1", "203.0.113.5"),
    );

    expect(recovery.authorizeStaffPasswordReset).toHaveBeenCalledWith(
      "staff-2",
      "admin-1",
      "203.0.113.5",
      "Verified in person",
    );
    expect(out).toMatchObject({
      ok: true,
      resetToken: "raw-token-value-that-is-long-enough",
      authorizationId: "auth-1",
      staff: { id: "staff-2" },
    });
  });

  it("issues a customer PIN reset token only through the authorized operator endpoint", async () => {
    const recovery = makeRecovery();
    recovery.authorizePinReset.mockResolvedValue({
      id: "pin-auth-1",
      token: "raw-pin-reset-token-value-long-enough",
      expiresAt: new Date("2026-01-01T00:30:00.000Z"),
      customer: { id: "cust-1", fullName: "Ada Obi", phone: "+2348012345678" },
    });
    const ctrl = new AdminRecoveryController(recovery);

    const out = await ctrl.authorizePinReset("cust-1", { note: "Verified" }, req("admin-1"));

    expect(recovery.authorizePinReset).toHaveBeenCalledWith("cust-1", "admin-1", "10.0.0.1", "Verified");
    expect(out.ok).toBe(true);
    expect(out.resetToken).toBe("raw-pin-reset-token-value-long-enough");
  });
});
