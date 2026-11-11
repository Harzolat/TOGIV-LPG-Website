import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button, Card, ErrorState, Modal, Skeleton, StatusPill, useToast } from "@togi/ui";
import type { ClaimDetail as ClaimDetailPayload, ClaimState } from "@togi/shared";

/**
 * Claim detail — the staff review screen. Mirrors the request detail page:
 * immutable history, state projection, decision controls, and reopens.
 * All writes are validated server-side; this page is deliberately
 * read-only for the customer-visible fields (the API has already
 * resolved `claim:view` / `claim:decide`).
 */
export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [claim, setClaim] = useState<ClaimDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setClaim(await api<ClaimDetailPayload>(`/claims/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this claim.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide() {
    if (!decision) return;
    setDeciding(true);
    try {
      await api(`/claims/${id}/decide`, {
        method: "POST",
        body: { decision, note: note || undefined },
      });
      setDecision("");
      setNote("");
      toast({ message: `Claim ${decision}.`, tone: "success" });
      await load();
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : "Could not decide the claim.", tone: "error" });
    } finally {
      setDeciding(false);
    }
  }

  async function confirmReopen() {
    if (!reopenReason.trim()) return;
    setReopening(true);
    try {
      await api(`/claims/${id}/reopen`, {
        method: "POST",
        body: { reason: reopenReason.trim() },
      });
      setReopenOpen(false);
      setReopenReason("");
      toast({ message: "Claim reopened.", tone: "success" });
      await load();
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : "Could not reopen the claim.", tone: "error" });
    } finally {
      setReopening(false);
    }
  }

  const state: ClaimState = claim?.state?.currentState ?? "pending";
  const canDecide = state === "pending";
  const canReopen = state === "rejected";

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/claims" className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Back to claims
      </Link>

      {error ? (
        <ErrorState
          title="Couldn't open this claim"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : !claim ? (
        <div className="mt-6 space-y-3">
          <Skeleton width="10rem" height="1.75rem" />
          <Skeleton height="3rem" />
          <Skeleton height="12rem" />
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {claim.claimant?.fullName ?? "Claim"}
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {claim.claimType.replace(/_/g, " ")} · submitted {formatDate(claim.createdAt)}
                {claim.cylinder?.serial ? (
                  <span className="block text-xs font-mono" style={{ color: "var(--primary)" }}>
                    Cylinder {claim.cylinder.serial}
                  </span>
                ) : null}
              </p>
            </div>
            <StatusPill status={state} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {canDecide ? (
              <>
                <Button variant="primary" size="sm" onClick={() => setDecision("approved")} disabled={deciding}>
                  Approve
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDecision("rejected")} disabled={deciding}>
                  Reject
                </Button>
              </>
            ) : null}
            {canReopen ? (
              <Button variant="secondary" size="sm" onClick={() => setReopenOpen(true)} disabled={reopening}>
                Reopen
              </Button>
            ) : null}
          </div>

          {claim.evidenceNote ? (
            <Card className="mt-6" padded title="Customer's evidence">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {claim.evidenceNote}
              </p>
              {claim.linkReviewRequired ? (
                <p className="mt-3 text-xs" style={{ color: "var(--accent-text)" }}>
                  Flagged for link review — confirm the cylinder/QR identity before deciding.
                </p>
              ) : null}
            </Card>
          ) : null}

          {/* State projection + history */}
          <Card className="mt-5" padded title="Review">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">State</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {state}
                </p>
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Reviewed {claim.state?.reviewedAt ? formatDate(claim.state.reviewedAt) : "—"}
              </div>
            </div>
            {claim.state?.decisionNote ? (
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                {claim.state.decisionNote}
              </p>
            ) : null}
          </Card>

          <Card className="mt-5" padded title="History">
            <ul className="space-y-3">
              {claim.events.map((e) => (
                <li key={e.id}>
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--primary)" }} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{e.eventType}</p>
                      {e.decisionNote ? (
                        <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>{e.decisionNote}</p>
                      ) : null}
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {formatDate(e.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {claim.cylinder ? (
            <Card className="mt-5" padded title="Cylinder">
              <dl className="flex flex-wrap gap-4 text-sm">
                <div>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Serial</dt>
                  <dd className="font-mono">{claim.cylinder.serial ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Label</dt>
                  <dd className="font-mono">{claim.cylinder.label ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Owner</dt>
                  <dd className="font-mono">{claim.cylinder.ownerCustomerId ?? "company stock"}</dd>
                </div>
              </dl>
            </Card>
          ) : null}

          <Modal
            open={reopenOpen}
            onClose={() => setReopenOpen(false)}
            title="Reopen this claim?"
            footer={
              <>
                <Button variant="ghost" onClick={() => setReopenOpen(false)} disabled={reopening}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void confirmReopen()}
                  loading={reopening}
                  disabled={!reopenReason.trim()}
                >
                  Reopen
                </Button>
              </>
            }
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              A reopened claim returns to pending with the prior decision preserved in history.
              A reason is required.
            </p>
            <textarea
              className="t-input mt-4"
              rows={3}
              placeholder="Reason for reopening"
              maxLength={500}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              aria-label="Reopen reason"
            />
          </Modal>

          <Modal
            open={decision !== ""}
            onClose={() => setDecision("")}
            title={decision === "approved" ? "Approve this claim?" : "Reject this claim?"}
            size="lg"
            footer={
              <>
                <Button variant="ghost" onClick={() => setDecision("")} disabled={deciding}>
                  Cancel
                </Button>
                <Button
                  variant={decision === "approved" ? "primary" : "danger"}
                  onClick={() => void decide()}
                  loading={deciding}
                >
                  {decision === "approved" ? "Approve" : "Reject"}
                </Button>
              </>
            }
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Approving a register claim registers the service (cylinder ownership is only
              changed on a dispute approval). The decision is recorded in the claim history.
            </p>
            <textarea
              className="mt-3 t-input"
              rows={3}
              placeholder="Decision note (recommended — recorded in history)"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Decision note"
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
