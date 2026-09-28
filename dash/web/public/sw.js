/* eslint-env serviceworker */
/**
 * What makes JobHunt installable, and what makes it open instantly on a phone.
 *
 * Deliberately small, and deliberately never caching an answer from the API: a stale role or
 * a stale document would be worse than no answer at all. Only the shell is cached.
 *
 * - hashed build assets (/assets/*): cache first, they never change under one name
 * - icons and the manifest: cache first, refreshed in the background
 * - a page load: network first, falling back to the cached shell when offline
 * - /api and /doc: network only, never stored
 */
const VERSION = 'jobhunt-v1';
const SHELL = `${VERSION}-shell`;
const PRECACHE = ['/', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(PRECACHE).catch(() => { /* a missing file must not block install */ });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith(VERSION)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isAsset = (url) => url.pathname.startsWith('/assets/')
  || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never hand back a remembered answer about the person's own data, and never cache the file
  // the update banner polls.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/doc/')
    || url.pathname === '/version.json') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('/', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match('/')) ?? Response.error();
      }
    })());
    return;
  }

  if (isAsset(url)) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(SHELL)).put(request, fresh.clone()).catch(() => {});
      return fresh;
    })());
  }
});
