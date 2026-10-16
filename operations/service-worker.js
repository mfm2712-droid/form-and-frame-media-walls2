self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body:event.data?.text() || "Open the staff desk to review the latest update." }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || "Form & Frame", {
      body:data.body || "There is a new update in the staff desk.",
      tag:data.tag || "form-and-frame-update",
      icon:"./icon-192.png",
      badge:"./notification-badge.png",
      data:{ url:data.url || "./" },
      renotify:false
    });
    // Keep the app icon badge in step with the alerts still on screen, and
    // tell any open window to refresh its notification centre.
    try {
      const shown = await self.registration.getNotifications();
      if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(shown.length);
    } catch { /* badges are optional */ }
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
    try {
      const shown = await self.registration.getNotifications();
      if (self.navigator?.setAppBadge) await (shown.length ? self.navigator.setAppBadge(shown.length) : self.navigator.clearAppBadge?.());
    } catch { /* badges are optional */ }
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
