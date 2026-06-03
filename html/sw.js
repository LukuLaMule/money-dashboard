// service worker minimal — cache des assets statiques (données toujours fraîches via réseau)
const CACHE = "money-v2";
const ASSETS = ["/", "/index.html", "/style.css", "/app.js", "/manifest.json",
  "/assets/icon-192.png", "/assets/icon-512.png", "/assets/icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // données dynamiques : toujours le réseau (pas de cache périmé)
  if (url.pathname.endsWith("data.json") || url.pathname.endsWith("news.json") || url.pathname.endsWith("price_history.json")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // icônes : cache d'abord (elles ne changent pas)
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
    return;
  }
  // tout le reste (HTML/CSS/JS) : réseau d'abord, cache en repli hors-ligne
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))));
});
