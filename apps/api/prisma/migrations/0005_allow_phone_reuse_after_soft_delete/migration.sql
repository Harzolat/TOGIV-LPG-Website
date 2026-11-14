-- Allow phone number reuse after soft-delete (active/non-deleted accounts only).
-- Replaces the full unique phone index introduced in 0003.
DROP INDEX IF EXISTS "users_phone_key";

CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_active_key"
  ON "User" ("phone")
  WHERE "deletedAt" IS NULL;
