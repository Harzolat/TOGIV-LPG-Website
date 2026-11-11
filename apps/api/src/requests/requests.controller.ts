import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
  Query,
  Req,
} from "@nestjs/common";
import { PrismaClient, RequestType } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { RequireAudience, RequirePermission } from "../auth/auth.guard";
import { sessionCookieName } from "../auth/cookie-names";
import { ensureCustomerProfile } from "../auth/customer-profile";
import { SessionService } from "../auth/session.service";
import { TransitionError } from "@togi/shared";
import { RequestService } from "./request.service";
import {
  cancelSchema,
  linkConfirmSchema,
  submitRequestSchema,
  transitionSchema,
} from "./dto";

/**
 * Request endpoints — v1.2 §1.4.2 (single source of truth):
 *
 * - POST /requests: guest OR authenticated; guests get a one-time status link,
 *   no user row, no silent account creation
 * - GET  /requests/track/:token: public, minimal PII-free payload
 * - GET  /requests/mine: customer's own requests (audience-bound)
 * - GET  /requests: staff queue (request:view_all permission)
 * - GET  /requests/:id: owner or staff (ownership/permission enforced here)
 * - POST /requests/:id/transition: staff matrix transitions
 * - POST /requests/:id/cancel: customer self-cancellation (pre-acceptance only)
 * - POST /requests/link/*: guest → account linking by CONFIRMATION only
 */

const STAFF_ROLES = new Set(["super_admin", "admin", "agent"]);

function isStaff(req: AuthedRequest): boolean {
  return (req.userRoles ?? []).some((r) => STAFF_ROLES.has(r));
}

@Controller("requests")
export class RequestsController {
  constructor(
    private readonly requests: RequestService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaClient,
  ) {}

  /** Submit — authenticated session picked up when a cookie is present. */
  @Post()
  async submit(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = submitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }

    // Optional session: attach to the customer's profile when present.
    let customerId: string | null = null;
    let requestedById: string | null = null;
    const token =
      (req as AuthedRequest & { cookies?: Record<string, string> }).cookies?.[
        sessionCookieName("customer")
      ];
    if (token) {
      try {
        const user = await this.sessions.resolve(token, "customer");
        requestedById = user.id;
        customerId = await ensureCustomerProfile(this.prisma, user.id);
      } catch {
        // Expired/invalid session → still accepted as a guest submission
      }
    }

    const dto = parsed.data;

    // Inline home-delivery address:
    // - authenticated → promote to a CustomerAddress row (reusable)
    // - guest → snapshot into the payload (no profile → no address row)
    let addressId: string | null = "addressId" in dto ? (dto.addressId ?? null) : null;
    const payload: Record<string, unknown> = { ...dto.payload };
    if ("address" in dto && dto.address) {
      if (customerId) {
        const existing = await this.prisma.customerAddress.count({
          where: { customerId, deletedAt: null },
        });
        const address = await this.prisma.customerAddress.create({
          data: {
            customerId,
            label: dto.address.label ?? "Home",
            line1: dto.address.line1,
            line2: dto.address.line2 ?? null,
            city: dto.address.city,
            state: dto.address.state,
            lga: dto.address.lga,
            deliveryNote: dto.address.deliveryNote ?? null,
            isDefault: existing === 0,
          },
        });
        addressId = address.id;
      } else {
        payload.address = dto.address;
      }
    }

    const result = await this.requests.submit({
      type: dto.type as RequestType,
      contactPhone: dto.contactPhone,
      customerId,
      requestedById,
      submittedVia: customerId ? "web" : "guest",
      payload,
      addressId,
      deliveryMethod: "deliveryMethod" in dto ? dto.deliveryMethod : null,
      zoneId: "zoneId" in dto ? (dto.zoneId ?? null) : null,
      cylinderId: "payload" in dto && "cylinderId" in dto.payload ? (dto.payload.cylinderId ?? null) : null,
    });

    // Guests: one-time tracking link (raw token returned exactly once)
    if (result.statusLinkToken) {
      return {
        reference: result.reference,
        trackingPath: `/track/${result.statusLinkToken}`,
        message:
          "Save this link to track your request. You can also register your phone number to see all your requests in one place.",
      };
    }
    return { reference: result.reference };
  }

  /** Public tracking — minimal payload, no PII (v1.2 §1.4.3). */
  @Get("track/:token")
  async track(@Param("token") token: string) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
      throw new NotFoundException("Invalid or expired link.");
    }
    const payload = await this.requests.resolveStatusLink(token);
    if (!payload) throw new NotFoundException("Invalid or expired link.");
    return payload;
  }

  /** Customer's own requests — newest first. */
  @Get("mine")
  @RequireAudience("customer")
  async mine(@Req() req: AuthedRequest) {
    const customerId = await ensureCustomerProfile(this.prisma, req.user!.id);
    const rows = await this.prisma.serviceRequest.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        deliveryMethod: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
      take: 100,
    });
    return { requests: rows };
  }

  /** Staff queue. */
  @Get()
  @RequireAudience("admin")
  @RequirePermission("request:view_all")
  async list(@Query() query: Record<string, string | undefined>) {
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.type ? { type: query.type as RequestType } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        contactPhone: true,
        createdAt: true,
        updatedAt: true,
        retryCount: true,
        customer: { select: { id: true, fullName: true } },
      },
      take: 100,
    });
    return { requests: rows };
  }

  /**
   * Detail — owner or staff. Staff see full context; owners never see
   * internal notes (filter applied below).
   */
  @Get(":id")
  async detail(@Param("id") id: string, @Req() req: AuthedRequest) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        statusHistory: { orderBy: { createdAt: "asc" } },
        messages: { orderBy: { createdAt: "asc" } },
        attachments: { orderBy: { createdAt: "asc" } },
        deliveries: {
          orderBy: { attemptNumber: "asc" },
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            failureReason: true,
            scheduledDate: true,
            windowLabel: true,
            createdAt: true,
          },
        },
        address: true,
        customer: { select: { id: true, fullName: true } },
      },
    });
    if (!request || request.deletedAt) throw new NotFoundException("Request not found.");

    const staff = isStaff(req);
    if (!staff) {
      if (!req.user) throw new ForbiddenException("Authentication required.");
      const profileId = await ensureCustomerProfile(this.prisma, req.user.id);
      if (request.customerId !== profileId) {
        throw new ForbiddenException("You may only view your own requests.");
      }
    }

    return {
      ...request,
      messages: request.messages.filter((m) => staff || !m.internal),
      // Customers never receive: linkedByUserId internals or contactPhone of others
      contactPhone: undefined,
    };
  }

  /** Staff matrix transition — server validates against Part 4 matrices. */
  @Post(":id/transition")
  @RequireAudience("admin")
  @RequirePermission("request:update_status")
  async transition(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    try {
      await this.requests.transition(
        id,
        parsed.data.to,
        { kind: "staff", userId: req.user!.id },
        { reason: parsed.data.reason, note: parsed.data.note, visibleToCustomer: true },
      );
    } catch (e) {
      if (e instanceof TransitionError) throw new BadRequestException(e.message);
      throw e;
    }
    return { ok: true, status: parsed.data.to };
  }

  /** Customer self-cancellation — window enforced by the matrix. */
  @Post(":id/cancel")
  @RequireAudience("customer")
  async cancel(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid payload.");

    const profileId = await ensureCustomerProfile(this.prisma, req.user!.id);
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      select: { id: true, customerId: true },
    });
    if (!request) throw new NotFoundException("Request not found.");
    if (request.customerId !== profileId) {
      throw new ForbiddenException("You may only cancel your own requests.");
    }

    try {
      await this.requests.transition(
        id,
        "Cancelled",
        { kind: "customer", userId: req.user!.id },
        { reason: parsed.data.reason, visibleToCustomer: true },
      );
    } catch (e) {
      if (e instanceof TransitionError) throw new BadRequestException(e.message);
      throw e;
    }
    return { ok: true };
  }

  /** Guest candidates after OTP-verified session — surfaced for CONFIRMATION. */
  @Post("link/candidates")
  @RequireAudience("customer")
  async linkCandidates(@Req() req: AuthedRequest) {
    const candidates = await this.requests.findLinkCandidates(req.user!.phone);
    return { candidates };
  }

  /** Confirmed linking — explicit selection only, audited, never silent. */
  @Post("link/confirm")
  @RequireAudience("customer")
  async linkConfirm(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = linkConfirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Select at least one request to link.");
    }
    const customerId = await ensureCustomerProfile(this.prisma, req.user!.id);
    const linked = await this.requests.linkConfirmed(parsed.data.requestIds, customerId, {
      userId: req.user!.id,
      kind: "customer",
    });
    return { linked };
  }
}
