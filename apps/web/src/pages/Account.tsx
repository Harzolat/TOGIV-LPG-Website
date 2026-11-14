import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { usePolling } from "../lib/usePolling";
import type { LinkCandidate, RequestListItem, RequestStatus } from "../lib/types";
import { useAuth } from "../lib/auth";
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from "@togi/ui";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusText(status: RequestStatus, deliveryMethod?: string | null): string {
  if (deliveryMethod === "home" && status === "Dispatched") return "Team en route";
  return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

const ACTIVE: RequestStatus[] = [
  "Submitted",
  "Received",
  "UnderReview",
  "Accepted",
  "Processing",
  "Dispatched",
  "Escalated",
];

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
    try {
      const res = await api<{ requests: RequestListItem[] }>("/requests/mine");
      setItems(res.requests);
      setError(null);
    } catch (err) {
      if (items === null) {
        setError(err instanceof ApiError ? err.message : "Could not load your requests.");
      }
    }
  }, [items]);

  usePolling(load, { intervalMs: 12_000 });

  useEffect(() => {
    if (items && items.length === 0 && !linkDone) {
      api<{ candidates: LinkCandidate[] }>("/requests/link/candidates", { method: "POST" })
        .then((res) => setCandidates(res.candidates))
        .catch(() => setCandidates([]));
    }
  }, [items, linkDone]);

  const sorted = useMemo(() => {
    const list = [...(items ?? [])];
    list.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
    return list;
  }, [items]);

  const active = useMemo(() => sorted.filter((r) => ACTIVE.includes(r.status)), [sorted]);
  const closed = useMemo(() => sorted.filter((r) => !ACTIVE.includes(r.status)), [sorted]);
  const featured = active[0] ?? null;

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
    <div className="mx-auto max-w-3xl anim-enter">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Welcome{user?.profile?.fullName ? `, ${user.profile.fullName}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">My requests</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Signed in as {user?.phone || "your account"}
          </p>
        </div>
        <Link to="/request" className="t-btn t-btn--primary t-btn--md w-full sm:w-auto">
          New refill request
        </Link>
      </div>

      {candidates && candidates.length > 0 ? (
        <Card className="mt-6" padded title="Requests made before you registered?">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            We found {candidates.length} request{candidates.length === 1 ? "" : "s"} submitted with your number as a guest.
            Select the ones that are yours to add them to your account. We never link requests automatically.
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
                  <span className="min-w-0 flex-1">
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
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
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
        {error && items === null ? (
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
              <Skeleton key={i} height="5rem" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No requests yet"
            description="Place your first refill request and track its progress here."
            action={
              <Link to="/request" className="t-btn t-btn--primary t-btn--md">
                Submit your first request
              </Link>
            }
          />
        ) : (
          <div className="space-y-6">
            {featured ? (
              <section aria-labelledby="active-heading">
                <h2 id="active-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Active request
                </h2>
                <Link to={`/account/requests/${featured.id}`} className="t-card t-lift block p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-base font-semibold">{featured.reference}</p>
                      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                        {featured.type === "refill" ? "Refill" : featured.type}
                        {featured.deliveryMethod === "home"
                          ? " · On-site refill"
                          : featured.deliveryMethod === "station"
                            ? " · Station refill"
                            : ""}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        Submitted {formatDate(featured.createdAt)} · Updated {formatDate(featured.updatedAt || featured.createdAt)}
                      </p>
                    </div>
                    <StatusPill
                      status={featured.status}
                      label={statusText(featured.status, featured.deliveryMethod)}
                    />
                  </div>
                  <span className="mt-4 inline-flex min-h-[44px] items-center text-sm font-medium" style={{ color: "var(--primary)" }}>
                    View details →
                  </span>
                </Link>

                {active.length > 1 ? (
                  <div className="mt-4">
                    <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
                      Other active requests
                    </h3>
                    <ul className="space-y-2">
                      {active.slice(1).map((r) => (
                        <li key={r.id}>
                          <Link
                            to={`/account/requests/${r.id}`}
                            className="t-card t-lift flex items-center justify-between gap-3 p-3 sm:p-4"
                          >
                            <span className="min-w-0">
                              <span className="block font-mono text-sm font-semibold">{r.reference}</span>
                              <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                                Updated {formatDate(r.updatedAt || r.createdAt)}
                              </span>
                            </span>
                            <StatusPill status={r.status} label={statusText(r.status, r.deliveryMethod)} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            {closed.length > 0 ? (
              <section aria-labelledby="history-heading">
                <h2 id="history-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Request history
                </h2>
                <ul className="space-y-2">
                  {closed.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/account/requests/${r.id}`}
                        className="t-card t-lift flex items-center justify-between gap-3 p-3 sm:p-4"
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-sm font-semibold">{r.reference}</span>
                          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                            {r.type === "refill" ? "Refill" : r.type} · {formatDate(r.updatedAt || r.createdAt)}
                          </span>
                        </span>
                        <StatusPill status={r.status} label={statusText(r.status, r.deliveryMethod)} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
