// Service Worker: macht das Spiel installierbar und den Einzelspieler offline spielbar.
// Die Liste der vorab zu speichernden Dateien (precache.json) entsteht beim Build.
// Serverpfade (Anmeldung, WebSocket, Status) werden nie zwischengespeichert.

const PREFIX = 'pz-';
let CACHE = PREFIX + 'dev';

async function precacheList() {
  const r = await fetch('./precache.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('precache.json fehlt');
  return r.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const { version, files } = await precacheList();
    CACHE = PREFIX + version;
    const cache = await caches.open(CACHE);
    // In kleinen Paketen laden, damit ein einzelner Fehler nicht alles abbricht
    for (let i = 0; i < files.length; i += 12) {
      await Promise.all(files.slice(i, i + 12).map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { CACHE = PREFIX + (await precacheList()).version; } catch { /* offline: vorhandenen Cache behalten */ }
    const keys = await caches.keys();
    const current = keys.filter((k) => k.startsWith(PREFIX)).sort().pop();
    if (!keys.includes(CACHE) && current) CACHE = current;
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const NEVER = /\/(api|ws|healthz)(\/|$)|\/pz\//;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/config.json') || url.pathname.endsWith('/precache.json');
  event.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ?? (await cache.match('./index.html')) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}
