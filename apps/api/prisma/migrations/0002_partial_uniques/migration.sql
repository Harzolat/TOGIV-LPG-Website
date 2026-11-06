-- Partial unique indexes not expressible in Prisma schema (v1.2.4 plan):
--
-- 1) One phone = one identity across customer AND staff, while soft-deleted
--    accounts release their number (retention/purge policy).
CREATE UNIQUE INDEX "users_phone_active_key"
  ON "users" ("phone")
  WHERE "deletedAt" IS NULL;

-- (Prisma also creates a plain UNIQUE on users.phone; drop it so soft-deleted
--  rows don't block re-registration of the same number after purge.)
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_key";

-- 2) Exactly one ACTIVE QR sticker per cylinder. Replaced/deactivated/revoked
--    states keep their cylinder_id for history but don't hold the slot.
CREATE UNIQUE INDEX "qr_code_state_active_cylinder_key"
  ON "qr_code_state" ("cylinderId")
  WHERE "currentState" = 'active' AND "cylinderId" IS NOT NULL;

-- 3) At most ONE active delivery attempt per refill (v1.2.4 §A1.4 rule 3).
--    Failed/Delivered attempts keep full history without blocking retries.
CREATE UNIQUE INDEX "deliveries_active_attempt_per_request_key"
  ON "deliveries" ("requestId")
  WHERE "status" NOT IN ('Delivered', 'Failed');

-- 4) At most ONE active public status link per request; revoked/regenerated
--    links are preserved as historical rows (v1.2 §1.4.3).
CREATE UNIQUE INDEX "request_status_link_active_per_request_key"
  ON "request_status_links" ("requestId")
  WHERE "status" = 'active';
