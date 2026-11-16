import { Injectable, Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type NotificationAudience = "customer" | "admin";

export interface CreateNotificationInput {
  userId: string;
  recipientType: "customer" | "admin_owner";
  type: string;
  category: "request_updates" | "delivery_updates" | "system";
  sourceEventKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  actionUrl?: string | null;
  push?: boolean; // enqueue push intents if preference/allows
}

function safeString(value: string | null | undefined, max = 240): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(private readonly prisma: PrismaClient) {}

  async getOwnerAdminRecipients(db: DbClient = this.prisma): Promise<string[]> {
    const users = await db.user.findMany({
      where: {
        kind: "staff",
        status: "active",
        deletedAt: null,
        roles: { some: { role: { key: "super_admin" } } },
      },
      select: { id: true },
    });
    if (users.length === 0) {
      this.logger.warn("No eligible active super_admin owner recipients found for admin notification.");
    } else if (users.length > 1) {
      this.logger.warn(`Multiple eligible super_admin owner recipients found (${users.length}); notifying all.`);
    }
    return users.map((u) => u.id);
  }

  /** Resolve owning customer userId for a service request (trusted server-side). */
  async resolveCustomerUserIdForRequest(
    db: DbClient,
    requestId: string,
  ): Promise<string | null> {
    const req = await db.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        customerId: true,
        customer: { select: { userId: true, user: { select: { status: true, deletedAt: true, kind: true } } } },
      },
    });
    if (!req?.customerId || !req.customer?.userId) return null;
    const u = req.customer.user;
    if (!u || u.kind !== "customer" || u.status !== "active" || u.deletedAt) return null;
    return req.customer.userId;
  }

  /** Resolve owning customer userId for a delivery (trusted server-side). */
  async resolveCustomerUserIdForDelivery(
    db: DbClient,
    deliveryId: string,
  ): Promise<string | null> {
    const delivery = await db.delivery.findUnique({
      where: { id: deliveryId },
      select: { requestId: true },
    });
    if (!delivery) return null;
    return this.resolveCustomerUserIdForRequest(db, delivery.requestId);
  }

  /**
   * Create persistent notification idempotently and enqueue push outbox intents.
   * Safe to call inside a business transaction (pass tx).
   */
  async createNotification(db: DbClient, input: CreateNotificationInput): Promise<{ created: boolean; id: string | null }> {
    const sourceEventKey = input.sourceEventKey?.trim();
    if (!sourceEventKey) {
      throw new Error("sourceEventKey is required and must not be empty");
    }

    const existing = await db.notification.findUnique({
      where: { userId_sourceEventKey: { userId: input.userId, sourceEventKey } },
      select: { id: true },
    });
    if (existing) {
      return { created: false, id: existing.id };
    }

    try {
      const notification = await db.notification.create({
        data: {
          userId: input.userId,
          recipientType: input.recipientType,
          type: input.type,
          category: input.category,
          sourceEventKey,
          title: input.title,
          body: input.body,
          data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
          relatedEntityType: safeString(input.relatedEntityType),
          relatedEntityId: safeString(input.relatedEntityId),
          actionUrl: safeString(input.actionUrl),
        },
      });

      if (input.push !== false) {
        await this.enqueuePushIntents(db, {
          notificationId: notification.id,
          userId: input.userId,
          category: input.category,
          sourceEventKey,
          eventType: input.type,
          payload: {
            title: input.title,
            body: input.body,
            url: notification.actionUrl,
            notificationId: notification.id,
            type: input.type,
          },
        });
      }

      return { created: true, id: notification.id };
    } catch (e) {
      // Unique race: treat as idempotent no-op
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const found = await db.notification.findUnique({
          where: { userId_sourceEventKey: { userId: input.userId, sourceEventKey } },
          select: { id: true },
        });
        return { created: false, id: found?.id ?? null };
      }
      throw e;
    }
  }

  private async enqueuePushIntents(
    db: DbClient,
    args: {
      notificationId: string;
      userId: string;
      category: "request_updates" | "delivery_updates" | "system";
      sourceEventKey: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    // Check push preference (default false = explicit opt-in required)
    const pref = await db.notificationPreference.findUnique({
      where: { userId_category: { userId: args.userId, category: args.category } },
      select: { pushEnabled: true },
    });
    if (!pref?.pushEnabled) return;

    const subs = await db.pushSubscription.findMany({
      where: { userId: args.userId, isActive: true },
      select: { id: true, application: true },
    });
    if (subs.length === 0) return;

    for (const sub of subs) {
      const dedupeKey = `push:${args.sourceEventKey}:${sub.id}`;
      try {
        await db.notificationOutbox.create({
          data: {
            notificationId: args.notificationId,
            eventType: args.eventType,
            eventId: args.sourceEventKey,
            channel: "push",
            recipientUserId: args.userId,
            subscriptionId: sub.id,
            payload: {
              ...args.payload,
              application: sub.application,
            } as Prisma.InputJsonValue,
            status: "pending",
            dedupeKey,
          },
        });
      } catch (e) {
        // Dedupe unique constraint => intent already exists (idempotent)
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          continue;
        }
        throw e;
      }
    }
  }

  // --- Event helpers (business-event aware) ---

  async emitRequestSubmitted(db: DbClient, args: {
    requestId: string;
    reference: string;
    type: string;
    customerId: string | null; // CustomerProfile id
    submittedByCustomerUserId: string | null;
  }): Promise<void> {
    const sourceEventKey = `request:${args.requestId}:submitted`;

    // Customer notification (if submitted by/for an authenticated customer account)
    if (args.submittedByCustomerUserId && args.customerId) {
      await this.createNotification(db, {
        userId: args.submittedByCustomerUserId,
        recipientType: "customer",
        type: "request.submitted",
        category: "request_updates",
        sourceEventKey,
        title: "Refill request submitted",
        body: `Your refill request ${args.reference} has been submitted.`,
        data: { requestId: args.requestId, reference: args.reference, status: "Submitted" },
        relatedEntityType: "service_request",
        relatedEntityId: args.requestId,
        actionUrl: `/account/requests/${args.requestId}`,
      });
    }

    // Admin/owner notification (new customer refill request submitted)
    if (args.type === "refill") {
      const owners = await this.getOwnerAdminRecipients(db);
      for (const ownerId of owners) {
        await this.createNotification(db, {
          userId: ownerId,
          recipientType: "admin_owner",
          type: "request.submitted",
          category: "request_updates",
          sourceEventKey, // same business event key, different recipient (unique per user)
          title: "New refill request",
          body: `New refill request ${args.reference} submitted.`,
          data: { requestId: args.requestId, reference: args.reference, status: "Submitted" },
          relatedEntityType: "service_request",
          relatedEntityId: args.requestId,
          actionUrl: `/requests/${args.requestId}`,
        });
      }
    }
  }

  customerCopyForStatus(to: string): { title: string; body: string } | null {
    switch (to) {
      case "Submitted":
        return { title: "Request submitted", body: "Your refill request has been submitted." };
      case "Accepted":
        return { title: "Request accepted", body: "Your refill request has been accepted." };
      case "Rejected":
        return { title: "Request update", body: "Your refill request could not be completed." };
      case "Processing":
        return { title: "Request in progress", body: "Your refill request is being processed." };
      case "Dispatched":
        return { title: "Team en route", body: "Your refill request is on the way." };
      case "Completed":
      case "Resolved":
        return { title: "Request completed", body: "Your refill request has been completed." };
      case "Cancelled":
        return { title: "Request cancelled", body: "Your refill request has been cancelled." };
      default:
        return null; // not an approved customer push/status event
    }
  }

  async emitRequestStatusChanged(db: DbClient, args: {
    requestId: string;
    reference: string;
    fromStatus: string;
    toStatus: string;
    historyId: string; // actual RequestStatusHistory.id (deterministic event identity)
    visibleToCustomer: boolean;
    actorKind: string;
  }): Promise<void> {
    const sourceEventKey = `request_status:${args.historyId}`;
    const copy = this.customerCopyForStatus(args.toStatus);

    // Customer notification: only approved, customer-visible events and resolvable recipient
    if (copy && args.visibleToCustomer) {
      const customerUserId = await this.resolveCustomerUserIdForRequest(db, args.requestId);
      if (customerUserId) {
        await this.createNotification(db, {
          userId: customerUserId,
          recipientType: "customer",
          type: "request.status_changed",
          category: "request_updates",
          sourceEventKey,
          title: copy.title,
          body: copy.body.includes(args.reference) ? copy.body : `${copy.body}`,
          data: {
            requestId: args.requestId,
            reference: args.reference,
            fromStatus: args.fromStatus,
            toStatus: args.toStatus,
          },
          relatedEntityType: "service_request",
          relatedEntityId: args.requestId,
          actionUrl: `/account/requests/${args.requestId}`,
        });
      }
    }

    // Admin operational updates (owner recipients) for relevant transitions
    if (["Submitted", "Accepted", "Processing", "Dispatched", "Completed", "Resolved", "Rejected", "Cancelled"].includes(args.toStatus)) {
      const owners = await this.getOwnerAdminRecipients(db);
      const adminBody = `Request ${args.reference} moved to ${args.toStatus.replace(/([a-z])([A-Z])/g, "$1 $2")}.`;
      for (const ownerId of owners) {
        await this.createNotification(db, {
          userId: ownerId,
          recipientType: "admin_owner",
          type: "request.status_changed",
          category: "request_updates",
          sourceEventKey,
          title: "Request update",
          body: adminBody,
          data: {
            requestId: args.requestId,
            reference: args.reference,
            fromStatus: args.fromStatus,
            toStatus: args.toStatus,
          },
          relatedEntityType: "service_request",
          relatedEntityId: args.requestId,
          actionUrl: `/requests/${args.requestId}`,
        });
      }
    }
  }
}
