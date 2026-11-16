import { api } from "./api";

export interface AppNotification {
  id: string;
  recipientType: string;
  type: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreference {
  category: string;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  updatedAt: string | null;
}

export function getNotifications(params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.limit) q.set("limit", String(params.limit));
  if (params.unreadOnly) q.set("unreadOnly", "true");
  const qs = q.toString();
  return api<{ items: AppNotification[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; unreadCount: number }>(
    `/notifications${qs ? `?${qs}` : ""}`,
  );
}

export function getUnreadCount() {
  return api<{ unreadCount: number }>("/notifications/unread-count");
}

export function markNotificationRead(id: string) {
  return api<AppNotification>(`/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead() {
  return api<{ updated: number }>("/notifications/read-all", { method: "POST" });
}

export function getNotificationPreferences() {
  return api<{ userType: string; items: NotificationPreference[] }>("/notifications/preferences");
}

export function updateNotificationPreference(category: string, pushEnabled: boolean) {
  return api<NotificationPreference>("/notifications/preferences", {
    method: "PATCH",
    body: { category, pushEnabled },
  });
}
