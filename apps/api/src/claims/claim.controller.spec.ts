import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimsController } from "./claim.controller";

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "user-1", kind: "customer" },
    userRoles: [],
    ...overrides,
  } as any;
}

const validBody = {
  claimType: "register_new" as const,
  evidenceNote: "This is sufficient evidence note.",
};

describe("ClaimsController.submit", () => {
  let claims: any;
  let prisma: any;
  let ctrl: ClaimsController;

  beforeEach(() => {
    claims = {
      submit: vi.fn().mockResolvedValue({ id: "claim-1", state: "pending" }),
      isAutoApproveEnabled: vi.fn().mockResolvedValue(false),
      decide: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      user: { findUnique: vi.fn() },
      customerProfile: {
        findUnique: vi.fn().mockResolvedValue({ id: "cust-1" }),
      },
      qrCode: { findUnique: vi.fn() },
    };
    ctrl = new ClaimsController(claims, prisma);
  });

  it("authenticated active customer can submit a register_new claim without phone verification", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      kind: "customer",
      status: "active",
      deletedAt: null,
    });
    const out = await ctrl.submit(validBody, makeReq());
    expect(out).toEqual({ id: "claim-1", state: "pending" });
    expect(claims.submit).toHaveBeenCalledTimes(1);
  });

  it("authenticated active customer can submit a dispute_existing claim without phone verification", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      kind: "customer",
      status: "active",
      deletedAt: null,
    });
    const body = { claimType: "dispute_existing", evidenceNote: "This is sufficient evidence note." };
    const out = await ctrl.submit(body, makeReq());
    expect(out).toEqual({ id: "claim-1", state: "pending" });
    expect(claims.submit).toHaveBeenCalledWith(
      expect.objectContaining({ claimType: "dispute_existing", claimedByCustomerId: "cust-1" }),
    );
  });

  it("rejects unavailable accounts", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      kind: "customer",
      status: "suspended",
      deletedAt: null,
    });
    await expect(ctrl.submit(validBody, makeReq())).rejects.toBeInstanceOf(ForbiddenException);
    expect(claims.submit).not.toHaveBeenCalled();
  });

  it("existing claim validation remains intact", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      kind: "customer",
      status: "active",
      deletedAt: null,
    });
    await expect(ctrl.submit({ claimType: "register_new", evidenceNote: "short" }, makeReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claims.submit).not.toHaveBeenCalled();
  });
});
