/*
 * Service worker for the guest PWA.
 *
 * Policy (see cachePolicy): the app shell, hashed assets and PUBLIC hotel
 * information (/api/public/*) may be cached for offline reading. Private data —
 * guest/staff/admin APIs, bills, stay data, activation — is NEVER cached. The
 * worker never queues or replays requests: an order is only sent by an
 * explicit tap while online.
 */
const VERSION = 'v1';
const SHELL_CACHE = `pa-shell-${VERSION}`;
const PUBLIC_CACHE = `pa-public-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

function cachePolicy(pathname, mode) {
  if (pathname.startsWith('/api/public/')) return 'network-first';
  if (pathname.startsWith('/api/')) return 'network-only';
  if (mode === 'navigate') return 'shell';
  if (pathname.startsWith('/assets/')) return 'cache-first';
  if (pathname.startsWith('/icons/') || pathname === '/manifest.webmanifest') return 'stale-while-revalidate';
  return 'network-only';
}

if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, PUBLIC_CACHE].includes(k)).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    const policy = cachePolicy(url.pathname, req.mode);
    if (policy === 'network-only') return;

    if (policy === 'shell') {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put('/', res.clone()));
            return res;
          })
          .catch(() => caches.match('/')),
      );
      return;
    }
    if (policy === 'network-first') {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) caches.open(PUBLIC_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => caches.match(req).then((hit) => hit || Response.error())),
      );
      return;
    }
    if (policy === 'cache-first') {
      event.respondWith(
        caches.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
              return res;
            }),
        ),
      );
      return;
    }
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  });

  self.addEventListener('push', (event) => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch (e) {
      data = {};
    }
    event.waitUntil(
      self.registration.showNotification(data.title || "Le Palace d'Anfa", {
        body: data.body || '',
        tag: data.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: data.url || '/h/requests' },
      }),
    );
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/h/requests';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
        for (const w of wins) {
          if ('focus' in w) {
            w.navigate(url);
            return w.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
    );
  });
}
