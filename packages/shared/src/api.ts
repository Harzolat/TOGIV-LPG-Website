/**
 * API response contracts shared by the customer and admin apps.
 *
 * These mirror the Prisma `select`/`include` shapes returned by the API
 * (apps/api) — one definition, two clients, so a field rename on the
 * server breaks both apps at compile time instead of at runtime.
 */
import type { RequestStatus, RequestType } from "./transitions";

/** Row shape of `GET /requests` (staff queue) and `GET /requests/mine`. */
export interface RequestListItem {
  id: string;
  reference: string;
  type: RequestType;
  status: RequestStatus;
  deliveryMethod?: "home" | "station" | null;
  /** Present on the staff queue only. */
  contactPhone?: string | null;
  customer?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /admin/overview` — the console's at-a-glance operations summary. */
export interface AdminOverview {
  generatedAt: string;
  counts: {
    submitted: number;
    received: number;
    underReview: number;
    accepted: number;
    processing: number;
    dispatched: number;
    /** Everything before a terminal state. */
    active: number;
    /** Submitted + UnderReview — the rows that need a human decision. */
    needsAttention: number;
    completedToday: number;
    openClaims: number;
  };
  byStatus: Array<{ status: RequestStatus; count: number }>;
  oldestWaiting: RequestListItem[];
  activity: Array<{
    id: string;
    reference: string;
    type: RequestType;
    fromStatus: RequestStatus | null;
    toStatus: RequestStatus;
    actorKind: string;
    actorName: string | null;
    createdAt: string;
  }>;
  /** Staff transitions recorded today, busiest first. */
  todayByActor: Array<{ actorId: string; name: string; count: number }>;
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  actorKind: string;
  note: string | null;
  visibleToCustomer: boolean;
  createdAt: string;
}

/** `GET /requests/:id` — full context for the detail screen. */
export interface RequestDetail extends RequestListItem {
  payload: Record<string, unknown>;
  priceEstimateKobo?: number | null;
  deliveryMethod?: "home" | "station" | null;
  cylinderId?: string | null;
  cylinder?: {
    id: string;
    serial: string | null;
    label: string | null;
    cylinderType?: { capacityKg: number; label: string } | null;
  } | null;
  statusHistory: StatusHistoryEntry[];
  messages: Array<{ id: string; body: string; internal: boolean; createdAt: string }>;
  deliveries: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    failureReason?: string | null;
    scheduledDate?: string | null;
    windowLabel?: string | null;
    createdAt: string;
  }>;
  attachments?: Array<{
    id: string;
    name: string | null;
    kind: string;
    createdAt: string;
  }>;
}

// ───────────────────────────── Claims ─────────────────────────────

export type ClaimState = "pending" | "approved" | "rejected" | "withdrawn";

export type ClaimType = "register_new" | "dispute_existing";

/** Immutable submission record (projection lives in CylinderClaimState). */
export interface CylinderClaim {
  id: string;
  claimType: ClaimType | string;
  evidenceNote?: string;
  linkReviewRequired?: boolean;
  createdAt: string;
  claimant?: { id: string; fullName: string } | null;
  cylinder?: {
    id?: string;
    serial: string | null;
    label: string | null;
    ownerCustomerId?: string | null;
  } | null;
  qrCode?: { id?: string; serial: string | null } | null;
}

/** Append-only event ledger row. */
export interface ClaimEvent {
  id: string;
  eventType: string;
  decisionNote: string | null;
  createdAt: string;
}

/** Alias kept for pages that name the model explicitly. */
export type CylinderClaimEvent = ClaimEvent;

export interface CylinderClaimState {
  claimId: string;
  currentState: ClaimState;
  reviewedAt: string | null;
  decisionNote: string | null;
}

/** Row shape of `GET /claims` (staff review queue). */
export interface ClaimListItem {
  id: string;
  claimType: ClaimType | string;
  createdAt: string;
  state: CylinderClaimState | null;
  claimant?: { id: string; fullName: string } | null;
  cylinder?: { serial: string | null; label: string | null } | null;
  qrCode?: { serial: string | null } | null;
}

/** `GET /claims/:id` — claim + immutable history. */
export interface ClaimDetail extends CylinderClaim {
  state: CylinderClaimState | null;
  events: ClaimEvent[];
}

// ───────────────────────────── Cylinders & QR ─────────────────────────────

export interface CylinderTypeInfo {
  capacityKg: number;
  label: string;
}

export interface CustomerCylinder {
  id: string;
  serial: string | null;
  label: string | null;
  brand?: string | null;
  condition: string;
  registeredAt: string;
  cylinderType: CylinderTypeInfo;
}

export type QrResolveOutcome = "valid" | "invalid" | "deactivated" | "revoked" | "replaced";

export type QrResolveContext =
  | { kind: "cylinder_registered"; cylinderId: string; capacityKg: number; serial?: string | null; qrCodeId?: string }
  | { kind: "cylinder_unassigned"; serial: string; qrCodeId?: string }
  | { kind: "unrecognized" };

export interface QrResolveResult {
  outcome: QrResolveOutcome;
  context: QrResolveContext;
}

// ───────────────────────────── Staff management ─────────────────────────────

export interface StaffMember {
  id: string;
  phone: string;
  email: string | null;
  status: string;
  fullName: string;
  department: string | null;
  employeeRef: string | null;
  roles: string[];
  totpEnrolled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ───────────────────────────── Account recovery ─────────────────────────────

/** `GET /auth/recovery-info` — business contact configuration for recovery. */
export interface RecoveryContactInfo {
  company: string;
  phones: string[];
  hours: string | null;
  instructions?: string;
}

export type PinResetStatus = "pending" | "completed" | "expired" | "revoked";

/** One operator authorization in the recovery audit list. */
export interface PinResetAuthorization {
  id: string;
  status: PinResetStatus;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string;
  createdBy: string | null;
  createdByName: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

/** `POST /admin/customers/:id/pin-reset` — token is shown exactly once. */
export interface PinResetIssueResult {
  ok: true;
  resetToken: string;
  expiresAt: string;
  authorizationId: string;
  customer: { id: string; fullName: string; phone: string };
  notice: string;
}

export type StaffPasswordResetStatus = "pending" | "completed" | "expired" | "revoked";

/** One operator-authorized staff password reset in the audit list. */
export interface StaffPasswordResetAuthorization {
  id: string;
  status: StaffPasswordResetStatus;
  staffId: string | null;
  staffName: string | null;
  staffIdentifier: string; // email or phone (non-secret contact identifier)
  createdBy: string | null;
  createdByName: string | null;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

/** `POST /admin/staff/:id/password-reset-token` — token is shown exactly once. */
export interface StaffPasswordResetIssueResult {
  ok: true;
  resetToken: string;
  expiresAt: string;
  authorizationId: string;
  staff: { id: string; fullName: string; email: string | null; phone: string };
  notice: string;
}

/** Row shape of `GET /customers` (staff directory). */
export interface CustomerProfile {
  id: string;
  fullName: string;
  phone: string;
  email?: string | null;
  state?: string | null;
  lga?: string | null;
  createdAt: string;
  suspendedAt?: string | null;
  status?: "active" | "suspended" | "deactivated";
  requestCount?: number;
}

/** `GET /customers/:id` — profile + addresses, requests, claims, cylinders. */
export interface CustomerDetail extends CustomerProfile {
  preferredContact?: string;
  marketingConsent?: boolean;
  addresses: Array<{
    id: string;
    label: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    lga: string;
    isDefault: boolean;
    deliveryNote: string | null;
  }>;
  cylinders: Array<{
    id: string;
    serial: string | null;
    label: string | null;
    condition: string;
    capacityKg?: number | null;
  }>;
  requests: Array<{
    id: string;
    reference: string;
    type: RequestType;
    status: RequestStatus;
    createdAt: string;
  }>;
  claims: Array<{
    id: string;
    claimType: ClaimType | string;
    state: ClaimState;
    createdAt: string;
  }>;
}
