import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { RequireAudience, RequirePermission } from "../auth/auth.guard";
import { QrService } from "./qr.service";

/**
 * QR endpoints — v1.2 §1.4.1:
 * - Public resolution is PII-free (capacity/serial only) and identification-only
 * - Batch generation and lifecycle actions require staff + qr:manage
 */

const batchSchema = z.object({
  count: z.number().int().min(1).max(500),
  batchId: z
    .string()
    .regex(/^[A-Za-z0-9-]{3,40}$/, "Alphanumeric batch id, 3-40 chars"),
});

const statusSchema = z.object({
  reason: z.string().max(500).optional(),
});

const assignSchema = z.object({
  cylinderId: z.string().min(1),
});

@Controller("qr")
export class QrController {
  constructor(private readonly qr: QrService) {}

  /** Public: resolve an opaque QR token → identification context, no PII. */
  @Get("resolve/:token")
  async resolve(@Param("token") token: string) {
    // Basic shape gate before hashing (URLs carry base64url 128-bit tokens)
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
      return { outcome: "invalid", context: { kind: "unrecognized" } };
    }
    return this.qr.resolve(token);
  }

  /** Staff: printable sticker batch. Raw tokens returned once, never stored. */
  @Post("batch")
  @RequireAudience("admin")
  @RequirePermission("qr:manage")
  async batch(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = batchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid payload.");
    const items = await this.qr.generateBatch(parsed.data.count, parsed.data.batchId);
    return {
      batchId: parsed.data.batchId,
      count: items.length,
      stickers: items, // [{ token, serial }] — print now; token never retrievable later
      note: "Raw tokens are shown once. Losing them means regenerating the batch.",
      actor: req.user?.id,
    };
  }

  /** Staff: attach + activate a sticker on a cylinder (service registration). */
  @Post(":id/activate")
  @RequireAudience("admin")
  @RequirePermission("qr:manage")
  async activate(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("cylinderId is required.");
    await this.qr.assignAndActivate(id, parsed.data.cylinderId, req.user!.id);
    return { ok: true };
  }

  /** Staff: deactivated | reactivated | revoked — audited, never deletes. */
  @Post(":id/status")
  @RequireAudience("admin")
  @RequirePermission("qr:manage")
  async setStatus(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = z
      .object({ event: z.enum(["deactivated", "reactivated", "revoked"]) })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("event must be deactivated|reactivated|revoked.");
    const withReason = statusSchema.safeParse(body);
    await this.qr.setStatus(id, parsed.data.event, req.user!.id, withReason.success ? withReason.data.reason : undefined);
    return { ok: true };
  }
}
