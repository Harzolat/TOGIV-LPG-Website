import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import webpush, { type PushSubscription as WebPushSubscription, WebPushError } from "web-push";
import { getVapidConfig } from "./push-config";

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private configured = false;

  constructor(private readonly prisma: PrismaClient) {}

  isConfigured(): boolean {
    return Boolean(getVapidConfig());
  }

  private ensureConfigured(): boolean {
    const cfg = getVapidConfig();
    if (!cfg) return false;
    if (!this.configured) {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
      this.configured = true;
    }
    return true;
  }

  async sendToSubscription(
    subscription: {
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    },
    payload: PushPayload,
  ): Promise<{ ok: true; statusCode?: number } | { ok: false; terminal: boolean; statusCode?: number; error: string }> {
    if (!this.ensureConfigured()) {
      return { ok: false, terminal: false, error: "vapid_not_configured" };
    }

    const sub: WebPushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };

    try {
      const res = await webpush.sendNotification(sub, JSON.stringify(payload), {
        TTL: 60 * 60, // 1 hour
        urgency: "normal",
      });
      await this.prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: {
          lastSuccessAt: new Date(),
          failureCount: 0,
          lastFailureReason: null,
          isActive: true,
        },
      }).catch(() => undefined);
      return { ok: true, statusCode: res.statusCode };
    } catch (err) {
      const info = this.classifyError(err);
      await this.handleFailure(subscription.id, info).catch(() => undefined);
      return { ok: false, ...info };
    }
  }

  private classifyError(err: unknown): { terminal: boolean; statusCode?: number; error: string } {
    if (err instanceof WebPushError) {
      const status = err.statusCode;
      // 404/410: subscription gone; 401/403: invalid keys/auth for endpoint (treat as terminal)
      if (status === 404 || status === 410) {
        return { terminal: true, statusCode: status, error: `subscription_gone_${status}` };
      }
      if (status === 401 || status === 403) {
        return { terminal: true, statusCode: status, error: `push_unauthorized_${status}` };
      }
      if (status === 429 || (status >= 500 && status <= 599)) {
        return { terminal: false, statusCode: status, error: `push_retryable_${status}` };
      }
      return { terminal: status >= 400 && status < 500, statusCode: status, error: `push_error_${status}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { terminal: false, error: msg.slice(0, 200) };
  }

  private async handleFailure(subscriptionId: string, info: { terminal: boolean; error: string }): Promise<void> {
    if (info.terminal) {
      await this.prisma.pushSubscription.update({
        where: { id: subscriptionId },
        data: {
          isActive: false,
          failureCount: { increment: 1 },
          lastFailureAt: new Date(),
          lastFailureReason: info.error,
        },
      });
      this.logger.warn(`Deactivated push subscription ${subscriptionId}: ${info.error}`);
      return;
    }
    await this.prisma.pushSubscription.update({
      where: { id: subscriptionId },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: new Date(),
        lastFailureReason: info.error,
      },
    });
  }
}
