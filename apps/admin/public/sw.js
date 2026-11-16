/* Admin dashboard service worker: push notifications + click handling. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function normalizeAdminUrl(raw, fallback = "/overview") {
  try {
    const u = new URL(raw || fallback, self.location.origin);
    if (u.origin !== self.location.origin) return new URL(fallback, self.location.origin).href;
    // Admin notifications must open admin request routes, never customer account routes.
    const m = u.pathname.match(/^\/account\/requests\/([^/]+)/);
    if (m && m[1]) {
      return new URL(`/requests/${m[1]}${u.search}${u.hash}`, self.location.origin).href;
    }
    return u.href;
  } catch {
    return new URL(fallback, self.location.origin).href;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Throne of Grace", body: event.data ? event.data.text() : "You have a new update." };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Throne of Grace";
  const body = typeof data.body === "string" ? data.body : "You have a new update.";
  const url = typeof data.url === "string" ? data.url : (data.data && typeof data.data.url === "string" ? data.data.url : "/queue");
  const tag = typeof data.tag === "string" && data.tag ? data.tag : (data.notificationId || data.data?.notificationId || undefined);

  const options = {
    body,
    tag,
    renotify: false,
    data: { url },
    icon: "/favicon.ico",
    badge: "/favicon.ico",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawTarget = event.notification?.data?.url || "/queue";
  const target = normalizeAdminUrl(rawTarget, "/queue");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            if ("focus" in client) {
              return client.focus().then((c) => {
                if (c && "navigate" in c) return c.navigate(target).catch(() => undefined);
              }).catch(() => self.clients.openWindow(target));
            }
          }
        } catch {
          // ignore
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
