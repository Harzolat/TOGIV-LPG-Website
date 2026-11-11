import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from "@togi/ui";
import type { RequestListItem } from "@togi/shared";

/**
 * Staff queue — the main administrative surface. Mirrors the customer account
 * list (same skeleton → empty → list shape, same StatusPill tone mapping) but
 * is global, sorted newest first, and carries a quick-filters bar.
 *
 * Filtering is client-side against the server-returned set: the API already
 * resolves `request:view_all` and returns the queue with names, so the console
 * needs none of the internal fields (payload, history, contactPhone) the
 * customer never sees.
 */
const FILTER_KEYS = ["all", "refill", "complaint", "enquiry"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Queue() {
  const [items, setItems] = useState<RequestListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const qs =
        filter === "all"
          ? "?status=Submitted&status=Received&status=UnderReview&status=Accepted&status=Processing&status=Dispatched"
          : `?type=${filter}`;
      const res = await api<{ requests: RequestListItem[] }>(`/requests${qs}`);
      setItems(res.requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the queue.");
    } finally {
      setBusy(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = items
    ? {
        all: items.length,
        refill: items.filter((r) => r.type === "refill").length,
        complaint: items.filter((r) => r.type === "complaint").length,
        enquiry: items.filter((r) => r.type === "enquiry").length,
      }
    : { all: 0, refill: 0, complaint: 0, enquiry: 0 };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Staff view of all active requests — newest first.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-6 flex flex-wrap gap-2">
        {FILTER_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className="rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              borderColor: filter === k ? "var(--primary)" : "var(--border)",
              color: filter === k ? "var(--primary-hover)" : "var(--text-muted)",
              background: filter === k ? "var(--primary-surface)" : "var(--surface)",
            }}
          >
            {k === "all" ? `All (${counts.all})` : k === "refill" ? `Refill (${counts.refill})` : k === "complaint" ? `Complaint (${counts.complaint})` : `Enquiry (${counts.enquiry})`}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState
          title="Couldn't load the queue"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : busy ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height="4.5rem" />
          ))}
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No requests in the queue"
          description="All requests are closed or terminal. New requests appear here as customers submit them."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          }
        />
      ) : (
        <div className="mt-6">
          <Card padded title="Active requests">
            <ul className="divide-y divide-[var(--border)]">
              {items?.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/requests/${r.id}`}
                    className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-[var(--surface)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm font-semibold">{r.reference}</span>
                      <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.type} · {formatDate(r.createdAt)}
                        {r.contactPhone ? (
                          <span className="block text-xs font-mono" style={{ color: "var(--primary)" }}>
                            {r.contactPhone}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <StatusPill status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
