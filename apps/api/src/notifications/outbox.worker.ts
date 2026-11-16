import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { WebPushService } from "./push/web-push.service";

/**
 * Outbox worker.
 *
 * - Legacy-compatible delivery for existing `in_app` outbox rows (trusted
 *   server-side recipient resolution; never marked sent if unresolved).
 * - Option B: async outbox is for push/external delivery intents; no new
 *   in_app delivery jobs should be created post-cutover.
 * - Deterministic dedupeKey is enforced at the DB level; worker is idempotent.
 */

export interface ChannelAdapter {
  readonly channel: "in_app" | "email" | "sms" | "whatsapp" | "push";
  send(
    payload: Record<string, unknown>,
    context: {
      outboxId: string;
      dedupeKey: string;
      eventType: string;
      notificationId?: string | null;
      recipientUserId?: string | null;
      subscriptionId?: string | null;
    },
  ): Promise<{ providerRef: string }>;
}

class TerminalDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalDeliveryError";
  }
}

async function resolveLegacyCustomerUserId(
  prisma: PrismaClient,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const direct = payload.userId;
  if (typeof direct === "string" && direct.length > 0) return direct;

  const requestId = payload.requestId;
  if (typeof requestId === "string" && requestId.length > 0) {
    const req = await prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        customer: { select: { userId: true, user: { select: { status: true, deletedAt: true, kind: true } } } },
      },
    });
    const u = req?.customer?.user;
    if (u && u.kind === "customer" && u.status === "active" && !u.deletedAt) {
      return req!.customer!.userId;
    }
  }
  return null;
}

function legacyCopy(eventType: string, payload: Record<string, unknown>) {
  const ref = typeof payload.reference === "string" ? payload.reference : "your request";
  const to = typeof payload.to === "string" ? payload.to : "";
  if (eventType === "request.submitted") {
    return { title: "Request submitted", body: `Your request ${ref} has been submitted.` };
  }
  if (eventType === "request.status_changed") {
    const map: Record<string, { title: string; body: string }> = {
      Submitted: { title: "Request submitted", body: `Your request ${ref} has been submitted.` },
      Accepted: { title: "Request accepted", body: `Your request ${ref} has been accepted.` },
      Processing: { title: "Request in progress", body: `Your request ${ref} is being processed.` },
      Dispatched: { title: "Team en route", body: `Your request ${ref} is on the way.` },
      Completed: { title: "Request completed", body: `Your request ${ref} has been completed.` },
      Resolved: { title: "Request completed", body: `Your request ${ref} has been completed.` },
      Rejected: { title: "Request update", body: `Your request ${ref} could not be completed.` },
      Cancelled: { title: "Request cancelled", body: `Your request ${ref} has been cancelled.` },
    };
    return map[to] ?? { title: "Request update", body: `Your request ${ref} has an update.` };
  }
  if (eventType === "delivery.failed") {
    return { title: "Request update", body: `There was an update to your request ${ref}.` };
  }
  return { title: "Update", body: `There is an update for ${ref}.` };
}

/** Legacy in-app adapter: idempotent, trusted recipient resolution, no false-success. */
export class InAppAdapter implements ChannelAdapter {
  readonly channel = "in_app" as const;
  constructor(private readonly prisma: PrismaClient) {}

  async send(
    payload: Record<string, unknown>,
    context: { outboxId: string; dedupeKey: string; eventType: string },
  ): Promise<{ providerRef: string }> {
    const userId = await resolveLegacyCustomerUserId(this.prisma, payload);
    if (!userId) {
      throw new TerminalDeliveryError("no_resolvable_customer_recipient");
    }

    const sourceEventKey = `legacy:outbox:${context.dedupeKey || context.outboxId}`;
    const copy = legacyCopy(context.eventType, payload);
    const actionUrl =
      typeof payload.requestId === "string" ? `/account/requests/${payload.requestId}` : null;

    await this.prisma.notification.upsert({
      where: { userId_sourceEventKey: { userId, sourceEventKey } },
      create: {
        userId,
        recipientType: "customer",
        type: context.eventType || "info",
        category: "legacy",
        sourceEventKey,
        title: copy.title,
        body: copy.body,
        data: payload as object,
        relatedEntityType: typeof payload.requestId === "string" ? "service_request" : null,
        relatedEntityId: typeof payload.requestId === "string" ? payload.requestId : null,
        actionUrl,
      },
      update: {}, // idempotent replay: keep existing notification stable
    });

    return { providerRef: `legacy-inapp:${sourceEventKey}` };
  }
}

/** Push adapter: delivers outbox push intents to a specific subscription. */
export class PushAdapter implements ChannelAdapter {
  readonly channel = "push" as const;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly webPush: WebPushService,
  ) {}

  async send(
    payload: Record<string, unknown>,
    context: {
      outboxId: string;
      dedupeKey: string;
      eventType: string;
      notificationId?: string | null;
      subscriptionId?: string | null;
    },
  ): Promise<{ providerRef: string }> {
    if (!this.webPush.isConfigured()) {
      throw new Error("vapid_not_configured");
    }
    if (!context.subscriptionId) {
      throw new TerminalDeliveryError("missing_push_subscription");
    }

    const sub = await this.prisma.pushSubscription.findUnique({
      where: { id: context.subscriptionId },
    });
    if (!sub || !sub.isActive) {
      throw new TerminalDeliveryError("push_subscription_inactive");
    }

    const title = typeof payload.title === "string" ? payload.title : "Throne of Grace";
    const body = typeof payload.body === "string" ? payload.body : "You have a new update.";
    const url = typeof payload.url === "string" ? payload.url : "/";
    const tag =
      typeof context.notificationId === "string"
        ? context.notificationId
        : `outbox:${context.outboxId}`;

    const result = await this.webPush.sendToSubscription(
      { id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body, url, tag, data: { url, notificationId: context.notificationId, type: context.eventType } },
    );

    if (!result.ok) {
      if (result.terminal) throw new TerminalDeliveryError(result.error);
      throw new Error(result.error);
    }
    return { providerRef: `push:${sub.id}:${result.statusCode ?? "ok"}` };
  }
}

/** Development email adapter — captures, never sends (swap at launch). */
export class DevEmailAdapter implements ChannelAdapter {
  readonly channel = "email" as const;
  private readonly logger = new Logger("DevEmail");

  async send(payload: Record<string, unknown>): Promise<{ providerRef: string }> {
    this.logger.log(
      `[DEV EMAIL] to=${String(payload.to ?? "")} subject=${String(payload.subject ?? "")}`,
    );
    return { providerRef: `dev-email-${Date.now()}` };
  }
}

const DEFAULT_MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 60 * 60_000];

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private adapters = new Map<string, ChannelAdapter>();

  constructor(
    private readonly prisma: PrismaClient,
    webPush: WebPushService,
  ) {
    // Legacy in_app compatibility + dev adapters + push delivery.
    this.register(new InAppAdapter(prisma));
    this.register(new DevEmailAdapter());
    this.register(new PushAdapter(prisma, webPush));
  }

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  start(intervalMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Process one batch of due pending rows. Safe to call directly in tests. */
  async drain(limit = 50): Promise<number> {
    let due;
    try {
      due = await this.prisma.notificationOutbox.findMany({
        where: { status: "pending", nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
    } catch (err) {
      this.logger.warn(`Outbox drain skipped: ${err instanceof Error ? err.message : err}`);
      return 0;
    }

    let processed = 0;
    for (const row of due) {
      const leased = await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "pending" },
        data: { status: "sending", lastAttemptAt: new Date() },
      });
      if (leased.count === 0) continue;

      const adapter = this.adapters.get(row.channel);
      if (!adapter) {
        await this.fail(row, row.attempts, `no adapter for channel ${row.channel}`, true);
        processed++;
        continue;
      }

      try {
        const result = await adapter.send(row.payload as Record<string, unknown>, {
          outboxId: row.id,
          dedupeKey: row.dedupeKey,
          eventType: row.eventType,
          notificationId: row.notificationId,
          recipientUserId: row.recipientUserId,
          subscriptionId: row.subscriptionId,
        });
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: "sent",
            sentAt: new Date(),
            processedAt: new Date(),
            providerRef: result.providerRef,
            lastError: null,
          },
        });
      } catch (err) {
        const terminal = err instanceof TerminalDeliveryError;
        const message = err instanceof Error ? err.message : String(err);
        await this.fail(row, row.attempts, message, terminal);
      }
      processed++;
    }
    return processed;
  }

  private async fail(
    row: { id: string; maxAttempts?: number | null },
    attempts: number,
    error: string,
    terminal = false,
  ): Promise<void> {
    const maxAttempts = row.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const next = attempts + 1;
    const now = new Date();
    if (terminal || next >= maxAttempts) {
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: "dead",
          attempts: next,
          lastError: error,
          lastAttemptAt: now,
          processedAt: now,
        },
      });
      this.logger.error(`Outbox ${row.id} dead-lettered: ${error}`);
    } else {
      const backoff = BACKOFF_MS[Math.min(next, BACKOFF_MS.length - 1)] ?? 60_000;
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: "pending",
          attempts: next,
          nextAttemptAt: new Date(now.getTime() + backoff),
          lastError: error,
          lastAttemptAt: now,
        },
      });
    }
  }
}
