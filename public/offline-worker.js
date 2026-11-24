import { forget } from "./offline/device.js";
// Only the four static, mail-free reader files enter Cache Storage.
const shell = "edge-mail-reader-v1",
  files = ["/offline/reader", "/offline/reader.js", "/offline/reader.css", "/offline/device.js"];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(shell);
      for (const path of files) {
        const r = await fetch(path, { redirect: "error", cache: "no-store" });
        if (!r.ok || r.url !== new URL(path, self.location.origin).href)
          throw Error("Offline shell unavailable");
        await cache.put(path, r);
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("edge-mail-reader-") && name !== shell) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/cdn-cgi/access/logout") {
    event.respondWith(forget().then(() => fetch(req)));
    return;
  }
  const navigation =
    req.mode === "navigate" &&
    (["/", "/app", "/settings", "/approvals", "/inboxes", "/offline/reader"].includes(
      url.pathname,
    ) ||
      url.pathname.startsWith("/settings/") ||
      url.pathname.startsWith("/inboxes/") ||
      url.pathname.startsWith("/mailboxes/") ||
      /^\/domains\/[^/]+\/inbox(?:\/[^/]+\/messages\/[^/]+)?$/.test(url.pathname));
  if (!navigation && !files.includes(url.pathname)) return;
  event.respondWith(
    fetch(req)
      .then(async (response) => {
        if (
          navigation &&
          (response.type === "opaqueredirect" ||
            response.redirected ||
            [401, 403].includes(response.status))
        )
          await forget();
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(shell);
        return (await cache.match(navigation ? files[0] : url.pathname)) || Response.error();
      }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const { topic, message, box } = event.data.json();
  const link =
    ["mail", "followup"].includes(topic) && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(box)
      ? "/mailboxes/" + box + (topic === "followup" ? "/follow-ups" : "/inbox")
      : "/settings";
  event.waitUntil(
    self.registration.showNotification("Edge Mail", {
      body: message,
      icon: "/install/icon-192.png",
      tag: topic + "-" + box,
      data: { link },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.link;
  const link =
    typeof path === "string" &&
    (/^\/mailboxes\/[0-9A-HJKMNP-TV-Z]{26}\/(?:inbox|follow-ups)$/.test(path) ||
      path === "/settings")
      ? path
      : "/app";
  event.waitUntil(self.clients.openWindow(link));
});
