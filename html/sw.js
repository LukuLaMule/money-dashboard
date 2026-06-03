// service worker minimal — cache des assets statiques (données toujours fraîches via réseau)
const CACHE = "money-v1";
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
  // statique : cache d'abord, réseau en repli
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
