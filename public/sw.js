/* wacrm service worker — push only.
 *
 * Do NOT cache HTML or /_next/static here. Stale HTML that names old
 * chunk hashes is how a previous CDN cache bug blanked the UI after
 * deploy. This worker exists so installed Android/iOS PWAs can show
 * a system notification when a WhatsApp message arrives.
 */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = typeof data.title === "string" && data.title ? data.title : "wacrm";
  const body =
    typeof data.body === "string" && data.body ? data.body : "New WhatsApp message";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/inbox";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : "wacrm";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/pwa-icon/192",
      badge: "/pwa-icon/192",
      tag,
      renotify: true,
      silent: false,
      vibrate: [80, 40, 120],
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/inbox";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            if ("navigate" in client) {
              return client.navigate(target).then((c) => (c ? c.focus() : client.focus()));
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return undefined;
      }),
  );
});
