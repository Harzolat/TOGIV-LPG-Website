import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@togi/ui";
import type { CustomerProfile } from "@togi/shared";

/**
 * Customers — staff directory. Mirrors the queue/claims list pattern
 * (filter → list → detail) using the CustomerProfile shape from the
 * shared types, so the console shows only what the staff role is
 * permitted to read.
 */
const FILTER_KEYS = ["all", "active"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Customers() {
  const [items, setItems] = useState<CustomerProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ customers: CustomerProfile[] }>("/customers");
      setItems(res.customers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the customer directory.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Customer directory — name, phone, profile state.
          </p>
        </div>
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
            {k === "all" ? "All" : "Active"}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState
          title="Couldn't load the directory"
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
      ) : items?.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Customers appear here after they register or submit their first request."
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          }
        />
      ) : (
        <div className="mt-6">
          <Card padded title="Customer directory">
            <ul className="divide-y divide-[var(--border)]">
              {items?.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/customers/${c.id}`}
                    className="flex items-center justify-between gap-4 p-3 transition-colors hover:bg-[var(--surface)]"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-semibold">{c.fullName ?? c.phone}</span>
                      <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                        {c.phone} · {formatDate(c.createdAt)}
                      </span>
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.state ?? "—"}
                    </span>
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
