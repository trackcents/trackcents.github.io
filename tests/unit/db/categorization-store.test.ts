// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadCategorization,
  saveCategorization,
  type CategorizationState
} from '../../../src/lib/db/categorization-store';
import { setSessionKey, clearSessionKey } from '../../../src/lib/crypto/session';
import { deriveKey } from '../../../src/lib/crypto/kdf';
import { generateSalt } from '../../../src/lib/crypto/salt';

function stubLocalStorage(): Map<string, string> {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k)
  });
  return m;
}

const sample: CategorizationState = {
  categories: [{ id: 'groceries', name: 'Groceries' }],
  rules: [{ id: 'r1', contains: 'WHOLEFOODS', category_id: 'groceries' }],
  annotations: { 'hash#0': { category_id: 'groceries', source: 'manual' } }
};

beforeEach(() => {
  stubLocalStorage();
  clearSessionKey();
});
afterEach(() => {
  clearSessionKey();
  vi.unstubAllGlobals();
});

describe('categorization-store', () => {
  test('empty when nothing stored', async () => {
    expect(await loadCategorization()).toEqual({ categories: [], rules: [], annotations: {} });
  });

  test('round-trips plaintext when no session key is loaded', async () => {
    await saveCategorization(sample);
    expect(await loadCategorization()).toEqual(sample);
  });

  test('encrypts at rest when a session key is loaded, and decrypts back', async () => {
    const key = await deriveKey('pw', generateSalt(), { iterations: 1000 });
    setSessionKey(key);
    await saveCategorization(sample);
    expect(localStorage.getItem('mtrb.categorization')?.startsWith('MTRBenc1:')).toBe(true);
    expect(await loadCategorization()).toEqual(sample);
  });

  test('returns empty (not a throw) when data is encrypted but locked', async () => {
    const key = await deriveKey('pw', generateSalt(), { iterations: 1000 });
    setSessionKey(key);
    await saveCategorization(sample);
    clearSessionKey(); // now locked
    expect(await loadCategorization()).toEqual({ categories: [], rules: [], annotations: {} });
  });
});
