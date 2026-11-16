import dotenv from "dotenv";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  applyStaffAuthenticatorReset,
  applyStaffPasswordReset,
  findStaffByIdentifier,
} from "../auth/staff-recovery";

/**
 * BREAK-GLASS STAFF RECOVERY — server-side only.
 *
 * For the initial administrator (or any staff member) who cannot reach the
 * admin console. This never runs through the public HTTP API and never
 * exposes a fixed recovery secret.
 *
 * Usage (Render Shell / one-off job, or locally):
 *
 *   ADMIN_RECOVERY_IDENTIFIER="owner@example.com" \
 *   ADMIN_RECOVERY_CONFIRM=yes \
 *   pnpm --filter @togi/api db:admin-recovery
 *
 * Optional:
 *   ADMIN_RECOVERY_ACTION=password        (default) replace password with a
 *                                         one-time temporary password
 *   ADMIN_RECOVERY_ACTION=authenticator   clear TOTP enrollment only
 *
 * Password recovery preserves the TOTP secret. Authenticator recovery
 * preserves the password. They are deliberately never combined.
 *
 * Output is written to the operator's terminal once and is never logged by
 * the application. The command requires DB credentials, which the host
 * already holds.
 */

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

async function main(): Promise<void> {
  const identifier = process.env.ADMIN_RECOVERY_IDENTIFIER?.trim();
  const action = (process.env.ADMIN_RECOVERY_ACTION ?? "password").trim();
  const confirmed = process.env.ADMIN_RECOVERY_CONFIRM === "yes";

  if (!confirmed) {
    throw new Error(
      "Refusing to run without ADMIN_RECOVERY_CONFIRM=yes (explicit confirmation).",
    );
  }
  if (!identifier) {
    throw new Error(
      "Set ADMIN_RECOVERY_IDENTIFIER to the staff member's email or phone number.",
    );
  }
  if (action !== "password" && action !== "authenticator") {
    throw new Error('ADMIN_RECOVERY_ACTION must be "password" or "authenticator".');
  }

  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/togiv_lpg?schema=public";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const staff = await findStaffByIdentifier(prisma, identifier);
    if (!staff) {
      throw new Error("No active staff account matches that identifier.");
    }

    if (action === "password") {
      const result = await applyStaffPasswordReset(
        prisma,
        staff.id,
        null,
        "break_glass",
      );
      console.log("");
      console.log("PASSWORD RESET COMPLETE (break-glass)");
      console.log(`  Staff:  ${result.email ?? result.phone}`);
      console.log(`  Temp:   ${result.temporaryPassword}`);
      console.log(
        `  TOTP:   ${result.totpEnrolled ? "unchanged — still required at sign-in" : "not enrolled"}`,
      );
      console.log(
        "  Action: all existing sessions were revoked. Share the temporary",
      );
      console.log(
        "          password privately; the staff member changes it in Settings.",
      );
      console.log("");
    } else {
      const result = await applyStaffAuthenticatorReset(
        prisma,
        staff.id,
        null,
        "break_glass",
      );
      console.log("");
      console.log("AUTHENTICATOR RESET COMPLETE (break-glass)");
      console.log(`  Staff:    ${result.email ?? result.phone}`);
      console.log("  Password: unchanged");
      console.log(
        "  Next:     sign in with the current password and re-enroll TOTP.",
      );
      console.log("");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    `Recovery failed: ${err instanceof Error ? err.message : "unknown error"}`,
  );
  process.exit(1);
});
