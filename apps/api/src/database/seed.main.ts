import dotenv from "dotenv";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { normalizeNgPhone } from "../common/phone";
import { ensureSuperAdmin, seedRbac } from "./seed-rbac";

/**
 * Database seed CLI — RBAC matrix (§1.3) + optional first super admin.
 *
 *   pnpm --filter @togi/api db:seed
 *
 * Environment (apps/api/.env):
 *   SEED_SUPER_ADMIN_PHONE     required to create the first super admin
 *   SEED_SUPER_ADMIN_PASSWORD  initial password (staff then enrolls TOTP on
 *                              first login; password is never overwritten
 *                              on re-runs)
 *   SEED_SUPER_ADMIN_EMAIL     optional — email login for the console
 *   SEED_SUPER_ADMIN_NAME      optional display name
 */

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/togiv_lpg?schema=public",
  });
  const prisma = new PrismaClient({ adapter });

  await seedRbac(prisma);
  console.log("RBAC matrix seeded (roles + permissions, idempotent).");

  const phone = process.env.SEED_SUPER_ADMIN_PHONE;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;

  if (phone && password) {
    let normalized: string;
    try {
      normalized = normalizeNgPhone(phone);
    } catch {
      normalized = phone; // allow non-NG test numbers; login matches exactly
    }
    await ensureSuperAdmin(
      prisma,
      normalized,
      process.env.SEED_SUPER_ADMIN_NAME ?? "Super Administrator",
      password,
      email,
    );
    console.log(
      `Super admin ready → login with ${email ?? normalized} (TOTP enrollment on first login).`,
    );
  } else {
    console.log(
      "Skipped super admin: set SEED_SUPER_ADMIN_PHONE + SEED_SUPER_ADMIN_PASSWORD to create one.",
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
