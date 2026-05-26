/**
 * App-level glue that ties the unlock state + Drive auth + provider into the
 * provider-agnostic sync engine. Kept separate from the engine so the engine
 * stays testable without the browser-only GIS/Drive dependencies.
 *
 * ⚠️ The end-to-end path (GIS consent popup → Drive REST upload) can only be
 * verified in a real browser with a signed-in Google account — see T154.
 */
import { getSessionKey } from '../crypto/session';
import { isSyncConfigured } from './drive-auth';
import { GoogleDriveProvider } from './drive-blob';
import { configure, isConfigured, sync } from './sync-engine';
import { installSyncTriggers } from './triggers';
import { AuthenticationError, type SyncResult } from './types';

let provider: GoogleDriveProvider | null = null;
let uninstallTriggers: (() => void) | null = null;

/**
 * Configure the engine once the vault is unlocked (key in memory) AND an OAuth
 * client ID is present. Idempotent. Returns true if sync is now active.
 */
export function initSyncIfReady(): boolean {
  if (isConfigured()) return true;
  const key = getSessionKey();
  if (key === null || !isSyncConfigured()) return false;
  provider = new GoogleDriveProvider();
  configure(provider, key);
  uninstallTriggers = installSyncTriggers();
  return true;
}

/**
 * User-facing sync (the "Sync now" button): runs a full sync, and if the
 * provider reports it isn't authenticated yet, kicks off the Google sign-in
 * consent flow once and retries.
 */
export async function triggerSync(): Promise<SyncResult> {
  if (!initSyncIfReady()) {
    throw new Error('sync unavailable — vault locked or no Drive client configured');
  }
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
