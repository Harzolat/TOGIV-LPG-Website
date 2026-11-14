import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { RequireAudience, RequirePermission } from "../auth/auth.guard";
import { ensureCustomerProfile } from "../auth/customer-profile";
import { ClaimService, ClaimStateError } from "./claim.service";

/**
 * Cylinder claim endpoints — v1.2 §1.4.1 / v1.2.2 A2:
 * - Submission is customer-facing and immutable once written
 * - Decisions require claim:decide (admin/super_admin per §1.3)
 * - Auto-approve (register_new only) is config-gated, default OFF; when it
 *   fires it goes through the same service path with actor = system
 */

const submitSchema = z.object({
  claimType: z.enum(["register_new", "dispute_existing"]),
  qrSerial: z.string().min(3).max(64).optional(),
  qrCodeId: z.string().min(1).optional(),
  cylinderId: z.string().min(1).optional(),
  evidenceNote: z.string().min(10).max(2000),
  evidenceAttachmentIds: z.array(z.string()).max(10).optional(),
});

const decideSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(1000).optional(),
});

const reasonSchema = z.object({ reason: z.string().min(3).max(1000) });

@Controller("claims")
export class ClaimsController {
  constructor(
    private readonly claims: ClaimService,
    private readonly prisma: PrismaClient,
  ) {}

  /** Customer submits a claim (session-bound; guests must register first). */
  @Post()
  @RequireAudience("customer")
  async submit(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, kind: true, status: true, deletedAt: true },
    });
    if (!user || user.kind !== "customer" || user.status !== "active" || user.deletedAt) {
      throw new ForbiddenException("Account unavailable.");
    }
    const customerId = await ensureCustomerProfile(this.prisma, req.user!.id);
    const d = parsed.data;

    // Resolve QR by serial when the sticker reference (not id) was scanned
    let qrCodeId: string | null = d.qrCodeId ?? null;
    let cylinderId: string | null = d.cylinderId ?? null;
    if (!qrCodeId && d.qrSerial) {
      const qr = await this.prisma.qrCode.findUnique({
        where: { serial: d.qrSerial },
        include: { state: true },
      });
      if (qr) {
        qrCodeId = qr.id;
        if (qr.state?.cylinderId) cylinderId = qr.state.cylinderId;
      }
      // Unknown serial: claim proceeds — staff resolve it during review
    }

    const result = await this.claims.submit({
      claimType: d.claimType,
      claimedByCustomerId: customerId,
      qrCodeId,
      cylinderId,
      evidenceNote: d.evidenceNote,
      evidenceAttachmentIds: d.evidenceAttachmentIds,
      linkReviewRequired: d.claimType === "dispute_existing" || !cylinderId,
    });

    // Config-gated auto-approve: register_new only, flag default OFF (§1.4.1).
    if (d.claimType === "register_new" && (await this.claims.isAutoApproveEnabled())) {
      await this.claims.decide(result.id, "approved", {
        userId: req.user!.id,
        role: "admin",
      }, { note: "Auto-approved by configuration (service registration only)." });
    }

    return { id: result.id, state: result.state };
  }

  /** Customer's own claims. */
  @Get("mine")
  @RequireAudience("customer")
  async mine(@Req() req: AuthedRequest) {
    const customerId = await ensureCustomerProfile(this.prisma, req.user!.id);
    const rows = await this.prisma.cylinderClaim.findMany({
      where: { claimedByCustomerId: customerId },
      orderBy: { createdAt: "desc" },
      include: { state: true, cylinder: { select: { serial: true, label: true } }, qrCode: { select: { serial: true } } },
      take: 100,
    });
    return { claims: rows };
  }

  /** Staff review queue. */
  @Get()
  @RequireAudience("admin")
  @RequirePermission("claim:view")
  async list(@Req() req: AuthedRequest) {
    void req;
    const rows = await this.prisma.cylinderClaim.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        state: true,
        claimant: { select: { id: true, fullName: true } },
        cylinder: { select: { serial: true, label: true } },
        qrCode: { select: { serial: true } },
      },
      take: 100,
    });
    return { claims: rows };
  }

  /** Detail + full append-only event history (review screen). */
  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: AuthedRequest) {
    const history = await this.claims.history(id);
    const staff = (req.userRoles ?? []).some((r) =>
      ["super_admin", "admin", "agent"].includes(r),
    );
    if (!staff) {
      if (!req.user) throw new ForbiddenException("Authentication required.");
      const customerId = await ensureCustomerProfile(this.prisma, req.user.id);
      if (history.claimedByCustomerId !== customerId) {
        throw new ForbiddenException("You may only view your own claims.");
      }
    }
    return history;
  }

  /** Staff: review started — state stays pending (A2.6). */
  @Post(":id/acknowledge")
  @RequireAudience("admin")
  @RequirePermission("claim:decide")
  async acknowledge(@Param("id") id: string, @Req() req: AuthedRequest) {
    try {
      await this.claims.acknowledge(id, req.user!.id);
    } catch (e) {
      if (e instanceof ClaimStateError) throw new BadRequestException(e.message);
      throw e;
    }
    return { ok: true };
  }

  /** Staff: approve/reject. Permission enforced by guard. */
  @Post(":id/decide")
  @RequireAudience("admin")
  @RequirePermission("claim:decide")
  async decide(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = decideSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid decision payload.");

    const role = (req.userRoles ?? []).includes("super_admin")
      ? ("super_admin" as const)
      : ("admin" as const);

    try {
      await this.claims.decide(
        id,
        parsed.data.decision,
        { userId: req.user!.id, role },
        { note: parsed.data.note },
      );
    } catch (e) {
      if (e instanceof ClaimStateError) throw new BadRequestException(e.message);
      throw e;
    }
    return { ok: true, state: parsed.data.decision };
  }

  /** Staff: reopen a rejected claim → back to pending, history preserved (A2.7). */
  @Post(":id/reopen")
  @RequireAudience("admin")
  @RequirePermission("claim:decide")
  async reopen(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = reasonSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("A reason is required.");
    try {
      await this.claims.reopen(
        id,
        { userId: req.user!.id, role: req.userRoles?.join(",") ?? "staff" },
        parsed.data.reason,
      );
    } catch (e) {
      if (e instanceof ClaimStateError) throw new BadRequestException(e.message);
      throw e;
    }
    return { ok: true };
  }

  /** Withdraw — claimant (pending, own) or staff with reason (A2.8). */
  @Post(":id/withdraw")
  async withdraw(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = reasonSchema.partial().safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("Invalid payload.");

    if (!req.user) throw new ForbiddenException("Authentication required.");
    const staff = (req.userRoles ?? []).some((r) =>
      ["super_admin", "admin", "agent"].includes(r),
    );

    try {
      await this.claims.withdraw(
        id,
        staff
          ? { userId: req.user.id, kind: "staff" }
          : { userId: await ensureCustomerProfile(this.prisma, req.user.id), kind: "customer" },
        { reason: parsed.data.reason },
      );
    } catch (e) {
      if (e instanceof ClaimStateError) throw new BadRequestException(e.message);
      throw e;
    }
    return { ok: true };
  }
}
