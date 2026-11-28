// The service worker: keeps the app's own files on the phone so it opens and runs with no connection.
// Registered as a module (see js/ui/update.js), so it can import the version and the file list.
//
//  - install:  store every file in PRECACHE in a cache named after APP_VERSION. Nothing is swapped in yet:
//              the new worker waits until the person taps "Update ready" (the page then sends SKIP_WAITING).
//  - activate: delete the caches of older versions and take control of open pages.
//  - fetch:    app files come from the cache; everything else (the Tesseract text reader from its CDN, ...) goes to the network.

import { APP_VERSION } from './js/version.js';
import { PRECACHE } from './js/precache.js';

const CACHE_PREFIX = 'vocal-practice-';
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const INDEX_URL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await caches.delete(CACHE_NAME);   // a half-finished earlier attempt at this version
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' skips the browser's own HTTP cache, so a new version never stores stale copies of its files.
    await cache.addAll(PRECACHE.map((path) => new Request(new URL(path, self.registration.scope).href, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;   // other sites: network only
  event.respondWith(answer(request));
});

async function answer(request) {
  const cache = await caches.open(CACHE_NAME);
  // Opening the app (with or without ?debug=1 and the like) gets the stored page; other files are matched without their query.
  const cached = request.mode === 'navigate' ? await cache.match(INDEX_URL) : await cache.match(request, { ignoreSearch: true });
  return cached || fetch(request);
}
