// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadCategorization,
  saveCategorization,
  type CategorizationState
} from '../../../src/lib/db/categorization-store';
import { DEFAULT_POCKETS } from '../../../src/lib/app/pockets';

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
  annotations: { 'hash#0': { category_id: 'groceries', source: 'manual' } },
  pockets: [...DEFAULT_POCKETS]
};

beforeEach(() => {
  stubLocalStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('categorization-store', () => {
  test('empty when nothing stored (with the two default pockets)', async () => {
    expect(await loadCategorization()).toEqual({
      categories: [],
      rules: [],
      annotations: {},
      pockets: DEFAULT_POCKETS
    });
  });

  test('round-trips saved state (stored as plaintext JSON)', async () => {
    await saveCategorization(sample);
    // Stored unencrypted now — no MTRBenc1: marker.
    expect(localStorage.getItem('mtrb.categorization')?.startsWith('MTRBenc1:')).toBe(false);
    expect(await loadCategorization()).toEqual(sample);
  });

  test('round-trips a split with bigint cents (regression: JSON.stringify threw on bigint)', async () => {
    const withSplit: CategorizationState = {
      categories: [],
      rules: [],
      annotations: {
        'hash#0': {
          category_id: null,
          source: 'manual',
          split: [
            { category_id: null, amount_minor: 4000_00n },
            { category_id: null, amount_minor: 1000_00n, flow_intent: 'investment_out' }
          ]
        }
      },
      pockets: [...DEFAULT_POCKETS]
    };
    // Must NOT throw (bigint in the blob), and the bigints must survive verbatim.
    await saveCategorization(withSplit);
    const loaded = await loadCategorization();
    expect(loaded).toEqual(withSplit);
    const parts = loaded.annotations['hash#0']!.split!;
    expect(typeof parts[0]!.amount_minor).toBe('bigint');
    expect(parts[0]!.amount_minor).toBe(4000_00n);
    expect(parts[1]!.amount_minor).toBe(1000_00n);
  });

  test('pockets default in for pre-pocket states, and custom pockets round-trip', async () => {
    // A state saved before pockets existed (no `pockets` key) gains the defaults.
    const legacy = {
      categories: [],
      rules: [],
      annotations: {}
    } as unknown as CategorizationState;
    await saveCategorization(legacy);
    expect((await loadCategorization()).pockets).toEqual(DEFAULT_POCKETS);

    // A user-customised pocket list survives verbatim.
    const custom: CategorizationState = {
      categories: [],
      rules: [],
      annotations: {},
      pockets: [
        ...DEFAULT_POCKETS,
        { id: 'india', name: 'India', logo: '🇮🇳', color: 'accent', order: 2 }
      ]
    };
    await saveCategorization(custom);
    expect((await loadCategorization()).pockets).toEqual(custom.pockets);
  });
});
