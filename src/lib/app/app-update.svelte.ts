/**
 * PWA update controller — reactive "a new version is ready" state + the controls
 * to apply it or to plain-refresh.
 *
 * The service worker (src/service-worker.ts) deliberately does NOT skipWaiting on
 * install: a freshly-deployed version WAITS instead of silently taking over and
 * reloading. This module watches for that waiting worker (now, on `updatefound`,
 * and on every return-to-foreground) so the app can show a "New version · Update"
 * affordance. Tapping Update posts SKIP_WAITING → the SW activates + clients.claim
 * → `controllerchange` (wired in +layout.svelte) does the single reload.
 *
 * Reactive state follows the theme.svelte.ts pattern: module-level $state read
 * through accessor functions (so it tracks correctly across module boundaries).
 */
let available = $state(false);
let applying = $state(false);

let registration: ServiceWorkerRegistration | null = null;
let waiting: ServiceWorker | null = null;

/** True once a new version has finished downloading and is ready to apply. */
export function updateAvailable(): boolean {
  return available;
}
/** True while an update is being applied (button shows a spinner, ignores taps). */
export function updateApplying(): boolean {
  return applying;
}

function markReady(worker: ServiceWorker | null): void {
  if (worker === null) return;
  waiting = worker;
  available = true;
}

/** Wire update detection to a service-worker registration. Call once after register(). */
export function initAppUpdate(reg: ServiceWorkerRegistration): void {
  registration = reg;
  // A new version may already be sitting ready from a previous visit/background.
  if (reg.waiting && navigator.serviceWorker.controller) markReady(reg.waiting);
  // …or it may finish installing while the app is open.
  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing;
    if (incoming === null) return;
    incoming.addEventListener('statechange', () => {
      // Only a NEW version counts (there's already a controller); the very first
      // install has no controller and must not be flagged as "an update".
      if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
        markReady(incoming);
      }
    });
  });
  // Re-check when the app returns to the foreground (catches a deploy that landed
  // while it was backgrounded — the common installed-PWA case), plus once now.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => {});
    });
  }
  void reg.update().catch(() => {});
}

/**
 * Apply a downloaded update. If one is waiting, tell it to take over (the reload
 * is driven by the controllerchange listener in +layout.svelte). If somehow none
 * is pending, fall back to a plain reload so the button is never a no-op.
 */
export function applyUpdate(): void {
  if (applying) return;
  if (waiting !== null) {
    applying = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Safety net: if controllerchange doesn't fire (e.g. odd iOS state), reload
    // anyway shortly so the user is never stuck on "Updating…".
    if (typeof window !== 'undefined') {
      window.setTimeout(() => window.location.reload(), 2500);
    }
  } else {
    reloadApp();
  }
}

/** Plain reload — clears a transient glitch / honours a manual refresh. Also asks
 *  the SW to re-check for a newer version on the way out. */
export function reloadApp(): void {
  void registration?.update().catch(() => {});
  if (typeof location !== 'undefined') location.reload();
}
