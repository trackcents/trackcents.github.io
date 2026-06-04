/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline app-shell caching (T105 / SC-006). Same-origin assets are cache-first;
// cross-origin requests (Google sign-in + Drive API) are never cached — they go
// straight to the network so auth and sync always hit live servers.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `mtrb-cache-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
  // Precache the new shell, but DON'T skipWaiting — a freshly-deployed version
  // WAITS so the app can show a "New version · Update" prompt instead of silently
  // reloading mid-use. It activates when the user taps Update (the SKIP_WAITING
  // message below) or when the PWA is next fully relaunched.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

// The app posts this when the user taps "Update" — only then does the waiting
// version take over (then `activate` claims clients → the page reloads once).
sw.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void sw.skipWaiting();
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
  // Cross-origin (accounts.google.com / googleapis.com) → never cache; default network fetch.
  if (url.origin !== sw.location.origin) return;
  event.respondWith(serveSameOrigin(request));
});

async function serveSameOrigin(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached; // cache-first for app shell + immutable assets
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    return new Response('Offline and not cached', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}
