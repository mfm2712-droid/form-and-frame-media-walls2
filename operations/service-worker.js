// Form & Frame Operations: Web Push only. There is deliberately no fetch handler,
// so this worker can never serve a stale page. It takes over immediately so a
// new release (for example a new notification icon) is live without waiting for
// every window to close.
const WORKER_VERSION = "2026-10-16.badge-3";
const NOTIFICATION_ICON = "./icon-192.png";                       // large icon, expanded view
const NOTIFICATION_BADGE = "./notification-badge-ff.png?v=20261016f"; // status bar: white FF on transparent

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type === "ff-worker-version") event.ports?.[0]?.postMessage({ version:WORKER_VERSION, badge:NOTIFICATION_BADGE, icon:NOTIFICATION_ICON });
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body:event.data?.text() || "Open the staff desk to review the latest update." }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || "Form & Frame", {
      body:data.body || "There is a new update in the staff desk.",
      tag:data.tag || "form-and-frame-update",
      icon:NOTIFICATION_ICON,
      badge:NOTIFICATION_BADGE,
      timestamp:Date.now(),
      data:{ url:data.url || "./" },
      renotify:false
    });
    // Tell any open window to refresh its notification centre (it also keeps the app badge count).
    try {
      const windows = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
      for (const client of windows) client.postMessage({ type:"ff-push-received" });
    } catch { /* no open windows */ }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let destination = new URL("./", self.registration.scope).href;
  try {
    const requested = new URL(event.notification.data?.url || "./", self.registration.scope);
    // Only ever open a page inside the staff app.
    if (requested.href.startsWith(self.registration.scope)) destination = requested.href;
  } catch { /* keep the staff app home */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope)) {
        if (client.url !== destination && "navigate" in client) await client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});
