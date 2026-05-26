/**
 * Returning-user unlock (T116, US-P1-A / FR-001).
 *
 * On launch, if encrypted data exists on this device, the user re-enters their
 * passphrase. We re-derive the key from the stored (non-secret) salt and verify
 * it decrypts the data. A wrong passphrase is reported generically and the timing
 * is dominated by the fixed-cost KDF, so it doesn't leak which step failed.
 */
import { deriveKey } from '../crypto/kdf';
import { setSessionKey, clearSessionKey } from '../crypto/session';
import { saltFromBase64 } from '../crypto/salt';
import { tryDecryptWithCurrentKey } from '../db/store';

/** localStorage key holding the per-user PBKDF2 salt (non-secret). */
export const SALT_STORAGE_KEY = 'mtrb.salt';

/** True if this device has a stored salt — i.e. a passphrase was set up here. */
export function hasStoredSalt(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(SALT_STORAGE_KEY) !== null;
}

/**
 * Try to unlock with `passphrase`. On success the session key is set and verified
 * to decrypt the stored data, and this returns true. On the wrong passphrase no
 * key is retained and it returns false.
 */
export async function attemptUnlock(passphrase: string): Promise<boolean> {
  const saltB64 =
    typeof localStorage !== 'undefined' ? localStorage.getItem(SALT_STORAGE_KEY) : null;
  if (saltB64 === null) return false;
  const key = await deriveKey(passphrase, saltFromBase64(saltB64));
  setSessionKey(key);
  const ok = await tryDecryptWithCurrentKey();
  if (!ok) clearSessionKey();
  return ok;
}
