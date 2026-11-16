import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationService } from "./notification.service";

type MockPrisma = {
  $transaction: ReturnType<typeof vi.fn>;
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  notificationPreference: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

function makeNotification(overrides: Partial<any> = {}) {
  const now = new Date("2026-11-16T10:00:00.000Z");
  return {
    id: "n1",
    userId: "u1",
    recipientType: "customer",
    type: "request.submitted",
    category: "request_updates",
    sourceEventKey: "request:req1:submitted",
    title: "Title",
    body: "Body",
    data: { requestId: "req1" },
    relatedEntityType: "request",
    relatedEntityId: "req1",
    actionUrl: "/requests/req1",
    readAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("NotificationService", () => {
  let prisma: MockPrisma;
  let service: NotificationService;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
      notification: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      notificationPreference: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
    };
    service = new NotificationService(prisma as any);
  });

  it("lists notifications for owner with pagination and unread count", async () => {
    prisma.notification.findMany.mockResolvedValue([makeNotification()]);
    prisma.notification.count
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(1); // unread

    const result = await service.listForUser("u1", "customer", "customer", {
      page: 1,
      limit: 20,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        skip: 0,
        take: 20,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].isRead).toBe(false);
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
    expect(result.unreadCount).toBe(1);
  });

  it("filters unread-only notifications", async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await service.listForUser("u1", "customer", undefined, { unreadOnly: true });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", readAt: null } }),
    );
  });

  it("returns unread count for owner", async () => {
    prisma.notification.count.mockResolvedValue(3);
    await expect(service.unreadCount("u1")).resolves.toEqual({ unreadCount: 3 });
  });

  it("marks a notification as read for owner and is idempotent", async () => {
    prisma.notification.findUnique
      .mockResolvedValueOnce({ id: "n1", userId: "u1", readAt: null })
      .mockResolvedValueOnce(makeNotification({ readAt: null }));
    prisma.notification.update.mockResolvedValue(
      makeNotification({ readAt: new Date("2026-11-16T11:00:00.000Z") }),
    );

    const result = await service.markRead("u1", "n1");
    expect(prisma.notification.update).toHaveBeenCalled();
    expect(result.isRead).toBe(true);
  });

  it("rejects mark-read for non-owner (ownership isolation)", async () => {
    prisma.notification.findUnique.mockResolvedValue({
      id: "n1",
      userId: "other",
      readAt: null,
    });
    await expect(service.markRead("u1", "n1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("throws not found for missing notification", async () => {
    prisma.notification.findUnique.mockResolvedValue(null);
    await expect(service.markRead("u1", "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("marks all notifications as read for owner", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });
    await expect(service.markAllRead("u1")).resolves.toEqual({ updated: 4 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("returns preference defaults with pushEnabled=false and inApp always enabled", async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    const prefs = await service.getPreferences("u1", "customer", "customer");
    expect(prefs.userType).toBe("customer");
    expect(prefs.items.length).toBeGreaterThan(0);
    expect(prefs.items.every((i: any) => i.pushEnabled === false)).toBe(true);
    expect(prefs.items.every((i: any) => i.inAppEnabled === true)).toBe(true);
  });

  it("updates preference via upsert (customer/admin audience isolation by user kind)", async () => {
    prisma.notificationPreference.upsert.mockResolvedValue({
      category: "request_updates",
      pushEnabled: true,
      updatedAt: new Date("2026-11-16T11:00:00.000Z"),
    });

    const result = await service.updatePreference("staff1", "staff", "admin", {
      category: "request_updates",
      pushEnabled: true,
    });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "staff1",
          userType: "admin",
          category: "request_updates",
          pushEnabled: true,
        }),
      }),
    );
    expect(result).toMatchObject({ category: "request_updates", pushEnabled: true, inAppEnabled: true });
  });

  it("rejects audience mismatch (customer user cannot access admin audience)", async () => {
    await expect(
      service.getPreferences("u1", "customer", "admin"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects invalid/legacy preference category updates", async () => {
    await expect(
      service.updatePreference("u1", "customer", "customer", {
        category: "legacy",
        pushEnabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
