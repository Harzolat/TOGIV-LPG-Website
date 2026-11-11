import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from "@togi/ui";
import type { ClaimListItem, ClaimState } from "@togi/shared";

/**
 * Claims queue — staff review screen. Mirrors the request queue shape
 * (filter bar → list → detail), using the claim states from @togi/shared
 * so the tone mapping stays consistent with the rest of the console
 * (approved = success, rejected = error, pending = info).
 *
 * The API returns the immutable claim plus its state projection; the list
 * renders the projection and links to the detail screen for the history and
 * decision controls.
 */
const FILTER_KEYS = ["all", "pending", "approved", "rejected", "withdrawn"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const EMPTY_COUNTS: Record<ClaimState, number> = {
  pending: 0,
  approved: 0,
  rejected: 0,
  withdrawn: 0,
};

function stateOf(c: ClaimListItem): ClaimState {
  return c.state?.currentState ?? "pending";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Claims() {
  const [items, setItems] = useState<ClaimListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ claims: ClaimListItem[] }>("/claims");
      setItems(res.claims);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the claims queue.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts =
    items?.reduce<Record<ClaimState, number>>((acc, c) => {
      acc[stateOf(c)] += 1;
      return acc;
    }, { ...EMPTY_COUNTS }) ?? EMPTY_COUNTS;

  const visible = items?.filter((c) => filter === "all" || stateOf(c) === filter) ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Claims</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Staff queue for cylinder and service claims.
        </p>
      </div>

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
            {k === "all"
              ? `All (${counts.pending + counts.approved + counts.rejected + counts.withdrawn})`
              : k === "pending"
                ? `Pending (${counts.pending})`
                : k === "approved"
                  ? `Approved (${counts.approved})`
                  : k === "rejected"
                    ? `Rejected (${counts.rejected})`
                    : `Withdrawn (${counts.withdrawn})`}
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
      ) : visible?.length === 0 ? (
        <EmptyState
          title={items?.length ? "No claims match this filter" : "No claims in the queue"}
          description={
            items?.length
              ? "Try another state, or clear the filter to see every claim."
              : "All claims are decided or withdrawn. A new claim will appear here after a customer submits one."
          }
          action={
            items?.length ? (
              <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                Clear filter
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Refresh
              </Button>
            )
          }
        />
      ) : (
        <div className="mt-6">
          <Card padded title="Claims">
            <ul className="divide-y divide-[var(--border)]">
              {visible?.map((c) => {
                const serial = c.cylinder?.serial ?? c.qrCode?.serial ?? null;
                return (
                  <li key={c.id}>
                    <Link
                      to={`/claims/${c.id}`}
                      className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-[var(--surface)]"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold">
                          {c.claimant?.fullName ?? c.id.slice(0, 8)}
                        </span>
                        <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                          {c.claimType.replace(/_/g, " ")} · {formatDate(c.createdAt)}
                          {serial ? (
                            <span className="block font-mono" style={{ color: "var(--primary)" }}>
                              Cylinder {serial}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <StatusPill status={stateOf(c)} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
