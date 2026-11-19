-- Email+password auth: phone becomes optional contact info (login identity moves to email for new flows).
-- Existing active-unique indexes from 0010 remain valid (Postgres unique indexes allow multiple NULLs).

ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- Helpful lookup index for case-insensitive email login/uniqueness checks.
CREATE INDEX IF NOT EXISTS "User_email_lower_idx" ON "User" (lower("email"));
