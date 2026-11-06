import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient, Prisma, RequestStatus, RequestType } from "@prisma/client";
import {
  validateTransition,
  type ActorKind,
} from "@togi/shared";
import { generateOpaqueToken, sha256Hex } from "../common/tokens";
import { normalizeNgPhone } from "../common/phone";

/**
 * Request engine — single source of truth `service_requests` (v1.2 §1.4.2).
 *
 * - Guest submissions: customerId = null, contactPhone always present,
 *   no user row created. Linking requires explicit customer confirmation.
 * - Every transition validated against the v1.2.4 Part 4 matrices before write;
 *   status + history written in ONE transaction.
 * - References: RFL/CPL/ENQ-YYYY-NNNNNN, collision-safe in-transaction.
 * - Public status links: opaque hashed tokens, one active per request.
 */

const REFILL_PREFIX = "RFL";
const COMPLAINT_PREFIX = "CPL";
const ENQUIRY_PREFIX = "ENQ";

export interface SubmitRequestInput {
  type: RequestType;
  contactPhone: string; // raw — normalised here
  customerId?: string | null;
  submittedVia?: "qr" | "web" | "guest";
  requestedById?: string | null;
  cylinderId?: string | null;
  addressId?: string | null;
  deliveryMethod?: "home" | "station" | null;
  payload: Record<string, unknown>;
  priceEstimateKobo?: number | null;
  zoneId?: string | null;
}

export interface SubmitResult {
  id: string;
  reference: string;
  statusLinkToken?: string; // raw, returned once (guest requests)
}

@Injectable()
export class RequestService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Creates a request + Submitted history row + (for guests) status link — one transaction. */
  async submit(input: SubmitRequestInput): Promise<SubmitResult> {
    const contactPhone = normalizeNgPhone(input.contactPhone);
    const prefix =
      input.type === "refill"
        ? REFILL_PREFIX
        : input.type === "complaint"
          ? COMPLAINT_PREFIX
          : ENQUIRY_PREFIX;

    return this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx, prefix);

      const request = await tx.serviceRequest.create({
        data: {
          reference,
          type: input.type,
          status: "Submitted",
          customerId: input.customerId ?? null,
          contactPhone,
          submittedVia: input.submittedVia ?? (input.customerId ? "web" : "guest"),
          requestedById: input.requestedById ?? null,
          cylinderId: input.cylinderId ?? null,
          addressId: input.addressId ?? null,
          deliveryMethod: input.deliveryMethod ?? null,
          payload: input.payload as Prisma.InputJsonValue,
          priceEstimateKobo: input.priceEstimateKobo ?? null,
          zoneId: input.zoneId ?? null,
          statusHistory: {
            create: {
              toStatus: "Submitted",
              actorId: input.requestedById ?? null,
              actorKind: input.customerId ? "customer" : "system",
              visibleToCustomer: true,
            },
          },
        },
      });

      let statusLinkToken: string | undefined;
      if (!input.customerId) {
        // Guest: issue a public tracking link (opaque, hashed, revocable)
        statusLinkToken = generateOpaqueToken(16);
        await tx.requestStatusLink.create({
          data: {
            requestId: request.id,
            tokenHash: sha256Hex(statusLinkToken),
            createdBy: null,
          },
        });
      }

      // Outbox: request-submitted notification (in-app; channel fan-out later)
      await tx.notificationOutbox.create({
        data: {
          eventType: "request.submitted",
          payload: { requestId: request.id, reference, type: input.type },
          channel: "in_app",
          dedupeKey: `request.submitted:${request.id}:Submitted`,
        },
      });

      return { id: request.id, reference, statusLinkToken };
    });
  }

  /**
   * Matrix-validated status transition. Actor scoping (customer owns the
   * request, staff permitted) is the caller's guard; this enforces the
   * matrix itself and writes history atomically.
   */
  async transition(
    requestId: string,
    to: RequestStatus,
    actor: { kind: ActorKind; userId?: string | null },
    opts: { reason?: string; note?: string; visibleToCustomer?: boolean } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findUnique({
        where: { id: requestId },
      });
      if (!request) throw new NotFoundException("Request not found.");

      // Matrix validation (throws TransitionError with precise code)
      validateTransition({
        type: request.type,
        from: request.status as RequestStatus,
        to,
        actor: actor.kind,
        reason: opts.reason,
        deliveryLinked: request.deliveryMethod === "home",
      });

      await tx.serviceRequest.update({
        where: { id: requestId },
        data: {
          status: to,
          completedAt:
            to === "Completed" || to === "Resolved" ? new Date() : undefined,
        },
      });

      await tx.requestStatusHistory.create({
        data: {
          requestId,
          fromStatus: request.status as RequestStatus,
          toStatus: to,
          actorId: actor.userId ?? null,
          actorKind: actor.kind,
          note: opts.note ?? opts.reason ?? null,
          visibleToCustomer: opts.visibleToCustomer ?? actor.kind !== "staff",
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventType: "request.status_changed",
          payload: { requestId, reference: request.reference, to },
          channel: "in_app",
          dedupeKey: `request.status:${request.id}:${to}:${Date.now()}`,
        },
      });
    });
  }

  /** Guest-link candidates after OTP verification — surfaced for CONFIRMATION, never auto-linked (v1.2 §1.4.2). */
  async findLinkCandidates(phone: string): Promise<
    Array<{ id: string; reference: string; type: RequestType; createdAt: Date; status: string }>
  > {
    const normalized = normalizeNgPhone(phone);
    return this.prisma.serviceRequest.findMany({
      where: { contactPhone: normalized, customerId: null, deletedAt: null },
      select: { id: true, reference: true, type: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  /**
   * Confirmed linking — explicit customer/staff confirmation only.
   * Transactional + audited. Uncertain cases set linkReviewRequired upstream.
   */
  async linkConfirmed(
    requestIds: string[],
    customerId: string,
    confirmedBy: { userId: string; kind: "customer" | "staff" },
  ): Promise<number> {
    if (requestIds.length === 0) return 0;

    return this.prisma.$transaction(async (tx) => {
      let linked = 0;
      for (const id of requestIds) {
        const updated = await tx.serviceRequest.updateMany({
          where: { id, customerId: null }, // only unlinked guest rows
          data: {
            customerId,
            guestLinkedAt: new Date(),
            linkedByUserId: confirmedBy.userId,
          },
        });
        if (updated.count === 1) {
          linked += 1;
          await tx.auditLog.create({
            data: {
              actorId: confirmedBy.userId,
              action: "request.link_confirmed",
              entityType: "service_request",
              entityId: id,
              after: { customerId, by: confirmedBy.kind },
            },
          });
        }
      }
      return linked;
    });
  }

  /** Resolve a public status link — minimal payload, PII never exposed (v1.2 §1.4.3). */
  async resolveStatusLink(rawToken: string): Promise<{
    reference: string;
    type: RequestType;
    status: string;
    updatedAt: Date;
  } | null> {
    const link = await this.prisma.requestStatusLink.findUnique({
      where: { tokenHash: sha256Hex(rawToken) },
      include: { request: true },
    });

    if (!link || link.status !== "active") return null;
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;

    await this.prisma.requestStatusLink.update({
      where: { id: link.id },
      data: { lastUsedAt: new Date() },
    });

    // Minimal payload — no name, phone, address, cylinder or internal notes
    return {
      reference: link.request.reference,
      type: link.request.type,
      status: link.request.status,
      updatedAt: link.request.updatedAt,
    };
  }

  /** Revocation: marks active link revoked; regeneration inserts a new row (≤1 active via partial unique index). */
  async revokeStatusLink(requestId: string): Promise<void> {
    await this.prisma.requestStatusLink.updateMany({
      where: { requestId, status: "active" },
      data: { status: "revoked", revokedAt: new Date() },
    });
  }

  private async nextReference(
    tx: Prisma.TransactionClient,
    prefix: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const pattern = `${prefix}-${year}-%`;
    const rows = await tx.$queryRaw<Array<{ reference: string }>>`
      SELECT reference FROM "ServiceRequest"
      WHERE reference LIKE ${pattern}
      ORDER BY reference DESC LIMIT 1
    `;
    const last = rows[0]?.reference;
    const seq = last ? Number(last.split("-")[2]) + 1 : 1;
    return `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
  }
}
