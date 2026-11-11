/**
 * Shared domain types, status enums and validation schemas.
 * Transition matrices per planning document v1.2.4 Part 4.
 */

export const REFILL_TERMINAL_STATUSES = [
  "Completed",
  "Rejected",
  "Cancelled",
] as const;

export const COMPLAINT_TERMINAL_STATUSES = [
  "Resolved",
  "Rejected",
  "Cancelled",
] as const;

export const ENQUIRY_TERMINAL_STATUSES = [
  "Completed",
  "Rejected",
  "Cancelled",
] as const;

export type RequestType = "refill" | "complaint" | "enquiry";

export type DeliveryStatus =
  | "Awaiting Assignment"
  | "Assigned"
  | "Preparing"
  | "Dispatched"
  | "Arrived"
  | "Delivered"
  | "Failed";

export const DELIVERY_ACTIVE_STATUSES: readonly DeliveryStatus[] = [
  "Awaiting Assignment",
  "Assigned",
  "Preparing",
  "Dispatched",
  "Arrived",
];

export function isTerminalStatus(type: RequestType, status: string): boolean {
  switch (type) {
    case "refill":
      return (REFILL_TERMINAL_STATUSES as readonly string[]).includes(status);
    case "complaint":
      return (COMPLAINT_TERMINAL_STATUSES as readonly string[]).includes(status);
    case "enquiry":
      return (ENQUIRY_TERMINAL_STATUSES as readonly string[]).includes(status);
  }
}

/** Customer self-cancellation window — unified across all request types. */
export const CUSTOMER_CANCELABLE_STATUSES = [
  "Submitted",
  "Received",
  "UnderReview",
] as const;

export * from "./transitions";
export * from "./api";
