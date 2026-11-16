import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

export type PushApplication = "web" | "admin";
export type PushUserType = "customer" | "admin";

export interface RegisterSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  deviceLabel?: string | null;
}

function deriveApp(userKind: string): { application: PushApplication; userType: PushUserType } {
  if (userKind === "staff") return { application: "admin", userType: "admin" };
  return { application: "web", userType: "customer" };
}

function validateInput(input: RegisterSubscriptionInput): void {
  if (!input || typeof input.endpoint !== "string" || !input.endpoint.startsWith("https://")) {
    throw new BadRequestException("A valid HTTPS push endpoint is required.");
  }
  if (input.endpoint.length > 2048) throw new BadRequestException("Endpoint is too long.");
  const p256dh = input.keys?.p256dh;
  const auth = input.keys?.auth;
  if (typeof p256dh !== "string" || p256dh.length < 16 || p256dh.length > 4096) {
    throw new BadRequestException("Invalid push subscription key (p256dh).");
  }
  if (typeof auth !== "string" || auth.length < 8 || auth.length > 4096) {
    throw new BadRequestException("Invalid push subscription key (auth).");
  }
  if (input.deviceLabel != null && String(input.deviceLabel).length > 120) {
    throw new BadRequestException("deviceLabel is too long.");
  }
}

@Injectable()
export class PushSubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  async register(userId: string, userKind: string, input: RegisterSubscriptionInput) {
    validateInput(input);
    const { application, userType } = deriveApp(userKind);
    const endpoint = input.endpoint.trim();
    const expirationTime =
      typeof input.expirationTime === "number" && Number.isFinite(input.expirationTime)
        ? new Date(input.expirationTime)
        : null;
    const deviceLabel = input.deviceLabel ? String(input.deviceLabel).slice(0, 120) : null;

    const existing = await this.prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (existing) {
      if (existing.userId !== userId) {
        // Never allow claiming another user's subscription endpoint.
        throw new ForbiddenException("Push subscription endpoint is not available.");
      }
      if (existing.application !== application || existing.userType !== userType) {
        throw new ForbiddenException("Push subscription application mismatch.");
      }
      const updated = await this.prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationTime,
          deviceLabel,
          isActive: true,
          lastSeenAt: new Date(),
          failureCount: 0,
          lastFailureReason: null,
        },
      });
      return this.serialize(updated);
    }

    try {
      const created = await this.prisma.pushSubscription.create({
        data: {
          userId,
          userType,
          application,
          endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationTime,
          deviceLabel,
          isActive: true,
          lastSeenAt: new Date(),
        },
      });
      return this.serialize(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Race on endpoint uniqueness
        throw new ForbiddenException("Push subscription could not be registered.");
      }
      throw e;
    }
  }

  async listMine(userId: string, userKind: string) {
    const { application } = deriveApp(userKind);
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId, application },
      orderBy: { createdAt: "desc" },
    });
    return { items: rows.map((r) => this.serialize(r)) };
  }

  async unsubscribe(userId: string, userKind: string, input: { id?: string; endpoint?: string }) {
    const { application } = deriveApp(userKind);
    const id = typeof input.id === "string" ? input.id : undefined;
    const endpoint = typeof input.endpoint === "string" ? input.endpoint : undefined;
    if (!id && !endpoint) throw new BadRequestException("Subscription id or endpoint is required.");

    const where = id ? { id } : { endpoint: endpoint! };
    const sub = await this.prisma.pushSubscription.findUnique({ where: where as any });
    if (!sub || sub.userId !== userId || sub.application !== application) {
      // Idempotent/safe response: do not leak existence across users/apps
      return { ok: true, removed: false };
    }

    await this.prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { isActive: false, lastSeenAt: new Date(), lastFailureReason: "unsubscribed" },
    });
    return { ok: true, removed: true };
  }

  async deactivateByEndpoint(endpoint: string, reason: string): Promise<void> {
    await this.prisma.pushSubscription.updateMany({
      where: { endpoint },
      data: { isActive: false, lastFailureReason: reason, lastFailureAt: new Date() },
    });
  }

  /** Never expose p256dh/auth/endpoint secrets broadly in logs; endpoint returned to owner only. */
  private serialize(s: {
    id: string;
    userId: string;
    userType: string;
    application: string;
    endpoint: string;
    expirationTime: Date | null;
    deviceLabel: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastSeenAt: Date | null;
    lastSuccessAt: Date | null;
  }) {
    return {
      id: s.id,
      application: s.application,
      userType: s.userType,
      endpoint: s.endpoint, // owner-only response; needed for client unsubscribe matching
      expirationTime: s.expirationTime?.toISOString() ?? null,
      deviceLabel: s.deviceLabel,
      isActive: s.isActive,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    };
  }
}
