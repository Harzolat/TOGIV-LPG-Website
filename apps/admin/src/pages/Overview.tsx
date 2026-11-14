import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import {
  Button,
  Card,
  ErrorState,
  Skeleton,
  StatusPill,
  statusLabel,
} from "@togi/ui";
import type { AdminOverview } from "@togi/shared";
import { usePolling } from "../lib/usePolling";

/**
 * Operations overview — the console's landing screen.
 *
 * Focuses on orders needing attention and the oldest waiting requests.
 * Polls while the tab is visible so updates appear without a reload.
 */

function age(iso: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "accent" | "primary";
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: "var(--border)",
        background: "var(--surface)",
      }}
    >
      <p
        className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </p>
      <p
        className="mt-2 text-3xl font-semibold tabular-nums tracking-tight"
        style={{
          color:
            tone === "accent"
              ? "var(--accent-text)"
              : tone === "primary"
                ? "var(--primary)"
                : "var(--text)",
        }}
      >
        {value}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {hint}
      </p>
    </div>
  );
}



export default function Overview() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverview>("/admin/overview"));
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load the operations overview.",
      );
    }
  }, []);

  usePolling(load, { intervalMs: 8_000 });

  if (error && !data) {
    return (
      <ErrorState
        title="Couldn't load the overview"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton width="14rem" height="2rem" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height="7rem" />
          ))}
        </div>
        <Skeleton height="14rem" />
      </div>
    );
  }

  const { counts } = data;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Your on-site refill operations at a glance — review new orders, plan visits, and
            track progress. Updates automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Link to="/queue" className="t-btn t-btn--primary t-btn--sm">
            Open orders
          </Link>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--success, #4ade80)" }}
              aria-hidden="true"
            />
            Live
            {updatedAt ? ` · ${clock(updatedAt.toISOString())}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-xs" style={{ color: "var(--accent-text)" }} role="status">
          Showing the last good snapshot. {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label="Needs review"
          value={counts.needsAttention}
          hint="New or under review — decide next step"
          tone="accent"
        />
        <Kpi
          label="Active orders"
          value={counts.active}
          hint="In progress before completion or closure"
          tone="primary"
        />
        <Kpi
          label="Closed today"
          value={counts.completedToday}
          hint="Completed or resolved"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card padded title="Needs review — oldest first">
          {data.oldestWaiting.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Nothing waiting for review right now. New refill orders will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.oldestWaiting.map((request) => (
                <li key={request.id}>
                  <Link
                    to={`/requests/${request.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 transition-opacity hover:opacity-80"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-semibold">
                        {request.reference}
                      </span>
                      <span
                        className="mt-0.5 block break-words text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {request.customer?.fullName ?? request.contactPhone} ·{" "}
                        {request.type} · waiting {age(request.createdAt)}
                      </span>
                    </span>
                    <StatusPill status={request.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/queue"
            className="mt-4 inline-block text-sm font-medium"
            style={{ color: "var(--primary)" }}
          >
            Open orders →
          </Link>
        </Card>

        <Card padded title="Recent activity">
          {data.activity.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No status moves yet today.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.activity.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm">
                      <span className="font-mono font-semibold">{row.reference}</span>{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        {row.fromStatus
                          ? `${statusLabel(row.fromStatus)} → `
                          : ""}
                      </span>
                      {statusLabel(row.toStatus)}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {row.actorName ?? (row.actorKind === "system" ? "System" : row.actorKind)}
                      {" · "}
                      {clock(row.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
