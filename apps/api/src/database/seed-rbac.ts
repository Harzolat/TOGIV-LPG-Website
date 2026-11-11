import { PrismaClient } from "@prisma/client";

/**
 * RBAC seed — permission matrix per approved planning document v1.2 §1.3.
 * Idempotent: upserts roles/permissions; safe to re-run.
 */

const PERMISSIONS = [
  // staff management (super_admin only)
  "staff:manage",
  // business configuration
  "settings:read",
  "settings:write",
  // customers
  "customer:view_all",
  "customer:view_scoped",
  "customer:edit",
  "customer:suspend",
  "customer:export",
  // requests
  "request:view_all",
  "request:view_scoped",
  "request:assign",
  "request:update_status",
  "request:notes",
  "request:reply",
  // claims
  "claim:view",
  "claim:decide",
  // cylinders + QR
  "cylinder:manage",
  "qr:manage",
  "qr:analytics",
  // deliveries
  "delivery:view_all",
  "delivery:assign",
  "delivery:update_own",
  // reports + audit
  "report:operational",
  "audit:view",
] as const;

/** Matrix from v1.2 §1.3 (with v1.2 amendments). */
const ROLE_PERMISSIONS: Record<string, (typeof PERMISSIONS)[number][]> = {
  super_admin: [...PERMISSIONS],
  admin: [
    "settings:read",
    "settings:write",
    "customer:view_all",
    "customer:edit",
    "customer:suspend",
    "customer:export",
    "request:view_all",
    "request:assign",
    "request:update_status",
    "request:notes",
    "request:reply",
    "claim:view",
    "claim:decide",
    "cylinder:manage",
    "qr:manage",
    "qr:analytics",
    "delivery:view_all",
    "delivery:assign",
    "delivery:update_own",
    "report:operational",
  ],
  agent: [
    "settings:read",
    "customer:view_scoped",
    "customer:edit", // limited: contact preferences only — enforced in service
    "request:view_all",
    "request:update_status", // permitted statuses only — matrix-enforced
    "request:notes",
    "request:reply",
    "claim:view",
    "report:operational", // own queue metrics only — scoped in service
  ],
  delivery: [
    // v1.2 §1.3: only own assigned deliveries, minimum necessary data
    "delivery:update_own",
  ],
  customer: [
    // customers act on their own records via ownership checks, not permissions
  ],
};

export async function seedRbac(prisma: PrismaClient): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  const labels: Record<string, string> = {
    super_admin: "Super Administrator",
    admin: "Administrator",
    agent: "Customer Service Agent",
    delivery: "Delivery Personnel",
    customer: "Customer",
  };

  for (const [roleKey, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { label: labels[roleKey] },
      create: { key: roleKey, label: labels[roleKey] },
    });

    const rows = await prisma.permission.findMany({
      where: { key: { in: perms } },
      select: { id: true },
    });

    for (const p of rows) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        update: {},
        create: { roleId: role.id, permissionId: p.id },
      });
    }
  }
}

/** Bootstrap the first super admin (called from a CLI script with env vars). */
export async function ensureSuperAdmin(
  prisma: PrismaClient,
  phone: string,
  fullName: string,
  password?: string,
  email?: string,
): Promise<void> {
  const role = await prisma.role.findUnique({ where: { key: "super_admin" } });
  if (!role) throw new Error("Run seedRbac first.");

  // phone is unique only among non-deleted rows (partial index), so upsert
  // on phone isn't available — find the live row or create a new one.
  const identified = { kind: "staff" as const, status: "active" as const, ...(email ? { email } : {}) };
  const current = await prisma.user.findFirst({ where: { phone, deletedAt: null } });
  const user = current
    ? await prisma.user.update({ where: { id: current.id }, data: identified })
    : await prisma.user.create({ data: { phone, ...identified } });

  // Initial password (staff auth = password + TOTP per §12). Only set when
  // provided — re-runs never overwrite an existing password.
  if (password) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });
  }

  await prisma.staffProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, fullName },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
}
