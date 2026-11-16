import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { usePolling } from "../lib/usePolling";
import type { RequestDetail, RequestStatus } from "../lib/types";
import { Button, Card, ErrorState, Modal, Skeleton, StatusPill, useToast } from "@togi/ui";
import { CUSTOMER_CANCELABLE_STATUSES } from "@togi/shared";

function statusText(
  status: RequestStatus,
  type: string,
  deliveryMethod?: string | null,
): string {
  if (type === "refill" && deliveryMethod === "home" && status === "Dispatched") {
    return "Team on the way";
  }
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// Payment tracking removed from the website/app flow.

/**
 * Request detail (owner view) — full customer-visible history:
 * - status timeline from the append-only history
 * - non-internal messages only (server also filters)
 * - delivery attempt history incl. retries (v1.2 §A1)
 * - customer cancellation only within the pre-acceptance window (matrix)
 */

export default function AccountRequest() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setData(await api<RequestDetail>(`/requests/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this request.");
    }
  }, [id]);

  usePolling(load, { intervalMs: 12_000 });

  async function confirmCancel() {
    setCancelling(true);
    try {
      await api(`/requests/${id}/cancel`, {
        method: "POST",
        body: cancelReason.trim() ? { reason: cancelReason.trim() } : {},
      });
      setCancelOpen(false);
      toast({ message: "Request cancelled.", tone: "success" });
      await load();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : "Couldn’t cancel this request.",
        tone: "error",
      });
    } finally {
      setCancelling(false);
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState
          title="Couldn't open this request"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
        <div className="mt-4 text-center">
          <Link to="/account" className="text-sm underline">
            Back to my requests
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton width="14rem" height="1.75rem" />
        <Skeleton height="10rem" />
        <Skeleton height="6rem" />
      </div>
    );
  }

  const canCancel =
    (CUSTOMER_CANCELABLE_STATUSES as readonly RequestStatus[]).includes(data.status);
  const visibleHistory = data.statusHistory.filter((h) => h.visibleToCustomer);

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/account" className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Back to my requests
      </Link>

      {data.contactPhone ? (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Contact: {data.contactPhone}
        </p>
      ) : null}

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-xl font-semibold">{data.reference}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {data.type === "refill" ? "Refill" : data.type}
            {data.deliveryMethod === "home"
              ? " · On-site refill"
              : data.deliveryMethod === "station"
                ? " · Station refill"
                : ""}{" "}
            · submitted{" "}
            {new Date(data.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <StatusPill
          status={data.status}
          label={statusText(data.status, data.type, data.deliveryMethod)}
        />
      </div>

      {canCancel ? (
        <div
          className="mt-5 flex items-center justify-between gap-4 rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Changed your mind? You can cancel before our team accepts the request.
          </p>
          <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
            Cancel request
          </Button>
        </div>
      ) : null}

      {data.type === "refill" ? (
        <Card className="mt-6" padded title="Refill details">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt style={{ color: "var(--text-muted)" }}>Refill option</dt>
              <dd className="mt-0.5 font-medium">
                {data.deliveryMethod === "home"
                  ? "On-site refill (we come to your location)"
                  : "Station refill (bring your cylinder)"}
              </dd>
            </div>
          </dl>
          {data.deliveryMethod === "home" ? (
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Our team fills your cylinder at your location — no cylinder is dispatched to you.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Timeline from append-only history */}
      <Card className="mt-6" padded title="Progress">
        <ol className="space-y-4">
          {visibleHistory.length === 0 ? (
            <li className="text-sm" style={{ color: "var(--text-muted)" }}>
              Submitted — awaiting our team's first update.
            </li>
          ) : (
            visibleHistory.map((h) => (
              <li key={h.id} className="flex gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: "var(--primary)" }}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium">
                    {h.fromStatus
                      ? `${statusText(h.fromStatus, data.type, data.deliveryMethod)} → `
                      : ""}
                    {statusText(h.toStatus, data.type, data.deliveryMethod)}
                  </p>
                  {h.note ? (
                    <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                      {h.note}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {new Date(h.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </li>
            ))
          )}
        </ol>
      </Card>

      {/* Service/visit attempts (when recorded) */}
      {data.deliveries.length > 0 ? (
        <Card className="mt-5" padded title="Service attempts">
          <ul className="space-y-3">
            {data.deliveries.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    Attempt {d.attemptNumber}
                    {d.windowLabel ? (
                      <span className="font-normal" style={{ color: "var(--text-muted)" }}>
                        {" "}
                        · {d.windowLabel}
                      </span>
                    ) : null}
                  </p>
                  {d.failureReason ? (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
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

      {/* Messages (internal notes never reach this view) */}
      {data.messages.length > 0 ? (
        <Card className="mt-5" padded title="Messages">
          <ul className="space-y-3">
            {data.messages.map((m) => (
              <li key={m.id}>
                <p className="text-sm">{m.body}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {new Date(m.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Attachments (when the API surfaces them) */}
      {data.attachments && data.attachments.length > 0 ? (
        <Card className="mt-5" padded title="Attachments">
          <ul className="space-y-3">
            {data.attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{a.name ?? a.kind}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {new Date(a.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this request?"
        dismissable={!cancelling}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void confirmCancel()} loading={cancelling}>
              Yes, cancel
            </Button>
          </>
        }
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          This closes the request. If you still need gas, you can submit a new one afterwards.
          A reason helps us improve.
        </p>
        <textarea
          className="t-input mt-4"
          rows={3}
          placeholder="Reason (optional)"
          maxLength={500}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          aria-label="Cancellation reason"
        />
      </Modal>
    </div>
  );
}
