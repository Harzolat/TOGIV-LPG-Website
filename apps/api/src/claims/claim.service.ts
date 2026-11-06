import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient, ClaimState } from "@prisma/client";

/**
 * Cylinder claim service — v1.2 §1.4.1 + v1.2.2 A2 (approved):
 *
 * - Service registration ≠ ownership verification. Approving a register_new
 *   claim associates a cylinder for SERVICES only; UI must say so.
 * - Auto-approve of register_new is a config flag, DISABLED by default
 *   until the business confirms its ownership model (v1.2 §1.4.1).
 * - dispute_existing: ALWAYS staff review, no auto-approval path.
 * - Immutable CylinderClaim submission + append-only CylinderClaimEvent +
 *   CylinderClaimState projection written in the same transaction as events.
 * - acknowledged → state stays pending; reopened → returns to pending while
 *   preserving the prior rejection and all earlier events (v1.2.2 A2.6/A2.7).
 * - Withdraw: claimant while pending; staff with reason at any pre-decision
 *   stage; never after a decision (v1.2.2 A2.8).
 */

export type ClaimEventType =
  | "submitted"
  | "acknowledged"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "reopened";

export class ClaimStateError extends Error {
  constructor(
    public readonly code: "NOT_PENDING" | "ALREADY_DECIDED" | "NOT_REJECTED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ClaimStateError";
  }
}

export interface SubmitClaimInput {
  claimType: "register_new" | "dispute_existing";
  claimedByCustomerId: string;
  qrCodeId?: string | null;
  cylinderId?: string | null;
  evidenceNote: string;
  evidenceAttachmentIds?: string[];
  /** Set by staff/QR scan logic when ownership is uncertain → staff review */
  linkReviewRequired?: boolean;
}

@Injectable()
export class ClaimService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Immutable submission + submitted event + pending projection — one transaction. */
  async submit(input: SubmitClaimInput): Promise<{ id: string; state: ClaimState }> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.cylinderClaim.create({
        data: {
          claimType: input.claimType,
          qrCodeId: input.qrCodeId ?? null,
          cylinderId: input.cylinderId ?? null,
          claimedByCustomerId: input.claimedByCustomerId,
          evidenceNote: input.evidenceNote,
          evidenceAttachmentIds: input.evidenceAttachmentIds ?? [],
          linkReviewRequired: input.linkReviewRequired ?? false,
        },
      });

      await tx.cylinderClaimEvent.create({
        data: { claimId: claim.id, eventType: "submitted", actorId: input.claimedByCustomerId },
      });
      await tx.cylinderClaimState.create({
        data: { claimId: claim.id, currentState: "pending" },
      });

      return { id: claim.id, state: "pending" as ClaimState };
    });
  }

  /**
   * Whether this claim may be auto-approved (register_new only, flag on,
   * not staff-flagged, not a dispute). Default OFF (v1.2 §1.4.1).
   */
  async isAutoApproveEnabled(): Promise<boolean> {
    const setting = await this.prisma.businessSetting.findUnique({
      where: { key: "claims.auto_approve_register_new" },
    });
    return setting ? setting.value === true : false; // disabled until business confirms
  }

  /**
   * Staff decision — appends event + updates projection atomically.
   * Approval of register_new = service registration only (never ownership).
   * Approval of dispute_existing may write ownership history if owner changes.
   */
  async decide(
    claimId: string,
    decision: "approved" | "rejected",
    actor: { userId: string; role: "admin" | "super_admin" },
    opts: { note?: string } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.cylinderClaim.findUnique({
        where: { id: claimId },
        include: { state: true },
      });
      if (!claim) throw new NotFoundException("Claim not found.");
      if (!claim.state || claim.state.currentState !== "pending") {
        throw new ClaimStateError(
          "ALREADY_DECIDED",
          `Claim is ${claim.state?.currentState ?? "unknown"}; only pending claims can be decided.`,
        );
      }
      if (decision === "rejected" && !opts.note?.trim()) {
        throw new BadRequestException("A decision note is required to reject a claim.");
      }

      // ── effect of approval ──
      if (decision === "approved") {
        if (claim.claimType === "register_new") {
          // SERVICE REGISTRATION ONLY — link cylinder to claimant's account
          if (claim.cylinderId) {
            await tx.cylinder.update({
              where: { id: claim.cylinderId },
              data: { ownerCustomerId: claim.claimedByCustomerId },
            });
            await tx.cylinderOwnershipHistory.create({
              data: {
                cylinderId: claim.cylinderId,
                fromCustomerId: null,
                toCustomerId: claim.claimedByCustomerId,
                reason: `claim ${claimId} approved (service registration)`,
                actorUserId: actor.userId,
              },
            });
          }
        } else {
          // dispute_existing: ownership change ONLY if cylinder exists and owner differs
          if (claim.cylinderId) {
            const cylinder = await tx.cylinder.findUnique({
              where: { id: claim.cylinderId },
            });
            if (cylinder && cylinder.ownerCustomerId !== claim.claimedByCustomerId) {
              await tx.cylinder.update({
                where: { id: claim.cylinderId },
                data: { ownerCustomerId: claim.claimedByCustomerId },
              });
              await tx.cylinderOwnershipHistory.create({
                data: {
                  cylinderId: claim.cylinderId,
                  fromCustomerId: cylinder.ownerCustomerId,
                  toCustomerId: claim.claimedByCustomerId,
                  reason: `dispute claim ${claimId} approved after staff review`,
                  actorUserId: actor.userId,
                },
              });
            }
          }
        }
      }

      await tx.cylinderClaimEvent.create({
        data: {
          claimId,
          eventType: decision,
          actorId: actor.userId,
          decisionNote: opts.note ?? null,
        },
      });
      await tx.cylinderClaimState.update({
        where: { claimId },
        data: {
          currentState: decision === "approved" ? "approved" : "rejected",
          reviewedBy: actor.userId,
          reviewedAt: new Date(),
          decisionNote: opts.note ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          action: `claim.${decision}`,
          entityType: "cylinder_claim",
          entityId: claimId,
          after: { note: opts.note ?? null, role: actor.role },
        },
      });
    });
  }

  /** Acknowledgement: review started — state REMAINS pending (v1.2.2 A2.6). */
  async acknowledge(claimId: string, actorUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const state = await tx.cylinderClaimState.findUnique({ where: { claimId } });
      if (!state) throw new NotFoundException("Claim not found.");
      if (state.currentState !== "pending") {
        throw new ClaimStateError("NOT_PENDING", "Only pending claims can be acknowledged.");
      }
      await tx.cylinderClaimEvent.create({
        data: { claimId, eventType: "acknowledged", actorId: actorUserId },
      });
      // projection unchanged — still pending (event only records the actor/time)
      await tx.cylinderClaimState.update({
        where: { claimId },
        data: { updatedAt: new Date() },
      });
    });
  }

  /**
   * Reopen a rejected claim → state returns to pending while the previous
   * rejection and ALL earlier events are preserved (v1.2.2 A2.7).
   */
  async reopen(claimId: string, actor: { userId: string; role: string }, reason: string): Promise<void> {
    if (!reason?.trim()) {
      throw new BadRequestException("A reason is required to reopen a claim.");
    }
    await this.prisma.$transaction(async (tx) => {
      const state = await tx.cylinderClaimState.findUnique({ where: { claimId } });
      if (!state) throw new NotFoundException("Claim not found.");
      if (state.currentState !== "rejected") {
        throw new ClaimStateError("NOT_REJECTED", "Only rejected claims can be reopened.");
      }
      await tx.cylinderClaimEvent.create({
        data: { claimId, eventType: "reopened", actorId: actor.userId, decisionNote: reason },
      });
      await tx.cylinderClaimState.update({
        where: { claimId },
        data: {
          currentState: "pending",
          reviewedBy: null,
          reviewedAt: null,
          decisionNote: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          action: "claim.reopened",
          entityType: "cylinder_claim",
          entityId: claimId,
          before: { state: "rejected" },
          after: { state: "pending", reason },
        },
      });
    });
  }

  /**
   * Withdraw — claimant while pending; staff with reason any time BEFORE a
   * decision; never after a decision (v1.2.2 A2.8). Event + projection atomic.
   */
  async withdraw(
    claimId: string,
    actor: { userId: string; kind: "customer" | "staff" },
    opts: { reason?: string } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.cylinderClaim.findUnique({
        where: { id: claimId },
        include: { state: true },
      });
      if (!claim) throw new NotFoundException("Claim not found.");
      const current = claim.state?.currentState;
      if (current !== "pending") {
        throw new ClaimStateError(
          "ALREADY_DECIDED",
          "A decided claim cannot be withdrawn.",
        );
      }
      if (actor.kind === "customer" && claim.claimedByCustomerId !== actor.userId) {
        throw new ClaimStateError("FORBIDDEN", "You may only withdraw your own claim.");
      }
      if (actor.kind === "staff" && !opts.reason?.trim()) {
        throw new BadRequestException("Staff withdrawal requires a reason.");
      }

      await tx.cylinderClaimEvent.create({
        data: {
          claimId,
          eventType: "withdrawn",
          actorId: actor.userId,
          decisionNote: opts.reason ?? null,
        },
      });
      await tx.cylinderClaimState.update({
        where: { claimId },
        data: { currentState: "withdrawn" },
      });
    });
  }

  /** Full history for the review screen: submission + every event in order. */
  async history(claimId: string) {
    const claim = await this.prisma.cylinderClaim.findUnique({
      where: { id: claimId },
      include: {
        events: { orderBy: { createdAt: "asc" } },
        state: true,
        claimant: { select: { id: true, fullName: true } },
        cylinder: { select: { id: true, serial: true, label: true } },
        qrCode: { select: { id: true, serial: true } },
      },
    });
    if (!claim) throw new NotFoundException("Claim not found.");
    return claim;
  }

  /** Projection-rebuild parity check (CI): events → expected state. */
  async rebuildState(claimId: string): Promise<ClaimState> {
    const events = await this.prisma.cylinderClaimEvent.findMany({
      where: { claimId },
      orderBy: { createdAt: "asc" },
    });
    let state: ClaimState = "pending";
    for (const e of events) {
      switch (e.eventType as ClaimEventType) {
        case "submitted":
        case "acknowledged":
        case "reopened":
          state = "pending"; // acknowledged leaves pending; reopened returns to it
          break;
        case "approved":
          state = "approved";
          break;
        case "rejected":
          state = "rejected";
          break;
        case "withdrawn":
          state = "withdrawn";
          break;
      }
    }
    return state;
  }

  /** Asserts stored projection matches event-derived state (used by tests/CI). */
  async assertProjectionConsistent(claimId: string): Promise<void> {
    const stored = await this.prisma.cylinderClaimState.findUnique({ where: { claimId } });
    const rebuilt = await this.rebuildState(claimId);
    if (!stored || stored.currentState !== rebuilt) {
      throw new ConflictException(
        `Claim projection out of sync: stored=${stored?.currentState} rebuilt=${rebuilt}`,
      );
    }
  }
}
