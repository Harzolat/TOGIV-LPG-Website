import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { usePolling } from "../lib/usePolling";
import {
  Button,
  Card,
  ErrorState,
  Modal,
  Skeleton,
  StatusPill,
  useToast,
} from "@togi/ui";
import {
  nextStaffStep,
  type RequestDetail as RequestDetailPayload,
  type RequestStatus,
} from "@togi/shared";

/**
 * Request detail — operator view of a single request.
 *
 * - Status moves are matrix-validated server-side.
 * - Refills can be marked completed after service is rendered.
 * - On-site refills: "Dispatched" means you are on the way to refill the
 *   customer's cylinder at their location (no cylinder is dispatched).
 */

function statusText(
  status: string,
  type?: string,
  deliveryMethod?: string | null,
): string {
  if (type === "refill" && deliveryMethod === "home" && status === "Dispatched") {
    return "On the way";
  }
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<RequestDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionTo, setTransitionTo] = useState<RequestStatus | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showAllProgress, setShowAllProgress] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await api<RequestDetailPayload>(`/requests/${id}`);
      setData(res);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load this request.",
      );
    }
  }, [id]);

  usePolling(load, { intervalMs: 10_000 });

  async function confirmTransition() {
    if (!transitionTo) return;
    if (transitionTo === "Rejected" && !note.trim()) {
      toast({ message: "Please add a reason before declining this order.", tone: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await api(`/requests/${id}/transition`, {
        method: "POST",
        body: { to: transitionTo, reason: note.trim() || undefined },
      });
      setTransitionOpen(false);
      setTransitionTo("");
      setNote("");
      toast({
        message:
          transitionTo === "Accepted"
            ? "Order accepted."
            : transitionTo === "Rejected"
              ? "Order declined."
              : "Status updated.",
        tone: "success",
      });
      await load();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError
            ? err.message
            : "Could not update the status.",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function quickTransition(to: RequestStatus, reason?: string) {
    if (!id) return;
    setSubmitting(true);
    try {
      await api(`/requests/${id}/transition`, {
        method: "POST",
        body: { to, ...(reason ? { reason } : {}) },
      });
      toast({ message: "Status updated.", tone: "success" });
      await load();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Could not update the status.",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Payment confirmation badge removed per current admin UX request.

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/queue" className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Back to orders
      </Link>

      {error && !data ? (
        <ErrorState
          title="Couldn't open this request"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : !data ? (
        <div className="mt-6 space-y-3">
          <Skeleton width="12rem" height="1.75rem" />
          <Skeleton height="3rem" />
          <Skeleton height="10rem" />
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-mono text-xl font-semibold">{data.reference}</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {data.type === "refill" ? "Refill" : data.type}
                {data.deliveryMethod === "home"
                  ? " · On-site refill (we go to the customer)"
                  : data.deliveryMethod === "station"
                    ? " · Station refill"
                    : ""}{" "}
                · submitted {formatDate(data.createdAt)}
                {data.contactPhone ? (
                  <span
                    className="block text-xs font-mono"
                    style={{ color: "var(--primary)" }}
                  >
                    {data.contactPhone}
                  </span>
                ) : null}
                {data.cylinder ? (
                  <span
                    className="mt-0.5 block text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Cylinder:{" "}
                    {data.cylinder.serial ?? data.cylinder.label ?? data.cylinder.id}
                    {data.cylinder.cylinderType
                      ? ` · ${data.cylinder.cylinderType.capacityKg} kg`
                      : ""}
                  </span>
                ) : null}
              </p>
            </div>
            <StatusPill
              status={data.status}
              label={statusText(data.status, data.type, data.deliveryMethod)}
            />
          </div>

          {null}

          <div className="mt-4">
            {(() => {
              const step = nextStaffStep(data.type, data.status);
              const isOnSiteRefill = data.type === "refill" && data.deliveryMethod === "home";
              const canDecideNow =
                data.status === "Submitted" ||
                data.status === "Received" ||
                data.status === "UnderReview";

              const ensureReview = async () => {
                if (!id) return false;
                try {
                  if (data.status === "Submitted") {
                    await api(`/requests/${id}/transition`, { method: "POST", body: { to: "Received" } });
                    await api(`/requests/${id}/transition`, { method: "POST", body: { to: "UnderReview" } });
                  } else if (data.status === "Received") {
                    await api(`/requests/${id}/transition`, { method: "POST", body: { to: "UnderReview" } });
                  }
                  return true;
                } catch (err) {
                  toast({
                    message: err instanceof ApiError ? err.message : "Could not prepare this order for decision.",
                    tone: "error",
                  });
                  await load();
                  return false;
                }
              };

              const acceptNow = async () => {
                setSubmitting(true);
                try {
                  if (!(await ensureReview())) return;
                  await api(`/requests/${id}/transition`, {
                    method: "POST",
                    body: { to: "Accepted" },
                  });
                  toast({ message: "Order accepted.", tone: "success" });
                  await load();
                } catch (err) {
                  toast({
                    message: err instanceof ApiError ? err.message : "Could not accept this order.",
                    tone: "error",
                  });
                  await load();
                } finally {
                  setSubmitting(false);
                }
              };

              const declineNow = async () => {
                setSubmitting(true);
                try {
                  if (!(await ensureReview())) return;
                  await load();
                  setTransitionTo("Rejected");
                  setNote("");
                  setTransitionOpen(true);
                } catch {
                  // ensureReview/load already handled user feedback
                } finally {
                  setSubmitting(false);
                }
              };

              const runOnTheWay = async () => {
                if (!id) return;
                setSubmitting(true);
                try {
                  if (data.status === "Accepted") {
                    await api(`/requests/${id}/transition`, { method: "POST", body: { to: "Processing" } });
                    await api(`/requests/${id}/transition`, { method: "POST", body: { to: "Dispatched" } });
                  } else if (data.status === "Processing") {
                    await api(`/requests/${id}/transition`, { method: "POST", body: { to: "Dispatched" } });
                  } else {
                    await load();
                    return;
                  }
                  toast({ message: "Marked as on the way.", tone: "success" });
                  await load();
                } catch (err) {
                  toast({
                    message: err instanceof ApiError ? err.message : "Could not update this order.",
                    tone: "error",
                  });
                  await load();
                } finally {
                  setSubmitting(false);
                }
              };

              const runPrimary = async () => {
                if (!step) return;
                if (step.reasonRequired) {
                  setTransitionTo(step.to);
                  setNote("");
                  setTransitionOpen(true);
                } else {
                  await quickTransition(step.to);
                }
              };

              const primaryLabel = (to: RequestStatus) => {
                if (to === "Processing") return "Start processing";
                if (to === "Dispatched") return data.deliveryMethod === "home" ? "On the way" : "Dispatched";
                if (to === "Completed") return "Order completed";
                if (to === "Resolved") return "Mark resolved";
                return statusText(to, data.type, data.deliveryMethod);
              };

              // On-site refills: simplify visible phases to Accept/Decline, On the way, Mark completed.
              const onSitePrimary =
                isOnSiteRefill && !canDecideNow
                  ? data.status === "Accepted" || data.status === "Processing"
                    ? { label: "On the way", action: runOnTheWay }
                    : data.status === "Dispatched"
                      ? { label: "Order completed", action: () => void quickTransition("Completed") }
                      : null
                  : null;

              return (
                <div className="flex flex-wrap gap-2">
                  {canDecideNow ? (
                    <>
                      <Button variant="primary" size="md" loading={submitting} onClick={() => void acceptNow()}>
                        Accept
                      </Button>
                      <Button variant="danger" size="md" loading={submitting} onClick={() => void declineNow()}>
                        Decline
                      </Button>
                    </>
                  ) : onSitePrimary ? (
                    <Button
                      variant="primary"
                      size="md"
                      loading={submitting}
                      onClick={() => void onSitePrimary.action()}
                    >
                      {onSitePrimary.label}
                    </Button>
                  ) : step ? (
                    <Button
                      variant="primary"
                      size="md"
                      loading={submitting}
                      onClick={() => void runPrimary()}
                    >
                      {primaryLabel(step.to)}
                    </Button>
                  ) : null}
                </div>
              );
            })()}
            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {data.status === "Submitted" || data.status === "Received" || data.status === "UnderReview"
                ? "Accept or decline this order. (Required workflow steps are handled automatically.)"
                : data.type === "refill" && data.deliveryMethod === "home" &&
                    (data.status === "Accepted" || data.status === "Processing" || data.status === "Dispatched")
                  ? "Use On the way, then Order completed. (Required workflow steps are handled automatically.)"
                  : "One tap for the next step."}
            </p>
          </div>

          <Card className="mt-5" padded title="Order details">
            {(() => {
              const payload = (data.payload ?? {}) as Record<string, unknown>;
              const addr = (payload.address ?? (data as { address?: unknown }).address ?? null) as
                | {
                    line1?: string;
                    line2?: string | null;
                    city?: string;
                    state?: string;
                    lga?: string;
                    deliveryNote?: string | null;
                  }
                | null;
              const capacity =
                typeof payload.capacityKg === "number"
                  ? `${payload.capacityKg} kg`
                  : data.cylinder?.cylinderType
                    ? `${data.cylinder.cylinderType.capacityKg} kg`
                    : "—";
              const quantity =
                typeof payload.quantity === "number" ? String(payload.quantity) : "—";
              const notes = typeof payload.notes === "string" ? payload.notes : "";
              const location = addr
                ? [addr.line1, addr.line2, addr.city, addr.lga, addr.state]
                    .filter((v): v is string => Boolean(v && String(v).trim()))
                    .join(", ")
                : data.deliveryMethod === "station"
                  ? "Station refill (customer brings cylinder)"
                  : "—";
              const directions = addr?.deliveryNote ?? "";
              return (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt style={{ color: "var(--text-muted)" }}>Customer</dt>
                    <dd className="mt-0.5 font-medium break-words">
                      {data.customer?.fullName ?? "Guest / not provided"}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--text-muted)" }}>Phone</dt>
                    <dd className="mt-0.5 font-medium">
                      {data.contactPhone ? (
                        <a
                          href={`tel:${data.contactPhone}`}
                          className="underline underline-offset-2"
                          style={{ color: "var(--primary)" }}
                        >
                          {data.contactPhone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--text-muted)" }}>Service</dt>
                    <dd className="mt-0.5 font-medium">
                      {data.deliveryMethod === "home"
                        ? "On-site refill (at customer location)"
                        : data.deliveryMethod === "station"
                          ? "Station refill"
                          : data.type === "refill"
                            ? "Refill"
                            : data.type}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--text-muted)" }}>Cylinder / quantity</dt>
                    <dd className="mt-0.5 font-medium">
                      {capacity} · Qty {quantity}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt style={{ color: "var(--text-muted)" }}>Service location</dt>
                    <dd className="mt-0.5 font-medium break-words">{location || "—"}</dd>
                  </div>
                  {directions ? (
                    <div className="sm:col-span-2">
                      <dt style={{ color: "var(--text-muted)" }}>Directions / access notes</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words">{directions}</dd>
                    </div>
                  ) : null}
                  {notes ? (
                    <div className="sm:col-span-2">
                      <dt style={{ color: "var(--text-muted)" }}>Customer instructions</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap break-words">{notes}</dd>
                    </div>
                  ) : null}
                </dl>
              );
            })()}
          </Card>



          <Card className="mt-5" padded title="Progress">
            {(() => {
              const history = data.statusHistory;
              if (history.length === 0) {
                return (
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Submitted — awaiting your first update.
                  </p>
                );
              }
              const latest = history[history.length - 1];
              const visibleHistory = showAllProgress ? history : [latest];
              return (
                <>
                  {!showAllProgress && history.length > 1 ? (
                    <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      Latest of {history.length} updates
                    </p>
                  ) : null}
                  <ol className="space-y-3">
                    {visibleHistory.map((h) => (
                      <li key={h.id} className="flex gap-3">
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: "var(--primary)" }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {h.fromStatus
                              ? `${statusText(h.fromStatus, data.type, data.deliveryMethod)} → `
                              : ""}
                            {statusText(h.toStatus, data.type, data.deliveryMethod)}
                          </p>
                          {h.note ? (
                            <p
                              className="mt-0.5 text-sm"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {h.note}
                            </p>
                          ) : null}
                          <p
                            className="mt-0.5 text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {formatDate(h.createdAt)}
                            {h.visibleToCustomer ? "" : " · internal"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {history.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllProgress((v) => !v)}
                      className="mt-3 text-xs font-medium"
                      style={{ color: "var(--primary)" }}
                    >
                      {showAllProgress
                        ? "Show latest only"
                        : `Show all ${history.length} updates`}
                    </button>
                  ) : null}
                </>
              );
            })()}
          </Card>

          {data.deliveries.length ? (
            <Card className="mt-5" padded title="Service attempts">
              <ul className="space-y-3">
                {data.deliveries.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        Attempt {d.attemptNumber}
                      </p>
                      {d.failureReason ? (
                        <p
                          className="text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Reason: {d.failureReason.replace(/_/g, " ")}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill status={d.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.messages.length ? (
            <Card className="mt-5" padded title="Messages">
              <ul className="space-y-3">
                {data.messages.map((m) => (
                  <li key={m.id}>
                    <p className="text-sm">{m.body}</p>
                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {formatDate(m.createdAt)}
                      {m.internal ? (
                        <span
                          className="ml-1.5"
                          style={{ color: "var(--accent-text)" }}
                        >
                          · internal
                        </span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Modal
            open={transitionOpen}
            onClose={() => {
              setTransitionOpen(false);
              setNote("");
              setTransitionTo("");
            }}
            title={
              transitionTo === "Accepted"
                ? "Accept this order?"
                : transitionTo === "Rejected"
                  ? "Decline this order?"
                  : transitionTo === "UnderReview"
                    ? "Start review?"
                    : transitionTo === "Received"
                      ? "Mark as received?"
                      : "Update progress"
            }
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTransitionOpen(false);
                    setNote("");
                    setTransitionTo("");
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant={transitionTo === "Rejected" ? "danger" : "primary"}
                  onClick={() => void confirmTransition()}
                  loading={submitting}
                  disabled={!transitionTo || (transitionTo === "Rejected" && !note.trim())}
                >
                  {transitionTo === "Accepted"
                    ? "Accept order"
                    : transitionTo === "Rejected"
                      ? "Decline order"
                      : transitionTo === "UnderReview"
                        ? "Start review"
                        : transitionTo === "Received"
                          ? "Mark as received"
                          : "Update status"}
                </Button>
              </>
            }
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {transitionTo === "Accepted"
                ? "Accepting confirms you will handle this refill order. You can continue managing visit progress after acceptance."
                : transitionTo === "Rejected"
                  ? "Declining records this order as rejected with a reason. This action is validated and audited server-side."
                  : transitionTo === "UnderReview"
                    ? "Move this order into review so you can make the accept/decline decision."
                    : transitionTo === "Received"
                      ? "Mark this new order as received, then move it to review to decide."
                      : "Status updates are validated server-side. Refills can be marked completed after service is rendered. For an on-site refill, “Dispatched” means you are on the way."}
            </p>
            {transitionTo === "Accepted" || transitionTo === "Rejected" ? null : (
              <select
                value={transitionTo}
                onChange={(e) => setTransitionTo(e.target.value as RequestStatus | "")}
                className="mt-3 t-input"
                aria-label="New status"
              >
                <option value="">Choose a status</option>
                <option value="Received">Received</option>
                <option value="UnderReview">Under review</option>
                <option value="Accepted">Accepted</option>
                <option value="Processing">Processing</option>
                <option value="Dispatched">Dispatched / On the way</option>
                <option value="Completed">Completed</option>
                <option value="Resolved">Resolved</option>
                <option value="Rejected">Rejected / Declined</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Escalated">Escalated</option>
              </select>
            )}
            <textarea
              className="mt-3 t-input"
              rows={3}
              placeholder={
                transitionTo === "Rejected"
                  ? "Reason for declining this order (required)"
                  : "Note or reason (recorded in history; required for some changes)"
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={transitionTo === "Rejected" ? "Decline reason" : "Reason or note"}
            />
          </Modal>
        </>
      )}
    </div>
  );
}
