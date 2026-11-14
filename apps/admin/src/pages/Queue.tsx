import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  StatusPill,
  statusLabel,
  useToast,
} from "@togi/ui";
import {
  nextStaffStep,
  type RequestListItem,
  type RequestStatus,
} from "@togi/shared";
import { usePolling } from "../lib/usePolling";

/**
 * Staff queue — built for triage at volume.
 *
 * - one-click "advance" applies the next normal step of the approved matrix
 *   (reason-required moves open a small confirmation instead)
 * - search + type chips + status tabs narrow 100 rows instantly
 * - j / k move, a advances, Enter opens, / focuses search
 * - polls while visible, so another agent's move appears without a reload
 */

const TAB_KEYS = ["active", "new", "progress", "closed"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABEL: Record<TabKey, string> = {
  active: "Active",
  new: "New",
  progress: "In progress",
  closed: "Closed",
};

const TAB_STATUSES: Record<TabKey, RequestStatus[]> = {
  active: [
    "Submitted",
    "Received",
    "UnderReview",
    "Accepted",
    "Processing",
    "Dispatched",
  ],
  new: ["Submitted"],
  progress: ["Received", "Accepted", "Processing", "Dispatched"],
  closed: ["Completed", "Resolved", "Rejected", "Cancelled", "Escalated"],
};



const ACTION_LABEL: Partial<Record<RequestStatus, string>> = {
  Received: "Acknowledge",
  UnderReview: "Review",
  Accepted: "Accept",
  Processing: "Start",
  Dispatched: "On the way",
  Completed: "Order completed",
  Resolved: "Resolve",
};

function statusText(
  request: RequestListItem,
): string {
  if (
    request.type === "refill" &&
    request.deliveryMethod === "home" &&
    request.status === "Dispatched"
  ) {
    return "On the way";
  }
  return statusLabel(request.status);
}

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function Queue() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<RequestListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reasonFor, setReasonFor] = useState<{
    request: RequestListItem;
    to: RequestStatus;
  } | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = TAB_STATUSES[tab]
        .map((status) => `status=${status}`)
        .join("&");
      const res = await api<{ requests: RequestListItem[] }>(`/requests?${qs}`);
      setItems(res.requests);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load the queue.",
      );
    }
  }, [tab]);

  usePolling(load, { intervalMs: 8_000 });

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (items ?? [])
      .filter((item) => {
        if (!needle) return true;
        return (
          item.reference.toLowerCase().includes(needle) ||
          (item.contactPhone ?? "").toLowerCase().includes(needle) ||
          (item.customer?.fullName ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const delta =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return tab === "closed" ? -delta : delta;
      });
  }, [items, query, tab]);

  useEffect(() => {
    if (selectedId && !visible.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  const advance = useCallback(
    async (request: RequestListItem, to: RequestStatus, reasonText?: string) => {
      setAdvancingId(request.id);
      try {
        await api(`/requests/${request.id}/transition`, {
          method: "POST",
          body: { to, reason: reasonText || undefined },
        });
        toast({
          message: `${request.reference} moved to ${to}.`,
          tone: "success",
        });
        setReasonFor(null);
        setReason("");
        // Optimistic update so the row moves immediately; the poll reconciles.
        setItems((prev) => {
          if (!prev) return prev;
          if (!TAB_STATUSES[tab].includes(to)) {
            return prev.filter((item) => item.id !== request.id);
          }
          return prev.map((item) =>
            item.id === request.id
              ? { ...item, status: to, updatedAt: new Date().toISOString() }
              : item,
          );
        });
        await load();
      } catch (err) {
        toast({
          message:
            err instanceof ApiError
              ? err.message
              : "Could not update the status.",
          tone: "error",
        });
      } finally {
        setAdvancingId(null);
      }
    },
    [load, tab, toast],
  );

  const handleAdvance = useCallback(
    (request: RequestListItem) => {
      const step = nextStaffStep(request.type, request.status);
      if (!step) return;
      if (step.reasonRequired) {
        setReason("");
        setReasonFor({ request, to: step.to });
        return;
      }
      void advance(request, step.to);
    },
    [advance],
  );

  const canDecide = (status: RequestStatus) =>
    status === "Submitted" || status === "Received" || status === "UnderReview";

  const acceptRequest = useCallback(
    async (request: RequestListItem) => {
      if (!canDecide(request.status)) return;
      setAdvancingId(request.id);
      try {
        if (request.status === "Submitted") {
          await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "Received" } });
          await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "UnderReview" } });
        } else if (request.status === "Received") {
          await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "UnderReview" } });
        }
        await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "Accepted" } });
        toast({ message: `${request.reference} accepted.`, tone: "success" });
        await load();
      } catch (err) {
        toast({
          message: err instanceof ApiError ? err.message : "Could not accept this order.",
          tone: "error",
        });
        await load();
      } finally {
        setAdvancingId(null);
      }
    },
    [load, toast],
  );

  const declineRequest = useCallback(
    async (request: RequestListItem) => {
      if (!canDecide(request.status)) return;
      setAdvancingId(request.id);
      try {
        if (request.status === "Submitted") {
          await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "Received" } });
          await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "UnderReview" } });
        } else if (request.status === "Received") {
          await api(`/requests/${request.id}/transition`, { method: "POST", body: { to: "UnderReview" } });
        }
        setReason("");
        setReasonFor({ request: { ...request, status: "UnderReview" }, to: "Rejected" });
        await load();
      } catch (err) {
        toast({
          message: err instanceof ApiError ? err.message : "Could not prepare this order for decline.",
          tone: "error",
        });
        await load();
      } finally {
        setAdvancingId(null);
      }
    },
    [load, toast],
  );

  // Keyboard triage: j/k move, a advances, Enter opens, / searches.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        Boolean(target) &&
        (target!.tagName === "INPUT" ||
          target!.tagName === "TEXTAREA" ||
          target!.tagName === "SELECT" ||
          target!.isContentEditable);

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || reasonFor || visible.length === 0) return;

      const index = visible.findIndex((item) => item.id === selectedId);
      if (event.key === "j") {
        event.preventDefault();
        setSelectedId(
          visible[Math.min(index + 1, visible.length - 1)]?.id ?? visible[0].id,
        );
      } else if (event.key === "k") {
        event.preventDefault();
        setSelectedId(
          visible[Math.max(index - 1, 0)]?.id ?? visible[0].id,
        );
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        navigate(`/requests/${selectedId}`);
      } else if (event.key.toLowerCase() === "a" && selectedId) {
        event.preventDefault();
        const request = visible.find((item) => item.id === selectedId);
        if (request) handleAdvance(request);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, reasonFor, navigate, handleAdvance]);

  function changeTab(next: TabKey) {
    setTab(next);
    setItems(null);
    setSelectedId(null);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Review incoming refill orders, update progress, and manage visits in one place.
            Updates sync automatically.
          </p>
        </div>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--success, #4ade80)" }}
              aria-hidden="true"
            />
            Live
            {updatedAt
              ? ` · ${updatedAt.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div
        className="mt-6 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Order views"
      >
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => changeTab(key)}
            className="rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              borderColor:
                tab === key ? "var(--primary)" : "var(--border)",
              color:
                tab === key ? "var(--primary-hover)" : "var(--text-muted)",
              background:
                tab === key ? "var(--primary-surface)" : "var(--surface)",
            }}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reference, name or phone  ( / )"
          aria-label="Search requests"
          className="t-input w-full sm:w-72"
        />
      </div>

      <p className="mt-2 hidden text-[11px] sm:block" style={{ color: "var(--text-muted)" }}>
        Tip: <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>Enter</kbd> open, <kbd>/</kbd> search
      </p>

      {error && items !== null ? (
        <p
          className="mt-4 text-xs"
          style={{ color: "var(--accent-text)" }}
          role="status"
        >
          Showing the last good snapshot. {error}
        </p>
      ) : null}

      {error && items === null ? (
        <ErrorState
          title="Couldn't load the queue"
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
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            items.length === 0
              ? "No requests in this view"
              : "No requests match this filter"
          }
          description={
            items.length === 0
              ? "New requests appear here as customers submit them."
              : "Try another status or search term."
          }
          action={
            items.length === 0 ? (
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Refresh
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                }}
              >
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <div className="mt-4">
          <Card padded={false} title={`${TAB_LABEL[tab]} · ${visible.length}`}>
            <ul className="divide-y divide-[var(--border)]">
              {visible.map((request) => {
                const step = nextStaffStep(request.type, request.status);
                const selected = selectedId === request.id;

                return (
                  <li
                    key={request.id}
                    data-selected={selected || undefined}
                    onClick={() => setSelectedId(request.id)}
                    className="flex flex-wrap items-center gap-x-2 gap-y-2 border-l-2 px-2 py-2 transition-colors sm:flex-nowrap sm:gap-3 sm:px-3 sm:py-1.5"
                    style={{
                      borderLeftColor: selected ? "var(--primary)" : "transparent",
                      background: selected ? "var(--surface-raised)" : undefined,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Link
                          to={`/requests/${request.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-mono text-sm font-semibold hover:underline"
                        >
                          {request.reference}
                        </Link>
                        <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                          {request.customer?.fullName ?? "Guest"}
                          <span className="hidden sm:inline">
                            {request.contactPhone ? ` · ${request.contactPhone}` : ""}
                          </span>
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {request.type === "refill"
                            ? request.deliveryMethod === "home"
                              ? "On-site"
                              : "Station"
                            : request.type}
                        </span>
                      </div>
                    </div>

                    <span
                      className="hidden w-10 shrink-0 text-right text-[11px] tabular-nums sm:inline"
                      style={{ color: "var(--text-muted)" }}
                      title={formatDate(request.createdAt)}
                    >
                      {age(request.createdAt)}
                    </span>

                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                      <StatusPill status={request.status} label={statusText(request)} />
                      {tab === "active" ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            variant="primary"
                            size="sm"
                            className="shrink-0"
                            loading={advancingId === request.id && canDecide(request.status)}
                            disabled={!canDecide(request.status) || advancingId === request.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void acceptRequest(request);
                            }}
                          >
                            Accept
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            className="shrink-0"
                            loading={advancingId === request.id && canDecide(request.status)}
                            disabled={!canDecide(request.status) || advancingId === request.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void declineRequest(request);
                            }}
                          >
                            Decline
                          </Button>
                          <Link
                            to={`/requests/${request.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="t-btn t-btn--secondary t-btn--sm shrink-0"
                          >
                            View
                          </Link>
                        </div>
                      ) : step ? (
                        <Button
                          variant={step.reasonRequired ? "secondary" : "primary"}
                          size="sm"
                          className="shrink-0"
                          loading={advancingId === request.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleAdvance(request);
                          }}
                        >
                          {ACTION_LABEL[step.to] ?? `→ ${step.to}`}
                        </Button>
                      ) : (
                        <Link
                          to={`/requests/${request.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="t-btn t-btn--secondary t-btn--sm shrink-0"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(reasonFor)}
        onClose={() => {
          setReasonFor(null);
          setReason("");
        }}
        title={
          reasonFor
            ? `Move ${reasonFor.request.reference} to ${reasonFor.to}`
            : "Reason required"
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setReasonFor(null);
                setReason("");
              }}
              disabled={Boolean(advancingId)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={Boolean(advancingId)}
              disabled={reason.trim().length < 3}
              onClick={() => {
                if (reasonFor) {
                  void advance(reasonFor.request, reasonFor.to, reason);
                }
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          A short reason is recorded in the request history and shown to the
          customer.
        </p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="t-input mt-3"
          rows={3}
          placeholder="What was the outcome?"
          aria-label="Reason"
        />
      </Modal>
    </div>
  );
}
