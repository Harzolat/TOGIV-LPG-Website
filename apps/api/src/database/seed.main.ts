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
 *   SEED_SUPER_ADMIN_EMAIL     required to create the first super admin (email login)
 *   SEED_SUPER_ADMIN_PASSWORD  initial password
 *   SEED_SUPER_ADMIN_PHONE     optional contact number
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

  const contactPhone = process.env.BUSINESS_CONTACT_PHONE?.trim();
  if (contactPhone) {
    await prisma.businessSetting.upsert({
      where: { key: "company.contact" },
      update: {},
      create: {
        key: "company.contact",
        value: {
          company:
            process.env.BUSINESS_CONTACT_COMPANY?.trim() ??
            "Throne of Grace Integrated Ventures",
          phone: contactPhone,
          altPhone: process.env.BUSINESS_CONTACT_PHONE_ALT?.trim() ?? null,
        },
      },
    });
    console.log("Business recovery contact configuration present.");
  }

  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const phoneRaw = process.env.SEED_SUPER_ADMIN_PHONE?.trim();

  let phone: string | null = null;
  if (phoneRaw) {
    try {
      phone = normalizeNgPhone(phoneRaw);
    } catch {
      phone = phoneRaw; // allow non-NG/test numbers
    }
  }

  if (email && password) {
    await ensureSuperAdmin(
      prisma,
      email,
      process.env.SEED_SUPER_ADMIN_NAME ?? "Super Administrator",
      password,
      phone,
    );
    console.log(`Super admin ready → login with ${email} (email + password).`);
  } else {
    console.log(
      "Skipped super admin: set SEED_SUPER_ADMIN_EMAIL + SEED_SUPER_ADMIN_PASSWORD to create one.",
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
