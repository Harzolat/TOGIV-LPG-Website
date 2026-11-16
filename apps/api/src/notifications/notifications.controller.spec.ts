import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsController } from "./notifications.controller";

describe("NotificationsController", () => {
  let service: any;
  let controller: NotificationsController;

  beforeEach(() => {
    service = {
      listForUser: vi.fn().mockResolvedValue({ items: [], pagination: {}, unreadCount: 0 }),
      unreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
      markRead: vi.fn().mockResolvedValue({ id: "n1", isRead: true }),
      markAllRead: vi.fn().mockResolvedValue({ updated: 1 }),
      getPreferences: vi.fn().mockResolvedValue({ userType: "customer", items: [] }),
      updatePreference: vi.fn().mockResolvedValue({ category: "system", pushEnabled: true, inAppEnabled: true }),
    };
    controller = new NotificationsController(service);
  });

  it("rejects unauthenticated requests", async () => {
    await expect(controller.list({} as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.unreadCount({} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lists notifications for authenticated user (ownership scoped by service)", async () => {
    await controller.list({ user: { id: "u1", kind: "customer" } } as any, "2", "10", "true");
    expect(service.listForUser).toHaveBeenCalledWith("u1", "customer", undefined, {
      page: 2,
      limit: 10,
      unreadOnly: true,
    });
  });

  it("updates preference for authenticated admin user", async () => {
    await controller.updatePreference(
      { user: { id: "s1", kind: "staff" } } as any,
      { category: "system", pushEnabled: true },
    );
    expect(service.updatePreference).toHaveBeenCalledWith("s1", "staff", undefined, {
      category: "system",
      pushEnabled: true,
    });
  });
});
