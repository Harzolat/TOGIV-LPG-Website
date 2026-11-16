import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { AuthedRequest } from "../../auth/auth.guard";
import { RecoveryThrottle } from "../../auth/recovery-throttle";
import { getPublicVapidKey } from "./push-config";
import { PushSubscriptionService, type RegisterSubscriptionInput } from "./push-subscription.service";

function requireUser(req: AuthedRequest) {
  if (!req.user) throw new ForbiddenException("Authentication required.");
  return req.user;
}

function clientKey(req: Request, userId: string): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `pushsub:${ip}:${userId}`;
}

@Controller("notifications/push")
export class PushSubscriptionController {
  constructor(
    private readonly subs: PushSubscriptionService,
    private readonly quota: RecoveryThrottle,
  ) {}

  /** Public VAPID key for the authenticated user's app (safe to expose). */
  @Get("vapid-public-key")
  async vapidPublicKey(@Req() req: AuthedRequest) {
    requireUser(req);
    return { publicKey: getPublicVapidKey(), configured: Boolean(getPublicVapidKey()) };
  }

  @Post("subscriptions")
  async register(@Req() req: AuthedRequest & Request, @Body() body: unknown) {
    const user = requireUser(req);
    const wait = this.quota.hit(clientKey(req, user.id));
    if (wait > 0) throw new BadRequestException("Too many requests. Please try again shortly.");
    if (!body || typeof body !== "object") throw new BadRequestException("Invalid subscription payload.");
    return this.subs.register(user.id, user.kind, body as RegisterSubscriptionInput);
  }

  @Get("subscriptions")
  async list(@Req() req: AuthedRequest) {
    const user = requireUser(req);
    return this.subs.listMine(user.id, user.kind);
  }

  @Post("subscriptions/unsubscribe")
  async unsubscribe(@Req() req: AuthedRequest & Request, @Body() body: unknown) {
    const user = requireUser(req);
    const wait = this.quota.hit(clientKey(req, user.id));
    if (wait > 0) throw new BadRequestException("Too many requests. Please try again shortly.");
    if (!body || typeof body !== "object") throw new BadRequestException("Invalid payload.");
    return this.subs.unsubscribe(user.id, user.kind, body as any);
  }

  @Delete("subscriptions/:id")
  async remove(@Req() req: AuthedRequest & Request, @Param("id") id: string) {
    const user = requireUser(req);
    const wait = this.quota.hit(clientKey(req, user.id));
    if (wait > 0) throw new BadRequestException("Too many requests. Please try again shortly.");
    return this.subs.unsubscribe(user.id, user.kind, { id });
  }
}
