/**
 * Request status transition matrices — planning document v1.2.4 Part 4.
 * Pure functions: no I/O, enforced server-side by the API layer.
 *
 * Shared rules:
 * - Terminal states are immutable (no reopen via ordinary updates)
 * - Unified cancellation: customer only in {Submitted, Received, Under Review};
 *   staff in any non-terminal state with reason (and delivery closure if Dispatched)
 * - Escalation exists only on complaints; D2 (→Rejected) only on refills from Dispatched
 */

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

export type ActorKind = "system" | "customer" | "staff";

export interface TransitionContext {
  type: RequestType;
  from: RequestStatus;
  to: RequestStatus;
  actor: ActorKind;
  /** Required for staff cancellations, rejections, escalations, resolutions */
  reason?: string;
  /** Refill only: parent is a home delivery being converted/failed */
  deliveryLinked?: boolean;
}

export class TransitionError extends Error {
  constructor(
    public readonly code:
      | "TERMINAL_STATE"
      | "INVALID_TRANSITION"
      | "ACTOR_NOT_PERMITTED"
      | "REASON_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

const TERMINAL: Record<RequestType, readonly RequestStatus[]> = {
  refill: ["Completed", "Rejected", "Cancelled"],
  complaint: ["Resolved", "Rejected", "Cancelled"],
  enquiry: ["Completed", "Rejected", "Cancelled"],
};

/** Customer self-cancellation window — unified across all types. */
export const CUSTOMER_CANCELABLE: readonly RequestStatus[] = [
  "Submitted",
  "Received",
  "UnderReview",
];

type Row = {
  to: RequestStatus;
  actor: ActorKind | "any";
  reason?: "required";
};

/** Refill matrix — v1.2.4 §4.1 */
const REFILL: Row[] = [
  { to: "Received", actor: "staff" },
  { to: "UnderReview", actor: "staff" },
  { to: "Accepted", actor: "staff" },
  { to: "Rejected", actor: "staff", reason: "required" },
  { to: "Processing", actor: "staff" },
  { to: "Dispatched", actor: "any" }, // staff manual OR system-derived (delivery coupling)
  { to: "Completed", actor: "staff" }, // station counter OR system-derived (D4)
  { to: "Cancelled", actor: "customer" },
  { to: "Cancelled", actor: "staff", reason: "required" },
  { to: "Processing", actor: "system" }, // D1 server-derived (from Dispatched)
];

/** Complaint matrix — v1.2.4 §4.2 */
const COMPLAINT: Row[] = [
  { to: "Received", actor: "staff" },
  { to: "UnderReview", actor: "staff" },
  { to: "Accepted", actor: "staff" },
  { to: "Rejected", actor: "staff", reason: "required" },
  { to: "Processing", actor: "staff" },
  { to: "Resolved", actor: "staff", reason: "required" },
  { to: "Escalated", actor: "staff", reason: "required" },
  { to: "UnderReview", actor: "staff" }, // from Escalated
  { to: "Cancelled", actor: "customer" },
  { to: "Cancelled", actor: "staff", reason: "required" },
];

/** Enquiry matrix — v1.2.4 §4.3 */
const ENQUIRY: Row[] = [
  { to: "Received", actor: "staff" },
  { to: "UnderReview", actor: "staff" },
  { to: "Completed", actor: "staff" }, // customer-visible answer required (message layer)
  { to: "Rejected", actor: "staff", reason: "required" },
  { to: "Cancelled", actor: "customer" },
  { to: "Cancelled", actor: "staff", reason: "required" },
];

const ALLOWED: Record<RequestType, Partial<Record<RequestStatus, Row[]>>> = {
  refill: {
    Submitted: [{ to: "Received", actor: "staff" }, { to: "Cancelled", actor: "customer" }],
    Received: [
      { to: "UnderReview", actor: "staff" },
      { to: "Cancelled", actor: "customer" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    UnderReview: [
      { to: "Accepted", actor: "staff" },
      { to: "Rejected", actor: "staff", reason: "required" },
      { to: "Cancelled", actor: "customer" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Accepted: [
      { to: "Processing", actor: "staff" },
      // §4.4: server-derived when delivery moves to Preparing (same transaction)
      { to: "Processing", actor: "system" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Processing: [
      { to: "Dispatched", actor: "any" },
      { to: "Completed", actor: "staff" }, // station drop-off counter
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Dispatched: [
      { to: "Completed", actor: "any" }, // D4 system-derived or staff
      { to: "Processing", actor: "system" }, // D1 server-derived
      { to: "Rejected", actor: "staff", reason: "required" }, // D2 — only valid from Dispatched
      { to: "Cancelled", actor: "staff", reason: "required" }, // D3 (delivery closed same tx)
    ],
    Completed: [],
    Rejected: [],
    Cancelled: [],
  },
  complaint: {
    Submitted: [{ to: "Received", actor: "staff" }, { to: "Cancelled", actor: "customer" }],
    Received: [
      { to: "UnderReview", actor: "staff" },
      { to: "Cancelled", actor: "customer" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    UnderReview: [
      { to: "Accepted", actor: "staff" },
      { to: "Rejected", actor: "staff", reason: "required" },
      { to: "Escalated", actor: "staff", reason: "required" },
      { to: "Cancelled", actor: "customer" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Accepted: [
      { to: "Processing", actor: "staff" },
      { to: "Escalated", actor: "staff", reason: "required" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Processing: [
      { to: "Resolved", actor: "staff", reason: "required" },
      { to: "Escalated", actor: "staff", reason: "required" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Escalated: [
      // v1.2.2: no Rejected, no Accepted, no customer-cancel from Escalated
      { to: "UnderReview", actor: "staff" },
      { to: "Processing", actor: "staff" },
      { to: "Resolved", actor: "staff", reason: "required" },
      { to: "Cancelled", actor: "staff", reason: "required" },
    ],
    Resolved: [],
    Rejected: [],
    Cancelled: [],
  },
  enquiry: {
    Submitted: [{ to: "Received", actor: "staff" }, { to: "Cancelled", actor: "any" }],
    Received: [
      { to: "UnderReview", actor: "staff" },
      { to: "Cancelled", actor: "any" },
    ],
    UnderReview: [
      { to: "Completed", actor: "staff" },
      { to: "Rejected", actor: "staff", reason: "required" },
      { to: "Cancelled", actor: "any" },
    ],
    Completed: [],
    Rejected: [],
    Cancelled: [],
  },
};

// Sanity: shared arrays above are documentation; ALLOWED is the single source.
void REFILL;
void COMPLAINT;
void ENQUIRY;

/**
 * The next normal staff step for a request — powers the admin queue's
 * one-click "advance" action. Exceptional moves (reject, escalate, cancel)
 * are never returned: those need a reason and belong on the detail screen.
 */
const NEXT_PRIORITY: readonly RequestStatus[] = [
  "Received",
  "UnderReview",
  "Accepted",
  "Processing",
  "Dispatched",
  "Completed",
  "Resolved",
];

export function nextStaffStep(
  type: RequestType,
  from: RequestStatus,
): { to: RequestStatus; reasonRequired: boolean } | null {
  const rows = ALLOWED[type][from] ?? [];
  for (const to of NEXT_PRIORITY) {
    const row = rows.find(
      (r) => r.to === to && (r.actor === "staff" || r.actor === "any"),
    );
    if (row) return { to, reasonRequired: row.reason === "required" };
  }
  return null;
}

export function isTerminal(type: RequestType, status: RequestStatus): boolean {
  return TERMINAL[type].includes(status);
}

export function canTransition(ctx: TransitionContext): boolean {
  try {
    validateTransition(ctx);
    return true;
  } catch {
    return false;
  }
}

export function validateTransition(ctx: TransitionContext): void {
  const { type, from, to, actor, reason } = ctx;

  if (isTerminal(type, from)) {
    // Terminal states are immutable — corrections are notes/audit, never status.
    throw new TransitionError(
      "TERMINAL_STATE",
      `A ${type} in state "${from}" is terminal and cannot be reopened.`,
    );
  }

  const rows = ALLOWED[type][from] ?? [];
  const matching = rows.filter((r) => r.to === to);
  if (matching.length === 0) {
    throw new TransitionError(
      "INVALID_TRANSITION",
      `"${from}" → "${to}" is not a valid ${type} transition.`,
    );
  }

  const permitted = matching.find(
    (r) => r.actor === "any" || r.actor === actor,
  );
  if (!permitted) {
    throw new TransitionError(
      "ACTOR_NOT_PERMITTED",
      `Actor "${actor}" may not perform "${from}" → "${to}" on a ${type}.`,
    );
  }

  if (permitted.reason === "required" && !reason?.trim()) {
    throw new TransitionError(
      "REASON_REQUIRED",
      `A reason is required for "${from}" → "${to}".`,
    );
  }

  // Unified cancellation rule (v1.2.4 shared rules)
  if (to === "Cancelled" && actor === "customer") {
    if (!CUSTOMER_CANCELABLE.includes(from)) {
      throw new TransitionError(
        "ACTOR_NOT_PERMITTED",
        "Customers may only cancel before staff acceptance.",
      );
    }
  }
}

/** Delivery-matrix coupling rules — v1.2.4 §4.4: delivery events → parent refill effects. */
export type DeliveryEvent =
  | "preparing"
  | "dispatched"
  | "delivered"
  | "failed";

export interface ParentEffect {
  from: RequestStatus;
  to: RequestStatus;
  actor: "system";
}

/**
 * Server-derived parent refill transitions. Delivery personnel never post
 * parent transitions directly — the API layer calls this inside the same
 * transaction as the delivery update, validating against the refill matrix.
 * Returns null when the delivery event has no parent effect (e.g. failed
 * from Assigned → parent stays Accepted).
 */
export function parentEffectFor(
  event: DeliveryEvent,
  parentStatus: RequestStatus,
  opts: { retryable: boolean; canRetry: boolean },
): ParentEffect | null {
  if (event === "preparing") {
    if (parentStatus === "Accepted") {
      return { from: "Accepted", to: "Processing", actor: "system" };
    }
    return null;
  }
  if (event === "dispatched") {
    if (parentStatus === "Processing") {
      return { from: "Processing", to: "Dispatched", actor: "system" };
    }
    return null;
  }
  if (event === "delivered") {
    if (parentStatus === "Dispatched") {
      return { from: "Dispatched", to: "Completed", actor: "system" }; // D4
    }
    return null;
  }
  // failed
  if (parentStatus === "Dispatched" && opts.retryable && opts.canRetry) {
    return { from: "Dispatched", to: "Processing", actor: "system" }; // D1
  }
  // Failed from Assigned → parent stays Accepted; from Preparing → stays Processing;
  // exhausted/non-retryable from Dispatched → stays Dispatched (staff resolve via A1.1)
  return null;
}

/**
 * Retry eligibility — v1.2.4 corrected semantics:
 * max_retries = additional attempts AFTER the original.
 * With max_retries = 2 → original + retry1 + retry2 = 3 total attempts.
 * Evaluated AFTER the failure is recorded (attempt row inserted) in the same tx.
 */
export function canCreateRetry(
  totalAttempts: number,
  maxRetries: number,
  parentTerminal: boolean,
): boolean {
  if (parentTerminal) return false; // no retry for terminal parent refill
  return totalAttempts < maxRetries + 1;
}
