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
  kind: "customer" | "staff";
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

export interface LinkCandidate {
  id: string;
  reference: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: string;
}
