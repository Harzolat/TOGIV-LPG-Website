import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  assertCategory,
  NOTIFICATION_CATEGORIES,
  type NotificationAudience,
} from "./notification.constants";

export interface NotificationListQuery {
  limit?: number;
  page?: number;
  unreadOnly?: boolean;
}

function clampLimit(value?: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return 20;
  return Math.min(Math.floor(value), 100);
}

function clampPage(value?: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return 1;
  return Math.floor(value);
}

function audienceForUserKind(kind: string): NotificationAudience {
  return kind === "staff" ? "admin" : "customer";
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser(
    userId: string,
    userKind: string,
    audience: NotificationAudience | undefined,
    query: NotificationListQuery,
  ) {
    const effectiveAudience = audience ?? audienceForUserKind(userKind);
    this.assertAudienceMatch(userKind, effectiveAudience);

    const limit = clampLimit(query.limit);
    const page = clampPage(query.page);
    const skip = (page - 1) * limit;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      items: items.map((n) => this.serialize(n)),
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      unreadCount,
    };
  }

  async unreadCount(userId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unreadCount };
  }

  async markRead(userId: string, notificationId: string) {
    const existing = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true, readAt: true },
    });
    if (!existing) throw new NotFoundException("Notification not found.");
    if (existing.userId !== userId) {
      throw new ForbiddenException("Notification access denied.");
    }
    if (existing.readAt) {
      const current = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
      return this.serialize(current!);
    }
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    return this.serialize(updated);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getPreferences(userId: string, userKind: string, audience?: NotificationAudience) {
    const effectiveAudience = audience ?? audienceForUserKind(userKind);
    this.assertAudienceMatch(userKind, effectiveAudience);

    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, userType: effectiveAudience },
    });
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    const categories = NOTIFICATION_CATEGORIES.filter((c) => c !== "legacy");

    return {
      userType: effectiveAudience,
      items: categories.map((category) => {
        const row = byCategory.get(category);
        return {
          category,
          pushEnabled: row?.pushEnabled ?? false, // explicit opt-in default
          inAppEnabled: true, // essential in-app history not user-disableable
          updatedAt: row?.updatedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async updatePreference(
    userId: string,
    userKind: string,
    audience: NotificationAudience | undefined,
    input: { category: string; pushEnabled: boolean },
  ) {
    const effectiveAudience = audience ?? audienceForUserKind(userKind);
    this.assertAudienceMatch(userKind, effectiveAudience);

    if (typeof input.pushEnabled !== "boolean") {
      throw new BadRequestException("pushEnabled must be a boolean.");
    }
    const category = assertCategory(input.category);
    if (category === "legacy") {
      throw new BadRequestException("Legacy category preferences cannot be modified.");
    }

    const saved = await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      create: {
        userId,
        userType: effectiveAudience,
        category,
        pushEnabled: input.pushEnabled,
      },
      update: {
        userType: effectiveAudience,
        pushEnabled: input.pushEnabled,
      },
    });

    return {
      category: saved.category,
      pushEnabled: saved.pushEnabled,
      inAppEnabled: true,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  private assertAudienceMatch(userKind: string, audience: NotificationAudience): void {
    const expected = audienceForUserKind(userKind);
    if (expected !== audience) {
      throw new ForbiddenException("Notification audience mismatch.");
    }
  }

  private serialize(n: {
    id: string;
    userId: string;
    recipientType: string;
    type: string;
    category: string;
    sourceEventKey: string;
    title: string;
    body: string;
    data: unknown;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    actionUrl: string | null;
    readAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: n.id,
      recipientType: n.recipientType,
      type: n.type,
      category: n.category,
      title: n.title,
      body: n.body,
      data: n.data ?? null,
      relatedEntityType: n.relatedEntityType,
      relatedEntityId: n.relatedEntityId,
      actionUrl: n.actionUrl,
      isRead: Boolean(n.readAt),
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    };
  }
}
