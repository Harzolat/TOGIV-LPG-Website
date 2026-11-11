import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { LinkCandidate, RequestListItem } from "../lib/types";
import { useAuth } from "../lib/auth";
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from "@togi/ui";

/**
 * My requests — authenticated dashboard:
 * - request list (newest first) with status pills
 * - confirmation-required guest linking (v1.2 §1.4.2): candidates found by
 *   phone are NEVER auto-linked; the customer picks and confirms
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Account() {
  const { user } = useAuth();
  const [items, setItems] = useState<RequestListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkDone, setLinkDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ requests: RequestListItem[] }>("/requests/mine");
      setItems(res.requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your requests.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One-time candidate check: only if the account has no requests yet —
  // that's the moment a freshly registered customer has guest history.
  useEffect(() => {
    if (items && items.length === 0 && !linkDone) {
      api<{ candidates: LinkCandidate[] }>("/requests/link/candidates", { method: "POST" })
        .then((res) => setCandidates(res.candidates))
        .catch(() => setCandidates([])); // silent: linking is optional
    }
  }, [items, linkDone]);

  async function confirmLink() {
    if (selected.size === 0) return;
    setLinking(true);
    setLinkError(null);
    try {
      await api("/requests/link/confirm", {
        method: "POST",
        body: { requestIds: [...selected] },
      });
      setLinkDone(true);
      setCandidates(null);
      await load();
    } catch (err) {
      setLinkError(err instanceof ApiError ? err.message : "Could not link these requests.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My requests</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Signed in as {user?.phone}
          </p>
        </div>
        <Link to="/request" className="t-btn t-btn--primary t-btn--md">
          New request
        </Link>
      </div>

      {/* Guest-history linking — confirmation required, never silent */}
      {candidates && candidates.length > 0 ? (
        <Card className="mt-6" padded title="Requests made before you registered?">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            We found {candidates.length} request
            {candidates.length === 1 ? "" : "s"} submitted with your number as a guest.
            Select the ones that are yours to add them to your account.
          </p>
          <ul className="mt-4 space-y-2">
            {candidates.map((c) => (
              <li key={c.id}>
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                  style={{ borderColor: selected.has(c.id) ? "var(--primary)" : "var(--border)" }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setSelected(next);
                    }}
                  />
                  <span className="flex-1">
                    <span className="block font-mono text-sm font-medium">{c.reference}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.type} · submitted {formatDate(c.createdAt)}
                    </span>
                  </span>
                  <StatusPill status={c.status} />
                </label>
              </li>
            ))}
          </ul>
          {linkError ? (
            <p role="alert" className="mt-3 text-sm" style={{ color: "var(--error)" }}>
              {linkError}
            </p>
          ) : null}
          <div className="mt-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setCandidates(null)} disabled={linking}>
              Not now
            </Button>
            <Button onClick={() => void confirmLink()} loading={linking} disabled={selected.size === 0}>
              Link {selected.size > 0 ? `${selected.size} ` : ""}selected
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-8">
        {error ? (
          <ErrorState
            title="Couldn't load your requests"
            description={error}
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        ) : items === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height="4.5rem" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="When you submit a refill, complaint or enquiry it will appear here with live status."
            action={
              <Link to="/request" className="t-btn t-btn--primary t-btn--md">
                Submit your first request
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {items.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/account/requests/${r.id}`}
                  className="t-card t-lift flex items-center justify-between gap-4 p-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm font-semibold">{r.reference}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.type}
                      {r.deliveryMethod === "home"
                        ? " · home delivery"
                        : r.deliveryMethod === "station"
                          ? " · station pick-up"
                          : ""}{" "}
                      · {formatDate(r.createdAt)}
                    </span>
                  </span>
                  <StatusPill status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
