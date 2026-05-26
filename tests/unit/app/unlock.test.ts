// @vitest-environment node
import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { attemptUnlock, hasStoredSalt, SALT_STORAGE_KEY } from '../../../src/lib/app/unlock';
import { saveState } from '../../../src/lib/db/store';
import { setSessionKey, clearSessionKey } from '../../../src/lib/crypto/session';
import { deriveKey } from '../../../src/lib/crypto/kdf';
import { generateSalt, saltToBase64 } from '../../../src/lib/crypto/salt';

// node has no localStorage by default — stub an in-memory one. (OPFS is also
// absent, so the store falls back to localStorage, which is what we want here.)
function stubLocalStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k)
  });
}

const PASSPHRASE = 'correct horse battery staple';

beforeEach(() => {
  clearSessionKey();
  stubLocalStorage();
});
afterEach(() => {
  clearSessionKey();
  vi.unstubAllGlobals();
});

describe('returning-user unlock (T116)', () => {
  test('hasStoredSalt reflects whether a passphrase was set up here', () => {
    expect(hasStoredSalt()).toBe(false);
    localStorage.setItem(SALT_STORAGE_KEY, 'c2FsdA==');
    expect(hasStoredSalt()).toBe(true);
  });

  test('right passphrase unlocks; wrong passphrase is rejected', async () => {
    const salt = generateSalt();
    localStorage.setItem(SALT_STORAGE_KEY, saltToBase64(salt));

    // Simulate a prior encrypted save with the real key derived from the passphrase.
    setSessionKey(await deriveKey(PASSPHRASE, salt));
    await saveState({ version: 1, imports: [], reconciliation_links: [] });
    clearSessionKey();

    expect(await attemptUnlock('the wrong passphrase entirely')).toBe(false);
    expect(await attemptUnlock(PASSPHRASE)).toBe(true);
  });
});
