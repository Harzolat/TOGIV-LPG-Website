-- Allow reusing phone/email credentials from soft-deleted accounts for new accounts.
-- Active (non-deleted) accounts must still have unique credentials.
--
-- Normalize legacy/full-unique indexes that block reuse after soft-delete.
DROP INDEX IF EXISTS "User_phone_key";
DROP INDEX IF EXISTS "users_phone_key";
DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_email_lower_key";

-- Phone: unique among non-deleted accounts only.
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_active_key"
  ON "User" ("phone")
  WHERE "deletedAt" IS NULL;

-- Email: case-insensitive unique among non-deleted accounts only.
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_active_key"
  ON "User" (lower("email"))
  WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;
