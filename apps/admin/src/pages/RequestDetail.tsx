import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button, Card, ErrorState, Modal, Skeleton, StatusPill, useToast } from "@togi/ui";
import type { RequestDetail as RequestDetailPayload, RequestStatus } from "@togi/shared";

/**
 * Request detail — operator view of a single request.
 *
 * Staff see the full timeline (including customer-visible notes), every
 * message including internal notes, and the delivery attempt history.
 * Status moves go through POST /requests/:id/transition, where the server
 * validates them against the approved matrices (v1.2 Part 4) — the select
 * below is a convenience, not the control.
 */
export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [data, setData] = useState<RequestDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionTo, setTransitionTo] = useState<RequestStatus | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setData(await api<RequestDetailPayload>(`/requests/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this request.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmTransition() {
    if (!transitionTo) return;
    setSubmitting(true);
    try {
      await api(`/requests/${id}/transition`, {
        method: "POST",
        body: { to: transitionTo, reason: note || undefined },
      });
      setTransitionOpen(false);
      setTransitionTo("");
      setNote("");
      toast({ message: "Status updated.", tone: "success" });
      await load();
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : "Could not update the status.", tone: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/queue" className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Back to queue
      </Link>

      {error ? (
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
                {data.type} · submitted {formatDate(data.createdAt)}
                {data.contactPhone ? (
                  <span className="block text-xs font-mono" style={{ color: "var(--primary)" }}>
                    {data.contactPhone}
                  </span>
                ) : null}
              </p>
            </div>
            <StatusPill status={data.status} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTransitionOpen(true)}>
              Change status
            </Button>
          </div>

          {/* Status timeline from append-only history */}
          <Card className="mt-6" padded title="Progress">
            <ol className="space-y-4">
              {data.statusHistory.length === 0 ? (
                <li className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Submitted — awaiting the team&apos;s first update.
                </li>
              ) : (
                data.statusHistory.map((h) => (
                  <li key={h.id} className="flex gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--primary)" }} aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium">
                        {h.fromStatus ? `${h.fromStatus.replace(/([a-z])([A-Z])/g, "$1 $2")} → ` : ""}
                        {h.toStatus.replace(/([a-z])([A-Z])/g, "$1 $2")}
                      </p>
                      {h.note ? (
                        <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>{h.note}</p>
                      ) : null}
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {formatDate(h.createdAt)}
                        {h.visibleToCustomer ? "" : " · internal"}
                      </p>
                    </div>
                  </li>
                ))
              )}
            </ol>
          </Card>

          {/* Delivery attempts (retries visible as history, v1.2 §A1) */}
          {data.deliveries.length ? (
            <Card className="mt-5" padded title="Delivery attempts">
              <ul className="space-y-3">
                {data.deliveries.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Attempt {d.attemptNumber}</p>
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

          {/* Messages — staff see internal notes too, clearly marked */}
          {data.messages.length ? (
            <Card className="mt-5" padded title="Messages">
              <ul className="space-y-3">
                {data.messages.map((m) => (
                  <li key={m.id}>
                    <p className="text-sm">{m.body}</p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatDate(m.createdAt)}
                      {m.internal ? (
                        <span className="ml-1.5" style={{ color: "var(--accent-text)" }}>
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
            onClose={() => setTransitionOpen(false)}
            title="Change status"
            footer={
              <>
                <Button variant="ghost" onClick={() => setTransitionOpen(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void confirmTransition()} loading={submitting} disabled={!transitionTo}>
                  Update status
                </Button>
              </>
            }
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Status moves are validated against the request matrix server-side. A reason is
              recorded in the history for staff actions.
            </p>
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
              <option value="Dispatched">Dispatched</option>
              <option value="Completed">Completed</option>
              <option value="Resolved">Resolved</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Escalated">Escalated</option>
            </select>
            <textarea
              className="mt-3 t-input"
              rows={3}
              placeholder="Reason (recorded in history)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Reason"
            />
          </Modal>
        </>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
