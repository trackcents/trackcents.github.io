/**
 * App-level glue that ties the unlock state + Drive auth + provider into the
 * provider-agnostic sync engine. Kept separate from the engine so the engine
 * stays testable without the browser-only GIS/Drive dependencies.
 *
 * ⚠️ The end-to-end path (GIS consent popup → Drive REST upload) can only be
 * verified in a real browser with a signed-in Google account — see T154.
 */
import { isSyncConfigured, ensureToken } from './drive-auth';
import { GoogleDriveProvider } from './drive-blob';
import { configure, isConfigured, sync } from './sync-engine';
import { installSyncTriggers } from './triggers';
import { AuthenticationError, type SyncResult } from './types';

let provider: GoogleDriveProvider | null = null;
let uninstallTriggers: (() => void) | null = null;

/**
 * Configure the engine once an OAuth client ID is present (sync is plaintext now,
 * so there's no key to wait for). Idempotent. Returns true if sync is now active.
 */
export function initSyncIfReady(): boolean {
  if (isConfigured()) return true;
  if (!isSyncConfigured()) return false;
  provider = new GoogleDriveProvider();
  configure(provider);
  uninstallTriggers = installSyncTriggers();
  return true;
}

/**
 * User-facing sync (the "Sync now" button). Ensures a valid access token FIRST
 * (cached, then a silent refresh, then interactive consent) so an expired
 * in-memory token doesn't trigger a popup mid-sync that desktop browsers block.
 * If the blob read/write still reports an auth failure, falls back to one
 * interactive sign-in and retries.
 */
export async function triggerSync(): Promise<SyncResult> {
  if (!initSyncIfReady()) {
    throw new Error('sync unavailable — no Google Drive client is configured');
  }
  await ensureToken();
  try {
    return await sync();
  } catch (err) {
    if (err instanceof AuthenticationError && provider !== null) {
      await provider.authenticate();
      return await sync();
    }
    throw err;
  }
}

/** Remove the on-close triggers (e.g. on sign-out / lock). */
export function teardownSync(): void {
  uninstallTriggers?.();
  uninstallTriggers = null;
}
