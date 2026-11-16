import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { NotificationService } from "./notification.service";

function requireUser(req: AuthedRequest) {
  if (!req.user) throw new ForbiddenException("Authentication required.");
  return req.user;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** List notifications for the authenticated user (ownership-isolated). */
  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("unreadOnly") unreadOnly?: string,
  ) {
    const user = requireUser(req);
    const unread = parseBool(unreadOnly);
    return this.notifications.listForUser(user.id, user.kind, undefined, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unread,
    });
  }

  /** Unread count for the authenticated user. */
  @Get("unread-count")
  async unreadCount(@Req() req: AuthedRequest) {
    const user = requireUser(req);
    return this.notifications.unreadCount(user.id);
  }

  /** Mark a single notification as read (owner only). */
  @Patch(":id/read")
  async markRead(@Req() req: AuthedRequest, @Param("id") id: string) {
    const user = requireUser(req);
    return this.notifications.markRead(user.id, id);
  }

  /** Mark all notifications as read for the authenticated user. */
  @Post("read-all")
  async markAllRead(@Req() req: AuthedRequest) {
    const user = requireUser(req);
    return this.notifications.markAllRead(user.id);
  }

  /** Get push notification preferences (defaults to pushEnabled=false). */
  @Get("preferences")
  async getPreferences(@Req() req: AuthedRequest) {
    const user = requireUser(req);
    return this.notifications.getPreferences(user.id, user.kind, undefined);
  }

  /** Update a push notification preference (in-app history not disableable). */
  @Patch("preferences")
  async updatePreference(@Req() req: AuthedRequest, @Body() body: unknown) {
    const user = requireUser(req);
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid preference payload.");
    }
    const { category, pushEnabled } = body as Record<string, unknown>;
    if (typeof category !== "string") {
      throw new BadRequestException("category is required.");
    }
    if (typeof pushEnabled !== "boolean") {
      throw new BadRequestException("pushEnabled must be a boolean.");
    }
    return this.notifications.updatePreference(user.id, user.kind, undefined, {
      category,
      pushEnabled,
    });
  }
}
