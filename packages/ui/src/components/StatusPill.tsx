/**
 * StatusPill — maps domain status strings to semantic tones.
 * Dumb component: apps pass the raw status; tone mapping lives here so
 * request/delivery/claim statuses render consistently in both apps.
 */

export type PillTone = "neutral" | "info" | "success" | "warning" | "error";

const TONES: Record<string, PillTone> = {
  // Request statuses
  Submitted: "neutral",
  Received: "info",
  UnderReview: "info",
  Accepted: "info",
  Processing: "info",
  Dispatched: "warning",
  Completed: "success",
  Resolved: "success",
  Rejected: "error",
  Cancelled: "neutral",
  Escalated: "error",
  // Delivery statuses
  AwaitingAssignment: "neutral",
  Assigned: "info",
  Preparing: "info",
  Arrived: "info",
  Delivered: "success",
  Failed: "error",
  // Claim states
  pending: "info",
  approved: "success",
  rejected: "error",
  withdrawn: "neutral",
  // QR states
  unassigned: "neutral",
  active: "success",
  deactivated: "neutral",
  replaced: "warning",
  revoked: "error",
};

/** Human label: "UnderReview" → "Under review". */
export function statusLabel(status: string): string {
  const spaced = status.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface StatusPillProps {
  status: string;
  label?: string;
  tone?: PillTone;
}

export function StatusPill({ status, label, tone }: StatusPillProps) {
  const resolved = tone ?? TONES[status] ?? "neutral";
  return (
    <span className={`t-pill t-pill--${resolved}`}>
      <span className="t-pill__dot" aria-hidden="true" />
      {label ?? statusLabel(status)}
    </span>
  );
}
