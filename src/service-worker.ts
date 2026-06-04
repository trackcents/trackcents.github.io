/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline app-shell caching (T105 / SC-006).
//
// CACHING STRATEGY (important — see the "stuck after update" incident 2026-06-04):
//   • Navigations (the HTML document) are NETWORK-FIRST: when online we always
//     fetch the freshest app shell, so a deploy can never leave the browser on a
//     stale/mixed bundle (new HTML pointing at chunks an old cache no longer has,
//     or vice-versa — which made the page render but hang on load). Offline falls
//     back to the cached shell.
//   • Hashed build assets are CACHE-FIRST (immutable — a given URL never changes),
//     with a network fallback on a cache miss.
//   • Cross-origin (Google sign-in + Drive API) is never cached — straight to the
//     network so auth + sync always hit live servers.
//   • The SW AUTO-ACTIVATES (skipWaiting + clients.claim) so a fixed/new version
//     takes over on the next load — no manual step needed to recover or update.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `mtrb-cache-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      // Keep a copy of the app shell under '/' for the offline navigation fallback.
      try {
        await cache.add('/');
      } catch {
        /* '/' may 404 in some hosting setups — non-fatal, sub-paths still work */
      }
      // Take over straight away so a new (or fixed) version is live on next load.
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Cross-origin (accounts.google.com / googleapis.com) → never cache.
  if (url.origin !== sw.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigateNetworkFirst(request));
    return;
  }
  event.respondWith(assetCacheFirst(request));
});

/** App HTML: network-first (freshest shell when online), cached shell offline. */
async function navigateNetworkFirst(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(request)) ?? (await cache.match('/'));
    if (cached) return cached;
    return new Response('Offline and not cached', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

/** Hashed/static assets: cache-first (immutable), network fallback on a miss. */
async function assetCacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline and not cached', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}
