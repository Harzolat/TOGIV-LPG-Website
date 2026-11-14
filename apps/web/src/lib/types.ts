/** Response shapes for customer-app API calls (mirrors the API DTOs). */

export type RequestType = "refill" | "complaint" | "enquiry";

export type RequestStatus =
  | "Submitted"
  | "Received"
  | "UnderReview"
  | "Accepted"
  | "Processing"
  | "Dispatched"
  | "Completed"
  | "Resolved"
  | "Rejected"
  | "Cancelled"
  | "Escalated";

export interface SubmitResponse {
  reference: string;
  trackingPath?: string;
  message?: string;
}

export interface TrackPayload {
  reference: string;
  type: RequestType;
  status: RequestStatus;
  updatedAt: string;
}

export interface SessionUser {
  id: string;
  phone: string;
  email?: string | null;
  kind: "customer" | "staff";
  emailVerified?: boolean;
  phoneVerified?: boolean;
  hasPassword?: boolean;
  profile?: {
    fullName: string;
    defaultAddress: null | {
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      lga: string;
      deliveryNote: string | null;
    };
  } | null;
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

export interface RequestListItem {
  id: string;
  reference: string;
  type: RequestType;
  status: RequestStatus;
  deliveryMethod?: "home" | "station" | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface RequestDetail extends RequestListItem {
  payload: Record<string, unknown>;
  contactPhone?: string;
  priceEstimateKobo?: number | null;
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

export interface CustomerCylinder {
  id: string;
  serial: string | null;
  label: string | null;
  brand?: string | null;
  condition: string;
  registeredAt: string;
  cylinderType: { capacityKg: number; label: string };
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

export type ClaimState = "pending" | "approved" | "rejected" | "withdrawn";

export interface MyClaim {
  id: string;
  claimType: string;
  evidenceNote?: string;
  createdAt: string;
  state: { currentState: ClaimState } | null;
  cylinder?: { serial: string | null; label: string | null } | null;
  qrCode?: { serial: string | null } | null;
}

export interface LinkCandidate {
  id: string;
  reference: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: string;
}
