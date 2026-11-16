-- Staff password reset tokens (operator-authorized, manual identity verification).
--
-- Additive and non-destructive: creates a table for single-use, short-lived
-- staff/admin password reset tokens issued by an authorized operator after
-- out-of-band identity verification. Raw tokens are never stored (SHA-256 hash
-- only). Redeeming sets a new password chosen by the staff member while
-- preserving TOTP enrollment.

CREATE TABLE IF NOT EXISTS "StaffPasswordResetToken" (
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
  CONSTRAINT "StaffPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffPasswordResetToken_tokenHash_key"
  ON "StaffPasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "StaffPasswordResetToken_userId_createdAt_idx"
  ON "StaffPasswordResetToken"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "StaffPasswordResetToken_expiresAt_idx"
  ON "StaffPasswordResetToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "StaffPasswordResetToken_createdAt_idx"
  ON "StaffPasswordResetToken"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StaffPasswordResetToken_userId_fkey'
  ) THEN
    ALTER TABLE "StaffPasswordResetToken"
      ADD CONSTRAINT "StaffPasswordResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
