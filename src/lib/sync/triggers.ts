/**
 * On-app-close sync triggers (T156). Pushes the local state when the page is
 * being hidden or unloaded, so a close on phone propagates to laptop. Best-effort:
 * a failed background push is swallowed (the next manual/open sync will retry).
 * No-ops until the engine is configured, and in non-DOM (test/SSR) environments.
 */
import { push, isConfigured } from './sync-engine';

function backgroundPush(onError?: (e: unknown) => void): void {
  if (!isConfigured()) return;
  void push().catch((e: unknown) => onError?.(e));
}

/** Install visibilitychange + pagehide push triggers. Returns an uninstaller. */
export function installSyncTriggers(opts?: { onError?: (e: unknown) => void }): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') backgroundPush(opts?.onError);
  };
  const onPageHide = (): void => backgroundPush(opts?.onError);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}
