import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

describe("Notification foundation (Phase 1)", () => {
  it("migration 0009 is additive and enforces deterministic uniqueness/backfill", () => {
    const sql = readFileSync(
      resolve(root, "prisma/migrations/0009_notification_foundation/migration.sql"),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS \"sourceEventKey\"");
    expect(sql).toContain("UPDATE \"Notification\"");
    expect(sql).toContain("legacy:notification");
    expect(sql).toContain("Notification_userId_sourceEventKey_key");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"NotificationPreference\"");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"PushSubscription\"");
    expect(sql).toContain("PushSubscription_endpoint_key");
    expect(sql).toContain("NotificationOutbox_notificationId_fkey");
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM\s+"Notification"/i);
  });

  it("schema defines Option B/outbox foundation models and indexes", () => {
    const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("model NotificationPreference");
    expect(schema).toContain("model PushSubscription");
    expect(schema).toContain("pushEnabled Boolean  @default(false)");
    expect(schema).toContain("@@unique([userId, sourceEventKey])");
    expect(schema).toContain("@@unique([userId, category])");
    expect(schema).toContain("endpoint          String    @unique");
    expect(schema).toContain("notificationId  String?");
    expect(schema).toContain("subscriptionId  String?");
  });

  it("legacy outbox worker remains compatible (no new in_app business producer required)", () => {
    const worker = readFileSync(
      resolve(root, "src/notifications/outbox.worker.ts"),
      "utf8",
    );
    expect(worker).toContain("Legacy-compatible delivery for existing `in_app` outbox rows");
    expect(worker).toContain("legacy:outbox:");
    expect(worker).toContain("notification.upsert");
  });
});
