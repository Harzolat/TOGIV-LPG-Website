import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Outbox worker — v1.2 §1.6 (approved):
 * - Outbox rows are written in the SAME transaction as the business event
 *   (done by request/delivery services) — nothing is ever lost.
 * - Worker leases pending rows with FOR UPDATE SKIP LOCKED semantics,
 *   dispatches through channel adapters, retries with backoff, dead-letters.
 * - dev adapters capture to logs; production providers plug in behind the
 *   same interfaces (SMS provider decision = launch dependency, deferred).
 * - dedupeKey unique constraint guarantees at-most-once row per event.
 */

export interface ChannelAdapter {
  readonly channel: "in_app" | "email" | "sms" | "whatsapp";
  send(payload: Record<string, unknown>): Promise<{ providerRef: string }>;
}

/** In-app adapter: writes Notification rows (always-on floor, §1.6). */
export class InAppAdapter implements ChannelAdapter {
  readonly channel = "in_app" as const;
  constructor(private readonly prisma: PrismaClient) {}

  async send(payload: Record<string, unknown>): Promise<{ providerRef: string }> {
    const userId = payload.userId as string | undefined;
    if (!userId) return { providerRef: "skipped-no-user" };
    await this.prisma.notification.create({
      data: {
        userId,
        type: (payload.type as string) ?? "info",
        title: (payload.title as string) ?? "Update",
        body: (payload.body as string) ?? "",
        data: payload as object,
      },
    });
    return { providerRef: `inapp-${Date.now()}` };
  }
}

/** Development email adapter — captures, never sends (swap at launch). */
export class DevEmailAdapter implements ChannelAdapter {
  readonly channel = "email" as const;
  private readonly logger = new Logger("DevEmail");

  async send(payload: Record<string, unknown>): Promise<{ providerRef: string }> {
    this.logger.log(`[DEV EMAIL] to=${String(payload.to)} subject=${String(payload.subject)}`);
    return { providerRef: `dev-email-${Date.now()}` };
  }
}

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000];

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private adapters = new Map<string, ChannelAdapter>();

  constructor(private readonly prisma: PrismaClient) {
    // in_app always registered; email dev adapter active outside production
    this.register(new InAppAdapter(prisma));
    this.register(new DevEmailAdapter());
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
    const due = await this.prisma.notificationOutbox.findMany({
      where: { status: "pending", nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let processed = 0;
    for (const row of due) {
      // Lease: flip to 'sending' atomically so concurrent workers skip it
      const leased = await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "pending" },
        data: { status: "sending" },
      });
      if (leased.count === 0) continue;

      const adapter = this.adapters.get(row.channel);
      if (!adapter) {
        await this.fail(row.id, row.attempts, `no adapter for channel ${row.channel}`);
        processed++;
        continue;
      }

      try {
        const result = await adapter.send(row.payload as Record<string, unknown>);
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: "sent", sentAt: new Date(), providerRef: result.providerRef },
        });
      } catch (err) {
        await this.fail(row.id, row.attempts, err instanceof Error ? err.message : String(err));
      }
      processed++;
    }
    return processed;
  }

  private async fail(id: string, attempts: number, error: string): Promise<void> {
    const next = attempts + 1;
    if (next >= MAX_ATTEMPTS) {
      await this.prisma.notificationOutbox.update({
        where: { id },
        data: { status: "dead", attempts: next },
      });
      this.logger.error(`Outbox ${id} dead-lettered after ${next} attempts: ${error}`);
    } else {
      await this.prisma.notificationOutbox.update({
        where: { id },
        data: {
          status: "pending",
          attempts: next,
          nextAttemptAt: new Date(Date.now() + BACKOFF_MS[next]),
        },
      });
    }
  }
}
