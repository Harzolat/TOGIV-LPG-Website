import { BadRequestException, NotFoundException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateOpaqueToken, hashToken } from "../common/tokens";
import { generateTemporaryPassword } from "./password";
import {
  PIN_RESET_TTL_MS,
  STAFF_PASSWORD_RESET_TTL_MS,
  RecoveryService,
  pinResetStatus,
  staffPasswordResetStatus,
} from "./recovery.service";

/**
 * Recovery security invariants (unit level, mocked Prisma):
 * - the raw reset token is never stored or logged — only its SHA-256 hash;
 * - expired/used/unknown tokens are rejected without touching the account;
 * - a successful redemption stores a bcrypt hash of the new PIN, consumes the
 *   token atomically, and revokes every customer session;
 * - temporary staff passwords satisfy the sign-in policy.
 */

function makePrisma() {
  const prisma: any = {
    customerProfile: { findUnique: vi.fn() },
    pinResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    staffPasswordResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    session: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    businessSetting: { findUnique: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(prisma));
  return prisma;
}

function makeService() {
  const prisma = makePrisma();
  const sessions = { revokeAllForUserExcept: vi.fn() };
  const service = new RecoveryService(prisma as any, sessions as any);
  return { prisma, sessions, service };
}

const ACTIVE_CUSTOMER = {
  id: "cust_1",
  fullName: "Ada Obi",
  user: {
    id: "user_1",
    phone: "+2348012345678",
    kind: "customer",
    status: "active",
    deletedAt: null,
  },
};

const ACTIVE_STAFF = {
  id: "staff_target",
  email: "staff@example.com",
  phone: "+2348099999999",
  kind: "staff",
  status: "active",
  deletedAt: null,
  staffProfile: {
    fullName: "Staff User",
    totpEnrolledAt: new Date("2026-01-01T00:00:00Z"),
  },
};

describe("pin reset status", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("derives completed, revoked, expired and pending", () => {
    expect(
      pinResetStatus({ consumedAt: past, revokedAt: null, expiresAt: future }),
    ).toBe("completed");
    expect(
      pinResetStatus({ consumedAt: null, revokedAt: past, expiresAt: future }),
    ).toBe("revoked");
    expect(
      pinResetStatus({ consumedAt: null, revokedAt: null, expiresAt: past }),
    ).toBe("expired");
    expect(
      pinResetStatus({ consumedAt: null, revokedAt: null, expiresAt: future }),
    ).toBe("pending");
    expect(
      staffPasswordResetStatus({
        consumedAt: null,
        revokedAt: null,
        expiresAt: future,
      }),
    ).toBe("pending");
  });
});

describe("temporary password", () => {
  it("meets the sign-in password policy and varies", () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a).toMatch(/[a-zA-Z]/);
    expect(a).toMatch(/[0-9]/);
  });
});

describe("RecoveryService.authorizePinReset", () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it("returns a 256-bit token once and stores only its hash", async () => {
    ctx.prisma.customerProfile.findUnique.mockResolvedValue(ACTIVE_CUSTOMER);
    ctx.prisma.pinResetToken.updateMany.mockResolvedValue({ count: 0 });
    ctx.prisma.pinResetToken.create.mockImplementation(({ data }: any) => ({
      id: "token_1",
      ...data,
    }));
    ctx.prisma.auditLog.create.mockResolvedValue({});

    const result = await ctx.service.authorizePinReset(
      "cust_1",
      "staff_1",
      "10.0.0.1",
    );

    expect(result.token).toHaveLength(43); // 32 bytes base64url
    expect(result.customer).toEqual({
      id: "cust_1",
      fullName: "Ada Obi",
      phone: "+2348012345678",
    });

    const created = ctx.prisma.pinResetToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(hashToken(result.token));
    expect(created.tokenHash).not.toBe(result.token);
    expect(JSON.stringify(created)).not.toContain(result.token);
    expect(created.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + PIN_RESET_TTL_MS - 5_000,
    );
    expect(created.createdBy).toBe("staff_1");
  });

  it("refuses an inactive customer account", async () => {
    ctx.prisma.customerProfile.findUnique.mockResolvedValue({
      ...ACTIVE_CUSTOMER,
      user: { ...ACTIVE_CUSTOMER.user, status: "suspended" },
    });

    await expect(
      ctx.service.authorizePinReset("cust_1", "staff_1"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.pinResetToken.create).not.toHaveBeenCalled();
  });
});

describe("RecoveryService.consumePinReset", () => {
  let ctx: ReturnType<typeof makeService>;
  const rawToken = generateOpaqueToken(32);

  beforeEach(() => {
    ctx = makeService();
    ctx.prisma.auditLog.create.mockResolvedValue({});
  });

  function tokenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "token_1",
      userId: "user_1",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      revokedAt: null,
      user: {
        id: "user_1",
        kind: "customer",
        status: "active",
        deletedAt: null,
        customerProfile: { id: "cust_1" },
      },
      ...overrides,
    };
  }

  it(
    "rejects an unknown token without touching an account",
    { timeout: 15000 },
    async () => {
      ctx.prisma.pinResetToken.findUnique.mockResolvedValue(null);

      await expect(
        ctx.service.consumePinReset("not-a-real-token-value-000", "1234"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.prisma.user.update).not.toHaveBeenCalled();
      expect(ctx.prisma.session.updateMany).not.toHaveBeenCalled();
    },
  );

  it("rejects an expired token", async () => {
    ctx.prisma.pinResetToken.findUnique.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    await expect(ctx.service.consumePinReset(rawToken, "1234")).rejects.toThrow(
      /expired/i,
    );
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a re-used token", async () => {
    ctx.prisma.pinResetToken.findUnique.mockResolvedValue(
      tokenRow({ consumedAt: new Date() }),
    );

    await expect(ctx.service.consumePinReset(rawToken, "1234")).rejects.toThrow(
      /already been used/i,
    );
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it("does not update the account when the atomic claim loses a race", async () => {
    ctx.prisma.pinResetToken.findUnique.mockResolvedValue(tokenRow());
    ctx.prisma.pinResetToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      ctx.service.consumePinReset(rawToken, "1234"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it(
    "stores a bcrypt hash, consumes the token and revokes sessions",
    { timeout: 15000 },
    async () => {
      ctx.prisma.pinResetToken.findUnique.mockResolvedValue(tokenRow());
      ctx.prisma.pinResetToken.updateMany.mockResolvedValue({ count: 1 });
      ctx.prisma.user.updateMany.mockResolvedValue({ count: 1 });
      ctx.prisma.session.updateMany.mockResolvedValue({ count: 3 });

      await ctx.service.consumePinReset(rawToken, "5678", "10.0.0.9");

      const stored =
        ctx.prisma.user.updateMany.mock.calls[0][0].data.passwordHash;
      expect(stored).not.toBe("5678");
      expect(stored.startsWith("$2")).toBe(true);
      expect(await bcrypt.compare("5678", stored)).toBe(true);
      expect(await bcrypt.compare("1234", stored)).toBe(false);

      const claim = ctx.prisma.pinResetToken.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({
        id: "token_1",
        consumedAt: null,
        revokedAt: null,
      });
      expect(claim.data.consumedAt).toBeInstanceOf(Date);

      expect(ctx.prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user_1", revokedAt: null },
        }),
      );

      const audit = ctx.prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe("customer.pin_reset_completed");
      expect(JSON.stringify(audit)).not.toContain(rawToken);
      expect(JSON.stringify(audit)).not.toContain("5678");
    },
  );
});

describe("RecoveryService.recoveryContact", () => {
  it("reads the configured business contact and trims it", async () => {
    const { prisma, service } = makeService();
    prisma.businessSetting.findUnique.mockResolvedValue({
      key: "company.contact",
      value: {
        company: "Throne of Grace Integrated Ventures",
        phone: " 09013198496 ",
        altPhone: "08061265486",
        hours: "Mon–Sat, 8am–6pm",
      },
    });

    await expect(service.recoveryContact()).resolves.toEqual({
      company: "Throne of Grace Integrated Ventures",
      phones: ["09013198496", "08061265486"],
      hours: "Mon–Sat, 8am–6pm",
    });
  });

  it("falls back to environment variables when the setting is absent", async () => {
    const { prisma, service } = makeService();
    prisma.businessSetting.findUnique.mockResolvedValue(null);
    const prev = process.env.BUSINESS_CONTACT_PHONE;
    process.env.BUSINESS_CONTACT_PHONE = "08000000000";
    try {
      const info = await service.recoveryContact();
      expect(info.phones).toContain("08000000000");
      expect(info.company).toBe("Throne of Grace Integrated Ventures");
    } finally {
      if (prev === undefined) delete process.env.BUSINESS_CONTACT_PHONE;
      else process.env.BUSINESS_CONTACT_PHONE = prev;
    }
  });
});

describe("RecoveryService.authorizeStaffPasswordReset", () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it("issues a token once, stores only its hash, and audits (TOTP preserved)", async () => {
    ctx.prisma.user.findUnique.mockResolvedValue(ACTIVE_STAFF);
    ctx.prisma.staffPasswordResetToken.updateMany.mockResolvedValue({
      count: 0,
    });
    ctx.prisma.staffPasswordResetToken.create.mockImplementation(
      ({ data }: any) => ({
        id: "srt_1",
        ...data,
      }),
    );
    ctx.prisma.auditLog.create.mockResolvedValue({});

    const result = await ctx.service.authorizeStaffPasswordReset(
      "staff_target",
      "actor_admin",
      "10.0.0.2",
      "Verified in person",
    );

    expect(result.token).toHaveLength(43);
    expect(result.staff).toEqual({
      id: "staff_target",
      fullName: "Staff User",
      email: "staff@example.com",
      phone: "+2348099999999",
    });

    const created =
      ctx.prisma.staffPasswordResetToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(hashToken(result.token));
    expect(created.tokenHash).not.toBe(result.token);
    expect(created.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + STAFF_PASSWORD_RESET_TTL_MS - 5_000,
    );
    expect(created.createdBy).toBe("actor_admin");

    const audit = ctx.prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("staff.password_reset_token_authorized");
    expect(audit.after.totpPreserved).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(result.token);
  });

  it("refuses issuance for non-staff/inactive/deleted targets", async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({
      ...ACTIVE_STAFF,
      status: "suspended",
    });
    await expect(
      ctx.service.authorizeStaffPasswordReset("staff_target", "actor_admin"),
    ).rejects.toBeInstanceOf(BadRequestException);

    ctx.prisma.user.findUnique.mockResolvedValue({
      ...ACTIVE_STAFF,
      kind: "customer",
    });
    await expect(
      ctx.service.authorizeStaffPasswordReset("staff_target", "actor_admin"),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(ctx.prisma.staffPasswordResetToken.create).not.toHaveBeenCalled();
  });
});

describe("RecoveryService.consumeStaffPasswordReset", () => {
  let ctx: ReturnType<typeof makeService>;
  const rawToken = generateOpaqueToken(32);

  beforeEach(() => {
    ctx = makeService();
    ctx.prisma.auditLog.create.mockResolvedValue({});
  });

  function tokenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "srt_1",
      userId: "staff_target",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      revokedAt: null,
      user: {
        id: "staff_target",
        kind: "staff",
        status: "active",
        deletedAt: null,
        staffProfile: { totpEnrolledAt: new Date("2026-01-01T00:00:00Z") },
      },
      ...overrides,
    };
  }

  it("rejects an unknown token without touching the account", async () => {
    ctx.prisma.staffPasswordResetToken.findUnique.mockResolvedValue(null);
    await expect(
      ctx.service.consumeStaffPasswordReset(
        "not-a-real-token-value-000",
        "NewPass123",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
    expect(ctx.prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    ctx.prisma.staffPasswordResetToken.findUnique.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() - 1_000) }),
    );
    await expect(
      ctx.service.consumeStaffPasswordReset(rawToken, "NewPass123"),
    ).rejects.toThrow(/expired/i);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a re-used token", async () => {
    ctx.prisma.staffPasswordResetToken.findUnique.mockResolvedValue(
      tokenRow({ consumedAt: new Date() }),
    );
    await expect(
      ctx.service.consumeStaffPasswordReset(rawToken, "NewPass123"),
    ).rejects.toThrow(/already been used/i);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it("does not update the account when the atomic claim loses a race", async () => {
    ctx.prisma.staffPasswordResetToken.findUnique.mockResolvedValue(tokenRow());
    ctx.prisma.staffPasswordResetToken.updateMany.mockResolvedValue({
      count: 0,
    });
    await expect(
      ctx.service.consumeStaffPasswordReset(rawToken, "NewPass123"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.user.update).not.toHaveBeenCalled();
  });

  it(
    "sets new password hash, consumes token, revokes sessions, and preserves TOTP",
    { timeout: 15000 },
    async () => {
      ctx.prisma.staffPasswordResetToken.findUnique.mockResolvedValue(
        tokenRow(),
      );
      ctx.prisma.staffPasswordResetToken.updateMany.mockResolvedValue({
        count: 1,
      });
      ctx.prisma.user.update.mockResolvedValue({});
      ctx.prisma.session.updateMany.mockResolvedValue({ count: 2 });

      await ctx.service.consumeStaffPasswordReset(
        rawToken,
        "NewPass123",
        "10.0.0.9",
      );

      const stored = ctx.prisma.user.update.mock.calls[0][0].data.passwordHash;
      expect(stored).not.toBe("NewPass123");
      expect(await bcrypt.compare("NewPass123", stored)).toBe(true);
      // Only password hash updated (TOTP fields untouched by this flow)
      expect(Object.keys(ctx.prisma.user.update.mock.calls[0][0].data)).toEqual(
        ["passwordHash"],
      );

      const claim =
        ctx.prisma.staffPasswordResetToken.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({
        id: "srt_1",
        consumedAt: null,
        revokedAt: null,
      });
      expect(claim.data.consumedAt).toBeInstanceOf(Date);

      expect(ctx.prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "staff_target", revokedAt: null },
        }),
      );

      const audit = ctx.prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe("staff.password_reset_completed");
      expect(audit.after.totpPreserved).toBe(true);
      expect(audit.after.sessionsRevoked).toBe(true);
      expect(JSON.stringify(audit)).not.toContain(rawToken);
      expect(JSON.stringify(audit)).not.toContain("NewPass123");
    },
  );

  it("rejects weak passwords before consuming a token", async () => {
    await expect(
      ctx.service.consumeStaffPasswordReset(rawToken, "short"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      ctx.prisma.staffPasswordResetToken.findUnique,
    ).not.toHaveBeenCalled();
  });
});
