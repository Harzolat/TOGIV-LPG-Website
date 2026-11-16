import { api, ApiError } from "./api";

export type PushPermissionState = NotificationPermission | "unsupported";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPushPermission(): PushPermissionState {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  // Ensure a standalone ArrayBuffer (avoids offset/typing issues in some browsers)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const normalized = base64String.trim().replace(/\s+/g, "");
  if (!normalized) throw new Error("Missing VAPID public key from server.");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const base64 = (normalized + padding).replace(/-/g, "+").replace(/_/g, "/");
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error("Invalid VAPID public key format (base64url decode failed).");
  }
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  // Uncompressed P-256 public key must be 65 bytes (0x04 + 32 + 32).
  if (out.length !== 65) {
    throw new Error(`Invalid VAPID public key length (${out.length} bytes, expected 65). Check VAPID_PUBLIC_KEY on the API.`);
  }
  if (out[0] !== 0x04) {
    throw new Error("Invalid VAPID public key format (expected uncompressed P-256 key). Check VAPID_PUBLIC_KEY on the API.");
  }
  return out;
}

async function getReadyRegistration(): Promise<ServiceWorkerRegistration> {
  const scope = "/";
  let reg = await navigator.serviceWorker.getRegistration(scope);
  if (!reg) {
    console.info("[push:web] No existing SW registration; registering /sw.js");
    reg = await navigator.serviceWorker.register("/sw.js", { scope });
  }
  console.info("[push:web] SW registration", {
    scope: reg.scope,
    scriptURL: reg.active?.scriptURL ?? reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? null,
    active: reg.active?.state ?? null,
    installing: reg.installing?.state ?? null,
    waiting: reg.waiting?.state ?? null,
  });

  // Wait for activation of this registration if needed
  if (!reg.active) {
    const sw = reg.installing || reg.waiting;
    if (sw) {
      console.info("[push:web] Waiting for service worker activation", { state: sw.state });
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Service worker activation timed out.")), 15000);
        const onState = () => {
          if (sw.state === "activated") {
            window.clearTimeout(timeout);
            sw.removeEventListener("statechange", onState);
            resolve();
          } else if (sw.state === "redundant") {
            window.clearTimeout(timeout);
            sw.removeEventListener("statechange", onState);
            reject(new Error("Service worker became redundant before activation."));
          }
        };
        sw.addEventListener("statechange", onState);
        onState();
      });
    }
  }

  // Prefer navigator.serviceWorker.ready for the active page registration
  let ready: ServiceWorkerRegistration | null = null;
  try {
    ready = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15000)),
    ]);
  } catch (e) {
    console.warn("[push:web] serviceWorker.ready failed", safeErrorInfo(e));
  }

  const resolved = ready ?? reg;
  if (!resolved?.active) {
    throw new Error("Service worker is not active. Reload the page and try again.");
  }
  if (!resolved.pushManager) {
    throw new Error("PushManager is unavailable on the service worker registration.");
  }

  console.info("[push:web] SW ready", {
    scope: resolved.scope,
    activeState: resolved.active.state,
    controller: Boolean(navigator.serviceWorker.controller),
    readyMatched: ready === resolved,
  });
  return resolved;
}

function safeErrorInfo(e: unknown): Record<string, unknown> {
  if (e instanceof ApiError) return { type: "ApiError", status: e.status, message: e.message };
  if (e instanceof DOMException) return { type: "DOMException", name: e.name, message: e.message };
  if (e instanceof Error) return { type: e.name || "Error", message: e.message };
  return { type: typeof e };
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function messageFromError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof DOMException) {
    const detail = [e.name, e.message].filter(Boolean).join(": ");
    return detail || fallback;
  }
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

export async function enablePush(): Promise<{
  ok: boolean;
  permission: PushPermissionState;
  subscribed: boolean;
  message?: string;
}> {
  if (!isPushSupported()) {
    return {
      ok: false,
      permission: "unsupported",
      subscribed: false,
      message: "Browser notifications are not supported on this device/browser.",
    };
  }

  let permission: NotificationPermission = Notification.permission;
  let createdSub: PushSubscription | null = null;

  try {
    console.info("[push:web] enable start", { permission, supported: isPushSupported() });
    // Explicit user action only (caller must invoke from gesture).
    if (permission !== "granted") {
      permission = await Notification.requestPermission();
      console.info("[push:web] permission result", { permission });
    }
    if (permission !== "granted") {
      return {
        ok: false,
        permission,
        subscribed: Boolean(await getCurrentSubscription()),
        message:
          permission === "denied"
            ? "Notifications are blocked in your browser settings."
            : "Notification permission was not granted.",
      };
    }

    const cfg = await api<{ publicKey: string | null; configured: boolean }>(
      "/notifications/push/vapid-public-key",
    );
    console.info("[push:web] vapid config", {
      configured: Boolean(cfg.configured),
      hasPublicKey: Boolean(cfg.publicKey),
      publicKeyLength: cfg.publicKey?.length ?? 0,
    });
    if (!cfg.configured || !cfg.publicKey) {
      return {
        ok: false,
        permission,
        subscribed: Boolean(await getCurrentSubscription()),
        message: "Push notifications are not configured on the server yet.",
      };
    }

    const reg = await getReadyRegistration();
    let sub = await reg.pushManager.getSubscription();
    console.info("[push:web] existing subscription", { hasSubscription: Boolean(sub) });
    if (!sub) {
      const keyBytes = urlBase64ToUint8Array(cfg.publicKey);
      const appKey = toArrayBuffer(keyBytes);
      console.info("[push:web] subscribing", {
        scope: reg.scope,
        keyBytes: keyBytes.length,
        hasPushManager: Boolean(reg.pushManager),
        active: reg.active?.state ?? null,
      });
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appKey,
        });
      } catch (e) {
        console.error("[push:web] pushManager.subscribe failed", safeErrorInfo(e));
        throw e;
      }
      createdSub = sub;
      console.info("[push:web] subscribe result", {
        hasEndpoint: Boolean(sub.endpoint),
        endpointHost: (() => {
          try { return new URL(sub.endpoint).host; } catch { return "invalid"; }
        })(),
      });
    }

    // Verify browser actually persisted the subscription
    const verified = await reg.pushManager.getSubscription().catch(() => null);
    if (!verified) {
      throw new Error("Browser did not persist the push subscription after subscribe(). Check browser push service/VAPID configuration.");
    }

    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!p256dh || !auth) {
      throw new Error("Browser returned an incomplete push subscription.");
    }

    try {
      await api("/notifications/push/subscriptions", {
        method: "POST",
        body: {
          endpoint: sub.endpoint,
          keys: { p256dh, auth },
          expirationTime: sub.expirationTime ?? null,
          deviceLabel: navigator.userAgent.slice(0, 100),
        },
      });
      console.info("[push:web] backend subscription registered");
    } catch (e) {
      console.error("[push:web] backend registration failed", safeErrorInfo(e));
      // Keep browser/backend subscription state consistent.
      if (createdSub) await createdSub.unsubscribe().catch(() => undefined);
      throw e;
    }

    // Best-effort preference enable (subscription is the source of activation).
    await api("/notifications/preferences", {
      method: "PATCH",
      body: { category: "request_updates", pushEnabled: true },
    }).catch((e) => console.warn("[push:web] preference enable failed", safeErrorInfo(e)));

    const subscribed = Boolean(await getCurrentSubscription());
    console.info("[push:web] enable complete", { subscribed });
    return {
      ok: true,
      permission,
      subscribed,
      message: subscribed ? "Browser notifications enabled." : "Subscription created but could not be verified.",
    };
  } catch (e) {
    console.error("[push:web] enable failed", safeErrorInfo(e));
    const subscribed = Boolean(await getCurrentSubscription().catch(() => null));
    return {
      ok: false,
      permission: isPushSupported() ? Notification.permission : "unsupported",
      subscribed,
      message: messageFromError(e, "Could not enable browser notifications."),
    };
  }
}

export async function disablePush(): Promise<{ ok: boolean; subscribed: boolean; message?: string }> {
  if (!isPushSupported()) return { ok: true, subscribed: false, message: "Browser notifications disabled." };
  try {
    const sub = await getCurrentSubscription();
    if (sub) {
      try {
        await api("/notifications/push/subscriptions/unsubscribe", {
          method: "POST",
          body: { endpoint: sub.endpoint },
        });
      } catch {
        // best effort server-side cleanup; still remove local subscription
      }
      await sub.unsubscribe();
    }
    await api("/notifications/preferences", {
      method: "PATCH",
      body: { category: "request_updates", pushEnabled: false },
    }).catch(() => undefined);
    return {
      ok: true,
      subscribed: Boolean(await getCurrentSubscription().catch(() => null)),
      message: "Browser notifications disabled.",
    };
  } catch (e) {
    return {
      ok: false,
      subscribed: Boolean(await getCurrentSubscription().catch(() => null)),
      message: messageFromError(e, "Could not disable browser notifications."),
    };
  }
}

export async function syncPushState(): Promise<{
  supported: boolean;
  permission: PushPermissionState;
  subscribed: boolean;
}> {
  const supported = isPushSupported();
  if (!supported) return { supported: false, permission: "unsupported", subscribed: false };
  const sub = await getCurrentSubscription();
  return { supported: true, permission: Notification.permission, subscribed: Boolean(sub) };
}
