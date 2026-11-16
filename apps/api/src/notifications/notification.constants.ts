export const NOTIFICATION_CATEGORIES = [
  "request_updates",
  "delivery_updates",
  "system",
  "legacy",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_AUDIENCES = ["customer", "admin"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export function assertCategory(category: string): NotificationCategory {
  if ((NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
    return category as NotificationCategory;
  }
  throw new Error(`Unsupported notification category: ${category}`);
}
