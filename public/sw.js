// Aangan service worker: makes the app installable and lets it open without a connection.
// - Pages: network first, but if the network hasn't answered within NAV_TIMEOUT the cached app shell opens at once
//   (and refreshes in the background), so a weak connection never leaves a blank screen.
// - Hashed build assets (/assets/*) and fonts: cache first; they never change once built.
// - Supabase, /api/* and every other cross-origin request go straight to the network,
//   so account data is never served from this cache.
const VERSION = "angan-v4";
const NAV_TIMEOUT = 1800;
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png"];
const MAX_ASSETS = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cached = (await caches.match("/index.html")) || (await caches.match("/"));
      const network = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("/index.html", copy)); }
        return res;
      });
      if (!cached) return network.catch(() => Response.error());
      // Offline (or failing) resolves to the shell; a slow network loses the race to it after NAV_TIMEOUT.
      const settled = network.catch(() => cached);
      const slow = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT));
      return Promise.race([settled, slow]);
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        // The host's SPA fallback answers a missing file with index.html (200). Never cache that under a
        // script/icon URL, or one stale request would poison the cache-first lookup for good.
        if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(req, copy).then(() => trim(c)));
        }
        return res;
      })),
    );
  }
});
