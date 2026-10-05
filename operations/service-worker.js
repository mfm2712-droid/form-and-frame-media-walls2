self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body:event.data?.text() || "Open the staff desk to review the latest update." }; }
  event.waitUntil(self.registration.showNotification(data.title || "Form & Frame", {
    body:data.body || "There is a new update in the staff desk.",
    tag:data.tag || "form-and-frame-update",
    icon:"./icon.svg",
    badge:"./icon.svg",
    data:{ url:data.url || "./" },
    renotify:false
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "./", self.registration.scope).href;
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
