-- Notification system foundation (Phase 1, additive).
-- Extends Notification/NotificationOutbox for deterministic idempotency and
-- push-delivery intents (Option B: no new in_app delivery jobs post-cutover),
-- and adds NotificationPreference/PushSubscription. Preserves existing data.

-- Notification: additive columns + safe defaults/backfill
ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "recipientType" TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "sourceEventKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "relatedEntityType" TEXT,
  ADD COLUMN IF NOT EXISTS "relatedEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "actionUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill legacy sourceEventKey deterministically (unique per row)
UPDATE "Notification"
SET "sourceEventKey" = 'legacy:notification:' || "id"
WHERE "sourceEventKey" = '';

-- Enforce non-empty sourceEventKey for all rows (including future inserts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_sourceEventKey_not_empty_chk'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_sourceEventKey_not_empty_chk"
      CHECK (char_length("sourceEventKey") > 0);
  END IF;
END $$;

ALTER TABLE "Notification" ALTER COLUMN "sourceEventKey" DROP DEFAULT;

-- Backfill recipientType from user kind where possible
UPDATE "Notification" n
SET "recipientType" = CASE WHEN u."kind" = 'staff' THEN 'admin_owner' ELSE 'customer' END
FROM "User" u
WHERE n."userId" = u."id" AND n."recipientType" = 'customer';

-- NotificationOutbox: additive columns for notification-linked async delivery
ALTER TABLE "NotificationOutbox"
  ADD COLUMN IF NOT EXISTS "notificationId" TEXT,
  ADD COLUMN IF NOT EXISTS "eventId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

-- Push subscriptions (per user/app/device)
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "application" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "expirationTime" TIMESTAMP(3),
  "deviceLabel" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastFailureAt" TIMESTAMP(3),
  "lastFailureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_application_isActive_idx" ON "PushSubscription"("userId", "application", "isActive");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_createdAt_idx" ON "PushSubscription"("userId", "createdAt");

-- Notification preferences (push opt-in; essential in-app history not user-disableable in MVP)
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_category_key" ON "NotificationPreference"("userId", "category");
CREATE INDEX IF NOT EXISTS "NotificationPreference_userId_userType_idx" ON "NotificationPreference"("userId", "userType");

-- Indexes/uniques
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_sourceEventKey_key" ON "Notification"("userId", "sourceEventKey");
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "Notification_relatedEntityType_relatedEntityId_idx" ON "Notification"("relatedEntityType", "relatedEntityId");

CREATE INDEX IF NOT EXISTS "NotificationOutbox_notificationId_channel_idx" ON "NotificationOutbox"("notificationId", "channel");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_recipientUserId_createdAt_idx" ON "NotificationOutbox"("recipientUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_subscriptionId_idx" ON "NotificationOutbox"("subscriptionId");

-- Foreign keys (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationOutbox_notificationId_fkey') THEN
    ALTER TABLE "NotificationOutbox"
      ADD CONSTRAINT "NotificationOutbox_notificationId_fkey"
      FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationOutbox_subscriptionId_fkey') THEN
    ALTER TABLE "NotificationOutbox"
      ADD CONSTRAINT "NotificationOutbox_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscription_userId_fkey') THEN
    ALTER TABLE "PushSubscription"
      ADD CONSTRAINT "PushSubscription_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationPreference_userId_fkey') THEN
    ALTER TABLE "NotificationPreference"
      ADD CONSTRAINT "NotificationPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Ensure Notification.userId FK has cascade behavior aligned with schema (recreate if different)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
    ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";
  END IF;
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
