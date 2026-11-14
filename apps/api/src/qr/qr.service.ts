import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient, QrCurrentState } from "@prisma/client";
import { generateOpaqueToken, sha256Hex } from "../common/tokens";

/**
 * QR service — v1.2 §1.4.1 / v1.2.1 A3 / v1.2.2 A2 (approved):
 *
 * - QR = IDENTIFICATION ONLY. Scanning NEVER writes to cylinder ownership.
 * - High-entropy opaque URLs (≥128-bit CSPRNG), stored SHA-256 hashed;
 *   raw token exists only in the URL and is returned once at generation.
 * - No cryptographic signature: storage-based validation is strictly
 *   stronger (revocation, single-use, analytics) — v1.2.1 A3.
 * - Immutable identity (QrCode) + append-only QrCodeEvent + derived
 *   QrCodeState projection written in the same transaction as each event.
 * - PII-free resolution: returns context only, never owner details.
 */

export type QrScanOutcome =
  | "valid"
  | "invalid"
  | "deactivated"
  | "revoked"
  | "replaced";

export interface QrResolution {
  outcome: QrScanOutcome;
  /** Context for the SPA — contains NO personal information */
  context:
    | {
        kind: "cylinder_registered";
        cylinderId: string;
        capacityKg: number;
        serial: string;
        qrCodeId: string;
      }
    | { kind: "cylinder_unassigned"; serial: string; qrCodeId: string }
    | { kind: "unrecognized" };
}

export interface QrBatchItem {
  token: string; // raw — returned once for sticker printing, never stored
  serial: string;
}

@Injectable()
export class QrService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Batch generation for printable sticker sheets. */
  async generateBatch(count: number, batchId: string): Promise<QrBatchItem[]> {
    const items: QrBatchItem[] = [];
    const rows: Array<{ tokenHash: string; serial: string }> = [];

    for (let i = 0; i < count; i++) {
      const token = generateOpaqueToken(16); // 128-bit minimum (v1.2 §1.4.3)
      const serial = `TG-${batchId}-${String(i + 1).padStart(4, "0")}`;
      rows.push({ tokenHash: sha256Hex(token), serial });
      items.push({ token, serial });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const qr = await tx.qrCode.create({
          data: { tokenHash: row.tokenHash, serial: row.serial, batchId },
        });
        await tx.qrCodeEvent.create({
          data: { qrCodeId: qr.id, eventType: "generated" },
        });
        await tx.qrCodeState.create({
          data: { qrCodeId: qr.id, currentState: "unassigned" },
        });
      }
    });

    return items;
  }

  /**
   * Server-side resolution — PII-free by construction.
   * The URL carries only the opaque token; all context is fetched server-side
   * and filtered to non-personal fields before returning to the SPA.
   */
  async resolve(rawToken: string): Promise<QrResolution> {
    const tokenHash = sha256Hex(rawToken);

    const qr = await this.prisma.qrCode.findUnique({
      where: { tokenHash },
      include: {
        state: { include: { cylinder: { include: { cylinderType: true } } } },
      },
    });

    // Analytics only — invalid scans log outcome without storing the raw token
    if (!qr) {
      await this.recordScan(null, "invalid");
      return { outcome: "invalid", context: { kind: "unrecognized" } };
    }

    const state: QrCurrentState = qr.state?.currentState ?? "unassigned";

    if (state === "revoked") {
      await this.recordScan(qr.id, "revoked");
      return { outcome: "revoked", context: { kind: "unrecognized" } };
    }
    if (state === "replaced") {
      await this.recordScan(qr.id, "replaced");
      return { outcome: "replaced", context: { kind: "unrecognized" } };
    }
    if (state === "deactivated") {
      await this.recordScan(qr.id, "deactivated");
      return { outcome: "deactivated", context: { kind: "unrecognized" } };
    }

    await this.recordScan(qr.id, "valid");

    const cylinder = qr.state?.cylinder;
    if (state === "active" && cylinder) {
      // Registered cylinder — capacity/serial only, NO owner/name/phone/address.
      // qrCodeId is an internal identifier (not a secret token) so the scan
      // flow can submit a service-registration claim for this sticker.
      return {
        outcome: "valid",
        context: {
          kind: "cylinder_registered",
          cylinderId: cylinder.id,
          capacityKg: cylinder.cylinderType.capacityKg,
          serial: qr.serial,
          qrCodeId: qr.id,
        },
      };
    }

    // Unassigned sticker: serial lets a customer reference it in a claim.
    return {
      outcome: "valid",
      context: {
        kind: "cylinder_unassigned",
        serial: qr.serial,
        qrCodeId: qr.id,
      },
    };
  }

  /**
   * Assign/activate a QR to a cylinder — STAFF ONLY (enforced by caller).
   * This is a service-registration action, never an ownership assertion.
   * Appends the lifecycle event and updates the projection atomically.
   */
  async assignAndActivate(
    qrCodeId: string,
    cylinderId: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const qr = await tx.qrCode.findUnique({
        where: { id: qrCodeId },
        include: { state: true },
      });
      if (!qr) throw new NotFoundException("QR code not found.");
      if (qr.state?.currentState === "revoked") {
        throw new Error("Revoked QR codes cannot be reactivated.");
      }

      // Deactivate any currently-active QR for this cylinder (partial unique
      // index allows only one active; old row keeps history via events)
      const active = await tx.qrCodeState.findFirst({
        where: { cylinderId, currentState: "active", NOT: { qrCodeId } },
      });
      if (active) {
        await tx.qrCodeEvent.create({
          data: {
            qrCodeId: active.qrCodeId,
            eventType: "replaced",
            cylinderId,
            actorId,
            reason: "superseded by new active sticker",
          },
        });
        await tx.qrCodeState.update({
          where: { qrCodeId: active.qrCodeId },
          data: { currentState: "replaced" },
        });
      }

      await tx.qrCodeEvent.create({
        data: { qrCodeId, eventType: "assigned", cylinderId, actorId },
      });
      await tx.qrCodeEvent.create({
        data: { qrCodeId, eventType: "activated", cylinderId, actorId },
      });
      await tx.qrCodeState.upsert({
        where: { qrCodeId },
        create: { qrCodeId, currentState: "active", cylinderId },
        update: { currentState: "active", cylinderId },
      });
    });
  }

  /** Terminal lifecycle action — traceable, never deletes history. */
  async setStatus(
    qrCodeId: string,
    event: "deactivated" | "reactivated" | "revoked",
    actorId: string,
    reason?: string,
  ): Promise<void> {
    const next: Record<typeof event, QrCurrentState> = {
      deactivated: "deactivated",
      reactivated: "active",
      revoked: "revoked",
    };

    await this.prisma.$transaction(async (tx) => {
      const state = await tx.qrCodeState.findUnique({ where: { qrCodeId } });
      if (!state) throw new NotFoundException("QR state not found.");
      if (state.currentState === "revoked" && event !== "revoked") {
        throw new Error("Revoked QR codes are terminal.");
      }

      await tx.qrCodeEvent.create({
        data: { qrCodeId, eventType: event, cylinderId: state.cylinderId, actorId, reason },
      });
      await tx.qrCodeState.update({
        where: { qrCodeId },
        data: { currentState: next[event] },
      });
    });
  }

  private async recordScan(qrCodeId: string | null, outcome: QrScanOutcome) {
    await this.prisma.qrScanEvent.create({
      data: { qrCodeId, outcome },
    });
  }
}
