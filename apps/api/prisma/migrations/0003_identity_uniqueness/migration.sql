-- One credential, one account (product requirement, 2026-11).
--
-- 1) A phone number is reserved for the lifetime of its account row,
--    including while the account is soft-deleted. A hard purge removes the
--    row and therefore frees the number again (the retention policy).
--    This replaces the earlier "active rows only" partial index.
DROP INDEX IF EXISTS "users_phone_active_key";
CREATE UNIQUE INDEX "users_phone_key" ON "User" ("phone");

-- 2) Email is one-per-account and case-insensitive. Normalise existing
--    values first, then enforce it in the database (the application also
--    lower-cases operator input at the seed boundary).
UPDATE "User"
SET "email" = lower(btrim("email"))
WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "User_email_lower_key"
  ON "User" (lower("email"))
  WHERE "email" IS NOT NULL;
