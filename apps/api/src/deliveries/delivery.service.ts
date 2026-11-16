import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient, Prisma, DeliveryStatus } from "@prisma/client";
import {
  canCreateRetry,
  parentEffectFor,
  validateTransition,
} from "@togi/shared";
import { NotificationEventsService } from "../notifications/notification-events.service";

/**
 * Delivery service — v1.2.4 Part 4.4 + §A1 (approved):
 *
 * - One row per ATTEMPT; retries insert new rows (parentDeliveryId chain).
 * - delivery personnel may only update THEIR OWN assigned delivery, and only
 *   the delivery row — parent refill transitions are server-derived inside
 *   the same transaction (never posted by DLV).
 * - Optimistic concurrency: expectedStatus + version → 409 on mismatch.
 * - Idempotency: duplicate updateToken returns current state, no duplicates.
 * - retry_count lives on the PARENT REFILL (single source, §A1.3).
 * - Failed attempts are immutable; new attempt starts AwaitingAssignment (§A1.5).
 */

export const DELIVERY_FAILURE_REASONS = [
  "no_answer",
  "address_not_found",
  "unsafe_location",
  "customer_postponed",
  "vehicle_issue",
  "other",
] as const;
export type FailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

/** Non-retryable reasons block retry creation immediately (§A1.2). */
const NON_RETRYABLE: readonly FailureReason[] = [
  "unsafe_location",
  "customer_postponed",
];

export interface DeliveryUpdateInput {
  deliveryId: string;
  expectedStatus: DeliveryStatus; // optimistic concurrency
  to: DeliveryStatus;
  actor: { kind: "staff" | "delivery" | "system"; userId: string };
  failureReason?: FailureReason;
  addressSnapshot?: Prisma.InputJsonValue;
  /** Idempotency: repeat with same token → current state, no side effects */
  updateToken?: string;
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifications: NotificationEventsService,
  ) {}

  /** Create the delivery for an accepted home-delivery refill (§4.4 created row). */
  async createForRequest(
    requestId: string,
    addressSnapshot: Prisma.InputJsonValue,
    actorUserId: string,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException("Request not found.");
      if (request.type !== "refill" || request.deliveryMethod !== "home") {
        throw new BadRequestException("Deliveries only exist for home-delivery refills.");
      }
      validateTransition({
        type: "refill",
        from: request.status as never,
        to: "Processing",
        actor: "staff",
      });

      const delivery = await tx.delivery.create({
        data: { requestId, addressSnapshot, status: "AwaitingAssignment" },
      });
      const history = await tx.requestStatusHistory.create({
        data: {
          requestId,
          fromStatus: request.status as never,
          toStatus: "Processing",
          actorId: actorUserId,
          actorKind: "staff",
          note: "Delivery created (awaiting assignment)",
          visibleToCustomer: true,
        },
      });
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { status: "Processing" },
      });
      await this.notifications.emitRequestStatusChanged(tx, {
        requestId,
        reference: request.reference,
        fromStatus: request.status as string,
        toStatus: "Processing",
        historyId: history.id,
        visibleToCustomer: true,
        actorKind: "staff",
      });
      return delivery.id;
    });
  }

  /**
   * Assign / reassign — permitted only BEFORE Dispatched (§4.4).
   * Same attempt (no new row, no retry_count change); assignment history kept.
   */
  async assign(
    deliveryId: string,
    staffId: string,
    actorUserId: string,
    expectedStatus: DeliveryStatus = "AwaitingAssignment",
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery) throw new NotFoundException("Delivery not found.");
      if (delivery.status === "Dispatched" || delivery.status === "Arrived") {
        throw new ConflictException("Reassignment is only permitted before dispatch.");
      }
      if (delivery.status !== expectedStatus) {
        throw new ConflictException(
          `Status changed (now ${delivery.status}); refresh and retry.`,
        );
      }

      await tx.delivery.update({
        where: { id: deliveryId },
        data: { deliveryPersonId: staffId, version: { increment: 1 } },
      });
      await tx.deliveryAssignment.create({
        data: { deliveryId, staffId, assignedBy: actorUserId },
      });
    });
  }

  /**
   * Status update — validates actor scope, concurrency, idempotency;
   * derives parent refill effects atomically (§4.4 coupling table).
   */
  async update(input: DeliveryUpdateInput): Promise<{ applied: boolean; status: DeliveryStatus }> {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id: input.deliveryId },
        include: { request: true },
      });
      if (!delivery) throw new NotFoundException("Delivery not found.");

      // Idempotency: duplicate updateToken → return current state, no writes
      if (input.updateToken) {
        const prior = await tx.auditLog.findFirst({
          where: {
            action: "delivery.update_idempotent",
            entityId: input.deliveryId,
            after: { equals: { updateToken: input.updateToken } },
          },
        });
        if (prior) {
          return { applied: false, status: delivery.status };
        }
      }

      // Optimistic concurrency — stale/out-of-order updates rejected (§4.4)
      if (delivery.status !== input.expectedStatus) {
        throw new ConflictException(
          `Expected ${input.expectedStatus} but delivery is ${delivery.status}.`,
        );
      }

      // Actor scope: delivery staff may only act on their own assigned delivery
      if (input.actor.kind === "delivery" && delivery.deliveryPersonId !== input.actor.userId) {
        throw new BadRequestException("You may only update your own assigned delivery.");
      }

      // Terminal delivery rows are immutable
      if (delivery.status === "Delivered" || delivery.status === "Failed") {
        throw new ConflictException(`Delivery already ${delivery.status}.`);
      }

      // Validate the delivery-state change itself (allowed predecessor pairs)
      this.assertDeliveryTransition(delivery.status, input.to, input.actor.kind);

      if (input.to === "Failed" && !input.failureReason) {
        throw new BadRequestException("A failure reason code is required.");
      }

      const isRetryable =
        input.failureReason ? !NON_RETRYABLE.includes(input.failureReason) : true;
      const attemptsForRequest = await tx.delivery.count({
        where: { requestId: delivery.requestId },
      });
      const canRetry = canCreateRetry(
        attemptsForRequest,
        await this.maxRetries(tx),
        this.isTerminalParent(delivery.request.status),
      );

      // ── Delivery row update (attempt becomes terminal on Failed/Delivered) ──
      await tx.delivery.update({
        where: { id: input.deliveryId },
        data: {
          status: input.to,
          version: { increment: 1 },
          ...(input.to === "Failed"
            ? { failureReason: input.failureReason ?? null }
            : {}),
          ...(input.to === "Dispatched" ? { dispatchedAt: new Date() } : {}),
          ...(input.to === "Delivered" ? { deliveredAt: new Date() } : {}),
          ...(input.to === "Delivered" ? { confirmedBy: input.actor.userId } : {}),
        },
      });

      // ── Server-derived parent refill coupling (DLV never posts parent transitions) ──
      const event =
        input.to === "Preparing"
          ? "preparing"
          : input.to === "Dispatched"
            ? "dispatched"
            : input.to === "Delivered"
              ? "delivered"
              : input.to === "Failed"
                ? "failed"
                : null;

      if (event) {
        const effect = parentEffectFor(event, delivery.request.status as never, {
          retryable: isRetryable,
          canRetry,
        });
        if (effect) {
          // Same-transaction parent transition, validated against refill matrix
          validateTransition({
            type: "refill",
            from: effect.from,
            to: effect.to,
            actor: effect.actor,
          });
          await tx.serviceRequest.update({
            where: { id: delivery.requestId },
            data: {
              status: effect.to,
              ...(effect.to === "Completed" ? { completedAt: new Date() } : {}),
            },
          });
          const history = await tx.requestStatusHistory.create({
            data: {
              requestId: delivery.requestId,
              fromStatus: effect.from,
              toStatus: effect.to,
              actorId: null,
              actorKind: "system",
              note: `Delivery ${input.to}${input.failureReason ? ` (${input.failureReason})` : ""}`,
              visibleToCustomer: true,
            },
          });
          await this.notifications.emitRequestStatusChanged(tx, {
            requestId: delivery.requestId,
            reference: delivery.request.reference,
            fromStatus: effect.from as string,
            toStatus: effect.to as string,
            historyId: history.id,
            visibleToCustomer: true,
            actorKind: "system",
          });
        }

        if (input.to === "Failed") {
          // §A1.3: retry_count on parent = count of failed attempts (same tx)
          const failedCount = await tx.delivery.count({
            where: { requestId: delivery.requestId, status: "Failed" },
          });
          await tx.serviceRequest.update({
            where: { id: delivery.requestId },
            data: { retryCount: failedCount },
          });
          // Legacy in_app outbox emission removed: customer/admin notifications
          // are emitted from actual request status-history events above.
        }
      }

      // Idempotency marker (audit) for duplicate updateToken replay
      if (input.updateToken) {
        await tx.auditLog.create({
          data: {
            actorId: input.actor.userId,
            action: "delivery.update_idempotent",
            entityType: "delivery",
            entityId: input.deliveryId,
            after: { updateToken: input.updateToken },
          },
        });
      } else {
        await tx.auditLog.create({
          data: {
            actorId: input.actor.userId,
            action: "delivery.status",
            entityType: "delivery",
            entityId: input.deliveryId,
            before: { status: delivery.status },
            after: { status: input.to },
          },
        });
      }

      return { applied: true, status: input.to };
    });
  }

  /**
   * Create a retry attempt — v1.2.4 §A1.4/§A1.5:
   * - previous failed attempt stays permanently Failed (never mutated)
   * - new row starts AwaitingAssignment with attemptNumber = n+1
   * - parent_delivery_id → immediately preceding attempt of same refill
   * - rejected for terminal parent or exhausted limit (canCreateRetry)
   */
  async createRetry(
    requestId: string,
    actorUserId: string,
  ): Promise<{ deliveryId: string; attemptNumber: number }> {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException("Request not found.");
      if (this.isTerminalParent(request.status)) {
        throw new ConflictException("Cannot retry a terminal refill request.");
      }

      const attempts = await tx.delivery.findMany({
        where: { requestId },
        orderBy: { attemptNumber: "asc" },
      });
      const totalAttempts = attempts.length;
      if (!canCreateRetry(totalAttempts, await this.maxRetries(tx), false)) {
        throw new ConflictException("Retry limit exhausted for this request.");
      }

      const last = attempts[attempts.length - 1];
      if (!last || last.status !== "Failed") {
        throw new BadRequestException("Only a failed attempt can be retried.");
      }

      const created = await tx.delivery.create({
        data: {
          requestId,
          attemptNumber: last.attemptNumber + 1,
          parentDeliveryId: last.id, // references immediately preceding failed attempt
          status: "AwaitingAssignment", // §A1.5: new attempt begins here
          addressSnapshot: last.addressSnapshot as Prisma.InputJsonValue,
          scheduledDate: last.scheduledDate,
          windowLabel: last.windowLabel,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actorUserId,
          action: "delivery.retry_created",
          entityType: "delivery",
          entityId: created.id,
          after: { requestId, attemptNumber: created.attemptNumber, from: last.id },
        },
      });

      return { deliveryId: created.id, attemptNumber: created.attemptNumber };
    });
  }

  // ── internals ──────────────────────────────────────────────

  private assertDeliveryTransition(
    from: DeliveryStatus,
    to: DeliveryStatus,
    actorKind: string,
  ): void {
    const allowed: Record<DeliveryStatus, DeliveryStatus[]> = {
      AwaitingAssignment: ["Assigned"],
      Assigned: ["Preparing", "Failed"],
      Preparing: ["Dispatched", "Failed"],
      Dispatched: ["Arrived", "Delivered", "Failed"],
      Arrived: ["Delivered", "Failed"],
      Delivered: [],
      Failed: [],
    };
    if (!allowed[from].includes(to)) {
      throw new BadRequestException(`Invalid delivery transition ${from} → ${to}.`);
    }
    // Assignment transitions are staff-only; progression is delivery-staff or staff
    if (to === "Assigned" && actorKind !== "staff") {
      throw new BadRequestException("Only staff may assign deliveries.");
    }
  }

  private isTerminalParent(status: string): boolean {
    return ["Completed", "Rejected", "Cancelled", "Resolved"].includes(status);
  }

  private async maxRetries(tx: Prisma.TransactionClient): Promise<number> {
    const setting = await tx.businessSetting.findUnique({
      where: { key: "delivery.max_retries" },
    });
    const value = setting ? Number(setting.value) : NaN;
    return Number.isFinite(value) ? value : 2; // v1.2.4 default: 2 additional attempts
  }
}
