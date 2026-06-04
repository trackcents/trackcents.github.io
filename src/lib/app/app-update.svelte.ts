/**
 * PWA update controller — reactive "a new version is ready" state + the controls
 * to apply it or to plain-refresh.
 *
 * The service worker AUTO-ACTIVATES a new version (skipWaiting + clients.claim)
 * and the layout reloads once on `controllerchange`, with NETWORK-FIRST
 * navigation — so updates apply seamlessly and a reload always pulls the fresh,
 * consistent app (no stale/mixed bundle). This module just:
 *   - flags `available` when a newer version finished installing (for a subtle
 *     "new version" affordance), and
 *   - exposes `reloadApp()` / `applyUpdate()` for the top-bar Refresh button.
 * Applying an update is now simply a reload — the SW already took over.
 *
 * Reactive state follows the theme.svelte.ts pattern: module-level $state read
 * through accessor functions.
 */
let available = $state(false);
let applying = $state(false);

let registration: ServiceWorkerRegistration | null = null;

/** True once a new version has finished downloading (informational). */
export function updateAvailable(): boolean {
  return available;
}
/** True while a reload is in flight (button shows a spinner, ignores taps). */
export function updateApplying(): boolean {
  return applying;
}

/** Wire update detection to a service-worker registration. Call once after register(). */
export function initAppUpdate(reg: ServiceWorkerRegistration): void {
  registration = reg;
  // A new version finished installing while the app is open. (It auto-activates,
  // so the layout's controllerchange reload usually fires right after — this flag
  // just lets the UI show a brief "new version" hint.)
  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing;
    if (incoming === null) return;
    incoming.addEventListener('statechange', () => {
      if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
        available = true;
      }
    });
  });
  // Re-check on return to the foreground (catches a deploy that landed while the
  // app was backgrounded — the common installed-PWA case), plus once now.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update().catch(() => {});
    });
  }
  void reg.update().catch(() => {});
}

/** Apply the latest version = reload. The SW serves the fresh shell network-first,
 *  so a reload always lands on the newest, consistent build. */
export function applyUpdate(): void {
  reloadApp();
}

/** Plain reload — clears a transient glitch / honours a manual refresh. Also asks
 *  the SW to re-check for a newer version on the way out. */
export function reloadApp(): void {
  if (applying) return;
  applying = true;
  void registration?.update().catch(() => {});
  if (typeof location !== 'undefined') location.reload();
}
