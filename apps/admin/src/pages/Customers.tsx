import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { usePolling } from "../lib/usePolling";
import { Button, Card, EmptyState, ErrorState, Skeleton, useToast } from "@togi/ui";
import type { CustomerProfile } from "@togi/shared";

/**
 * Customers — staff directory with basic management actions.
 */
const FILTER_KEYS = ["all", "active"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Customers() {
  const { toast } = useToast();
  const [items, setItems] = useState<CustomerProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ customers: CustomerProfile[] }>("/customers");
      setItems(res.customers);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the customer directory.");
    }
  }, []);

  usePolling(load, { intervalMs: 15_000 });

  async function removeCustomer(c: CustomerProfile) {
    const label = c.fullName ?? c.email ?? c.phone ?? "this customer";
    const ok = window.confirm(
      `Permanently delete customer ${label}? Access will be revoked and this action cannot be undone. The account's email/phone details can be used to create a new account afterward.`,
    );
    if (!ok) return;
    setDeletingId(c.id);
    try {
      await api(`/customers/${c.id}`, { method: "DELETE" });
      toast({ message: "Customer permanently deleted.", tone: "success" });
      await load();
    } catch (err) {
      toast({
        message:
          err instanceof ApiError ? err.message : "Could not permanently delete customer.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Customer records, contact details, and order history for quick reference.
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

      {error && items === null ? (
        <ErrorState
          title="Couldn't load the directory"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : items === null ? (
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
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <Link
                    to={`/customers/${c.id}`}
                    className="min-w-0 flex-1 transition-colors hover:opacity-80"
                  >
                    <span className="block font-mono text-sm font-semibold">
                      {c.fullName ?? c.email ?? c.phone ?? "—"}
                    </span>
                    <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.email ?? c.phone ?? "—"} · {formatDate(c.createdAt)}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {c.state ?? "—"}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingId === c.id}
                      onClick={() => void removeCustomer(c)}
                    >
                      Permanently delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
