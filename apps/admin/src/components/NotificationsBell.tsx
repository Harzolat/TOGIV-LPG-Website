import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@togi/ui";
import { useAuth } from "../lib/auth";
import { usePolling } from "../lib/usePolling";
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "../lib/notifications";
import { disablePush, enablePush, getPushPermission, isPushSupported, syncPushState } from "../lib/push";

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationsBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushState, setPushState] = useState<{ supported: boolean; permission: NotificationPermission | "unsupported"; subscribed: boolean }>(
    { supported: isPushSupported(), permission: getPushPermission(), subscribed: false },
  );
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const prevUnreadRef = useRef<number | null>(null);
  const initializedUnreadRef = useRef(false);
  const lastPopupKeyRef = useRef<string | null>(null);

  const refreshCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getUnreadCount();
      const nextUnread = res.unreadCount ?? 0;
      setUnread(nextUnread);

      const prev = prevUnreadRef.current;
      prevUnreadRef.current = nextUnread;

      // Detect newly arrived updates after initial sync and show an in-app popup.
      if (!initializedUnreadRef.current) {
        initializedUnreadRef.current = true;
        return;
      }
      if (prev !== null && nextUnread > prev) {
        try {
          const latestRes = await getNotifications({ page: 1, limit: 1, unreadOnly: true });
          const latest = latestRes.items?.[0] ?? null;
          const popupKey = latest?.id ?? `count:${nextUnread}`;
          if (lastPopupKeyRef.current !== popupKey) {
            lastPopupKeyRef.current = popupKey;
            toast({
              message: latest ? `${latest.title}: ${latest.body}` : "You have a new notification.",
              tone: "info",
              durationMs: 5000,
            });
          }
        } catch {
          const popupKey = `count:${nextUnread}`;
          if (lastPopupKeyRef.current !== popupKey) {
            lastPopupKeyRef.current = popupKey;
            toast({ message: "You have a new notification.", tone: "info", durationMs: 4000 });
          }
        }
      }
    } catch {
      // ignore polling errors
    }
  }, [toast, user]);

  const refreshList = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await getNotifications({ page: 1, limit: 15 });
      setItems(res.items ?? []);
      setUnread(res.unreadCount ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refreshPush = useCallback(async () => {
    try {
      setPushState(await syncPushState());
    } catch {
      // ignore
    }
  }, []);

  usePolling(refreshCount, { intervalMs: 15_000, enabled: Boolean(user) });

  useEffect(() => {
    if (user) void refreshPush();
  }, [user, refreshPush]);

  useEffect(() => {
    if (open) {
      void refreshList();
      void refreshPush();
    }
  }, [open, refreshList, refreshPush]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const badge = useMemo(() => (unread > 99 ? "99+" : unread > 0 ? String(unread) : null), [unread]);

  if (!user) return null;

  function resolveAdminNotificationUrl(n: AppNotification): string | null {
    const raw = n.actionUrl ?? (typeof n.data?.url === "string" ? n.data.url : null);
    const requestId =
      n.relatedEntityId ??
      (typeof n.data?.requestId === "string" ? n.data.requestId : null);

    if (raw) {
      // Admin app must never navigate to customer account routes.
      const customerMatch = raw.match(/^\/account\/requests\/([^/?#]+)/);
      if (customerMatch?.[1]) return `/requests/${customerMatch[1]}`;
      if (raw.startsWith("/")) return raw;
      try {
        const u = new URL(raw, window.location.origin);
        if (u.origin === window.location.origin) {
          const m = u.pathname.match(/^\/account\/requests\/([^/]+)/);
          if (m?.[1]) return `/requests/${m[1]}`;
          return `${u.pathname}${u.search}${u.hash}`;
        }
      } catch {
        // fall through
      }
    }

    if (requestId) return `/requests/${requestId}`;
    return null;
  }

  async function onItemClick(n: AppNotification) {
    try {
      if (!n.isRead) {
        await markNotificationRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true, readAt: new Date().toISOString() } : x)));
        setUnread((u) => Math.max(0, u - 1));
      }
    } catch {
      // ignore
    }
    setOpen(false);
    const target = resolveAdminNotificationUrl(n);
    if (target) navigate(target);
  }

  async function onMarkAll() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
      setUnread(0);
    } catch {
      // ignore
    }
  }

  async function onEnablePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      const res = await enablePush();
      setPushMsg(
        res.message ??
          (res.ok ? "Browser notifications enabled." : "Could not enable browser notifications."),
      );
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Could not enable browser notifications.");
    } finally {
      await refreshPush();
      setPushBusy(false);
    }
  }

  async function onDisablePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      const res = await disablePush();
      setPushMsg(
        res.message ??
          (res.ok ? "Browser notifications disabled." : "Could not disable browser notifications."),
      );
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : "Could not disable browser notifications.");
    } finally {
      await refreshPush();
      setPushBusy(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors hover:bg-[var(--surface)]"
        style={{ borderColor: "var(--border)", color: "var(--text)" }}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell size={18} aria-hidden="true" />
        {badge ? (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: "var(--accent, #dc2626)" }}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-50 overflow-hidden rounded-xl border shadow-lg sm:absolute sm:inset-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(92vw,24rem)]"
          style={{ borderColor: "var(--border)", background: "var(--surface-raised, #fff)" }}
          role="dialog"
          aria-label="Notifications"
        >
          <div
            className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Notifications</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Operational alerts and updates</p>
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium"
              style={{ color: "var(--primary)" }}
              onClick={() => void onMarkAll()}
              disabled={unread === 0}
            >
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>

          <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Browser push</p>
            {!pushState.supported ? (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                <BellOff size={14} className="mr-1 inline" /> Not supported on this browser/device.
              </p>
            ) : pushState.permission === "denied" ? (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                Notifications are blocked in browser settings. Allow them for this site to receive push alerts.
              </p>
            ) : pushState.subscribed ? (
              <div className="mt-2 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <p className="text-sm" style={{ color: "var(--text)" }}>Notifications enabled on this browser.</p>
                <button
                  type="button"
                  className="t-btn t-btn--secondary t-btn--sm w-full sm:w-auto"
                  onClick={() => void onDisablePush()}
                  disabled={pushBusy}
                >
                  {pushBusy ? <Loader2 size={14} className="animate-spin" /> : "Disable notifications"}
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {pushState.permission === "granted"
                    ? "Browser permission is granted, but notifications are not yet activated on this browser."
                    : "Get alerts for new refill requests and key updates."}
                </p>
                <button
                  type="button"
                  className="t-btn t-btn--primary t-btn--sm w-full sm:w-auto"
                  onClick={() => void onEnablePush()}
                  disabled={pushBusy}
                >
                  {pushBusy ? <Loader2 size={14} className="animate-spin" /> : "Enable notifications"}
                </button>
              </div>
            )}
            {pushMsg ? <p className="mt-2 text-xs break-words" style={{ color: "var(--text-muted)" }}>{pushMsg}</p> : null}
          </div>

          <div className="max-h-[min(60vh,24rem)] overflow-y-auto overscroll-contain sm:max-h-80">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-8 text-sm" style={{ color: "var(--text-muted)" }}>
                <Loader2 size={16} className="mr-2 animate-spin" /> Loading…
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No notifications yet.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface)]"
                      style={{ background: n.isRead ? "transparent" : "color-mix(in srgb, var(--primary) 6%, transparent)" }}
                      onClick={() => void onItemClick(n)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 break-words text-sm font-medium" style={{ color: "var(--text)" }}>{n.title}</p>
                        {!n.isRead ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--primary)" }} /> : null}
                      </div>
                      <p className="mt-0.5 break-words text-sm" style={{ color: "var(--text-muted)" }}>{n.body}</p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{timeAgo(n.createdAt)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
