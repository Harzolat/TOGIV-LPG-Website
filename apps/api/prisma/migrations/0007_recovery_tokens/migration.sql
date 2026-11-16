-- Account recovery support.
--
-- Additive and non-destructive: one new table for operator-authorized
-- customer PIN reset tokens, plus a default business-contact configuration
-- row used by the public recovery pages.
--
-- Raw reset tokens are never stored: only a SHA-256 hash is persisted.
-- Existing rows are preserved; the config insert is a no-op when the
-- operator has already provisioned "company.contact".

CREATE TABLE IF NOT EXISTS "PinResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "ip" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PinResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PinResetToken_tokenHash_key"
  ON "PinResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PinResetToken_userId_createdAt_idx"
  ON "PinResetToken"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PinResetToken_expiresAt_idx"
  ON "PinResetToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "PinResetToken_createdAt_idx"
  ON "PinResetToken"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PinResetToken_userId_fkey'
  ) THEN
    ALTER TABLE "PinResetToken"
      ADD CONSTRAINT "PinResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Published business contacts already shown on the customer site
-- (Layout footer / Safety page). Stored as editable configuration so the
-- recovery pages never hardcode a phone number. The operator can change
-- these values in the database without a code change.
INSERT INTO "BusinessSetting" ("id", "key", "value", "scope", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'company.contact',
  '{"company":"Throne of Grace Integrated Ventures","phone":"09013198496","altPhone":"08061265486"}'::jsonb,
  'global',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
