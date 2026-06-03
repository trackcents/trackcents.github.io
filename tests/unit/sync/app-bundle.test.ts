// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildBundleString, applyRemotePayload } from '../../../src/lib/sync/app-bundle';
import {
  clearState,
  loadState,
  serializeState,
  type PersistedState
} from '../../../src/lib/db/store';

function stubLocalStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k)
  });
}

/** Build a remote bundle string carrying the given side stores (empty main). */
async function remoteBundleWith(stores: Record<string, unknown>): Promise<string> {
  for (const [k, v] of Object.entries(stores)) localStorage.setItem(k, JSON.stringify(v));
  const s = await buildBundleString();
  for (const k of Object.keys(stores)) localStorage.removeItem(k);
  return s;
}

beforeEach(async () => {
  stubLocalStorage();
  await clearState();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app-bundle merge (task #79 — categories/recurring/budgets/goals sync)', () => {
  test('id-keyed collections union; a fresh device gains the remote category', async () => {
    const remote = await remoteBundleWith({
      'mtrb.categorization': { categories: [{ id: 'b', name: 'B' }], rules: [], annotations: {} }
    });
    localStorage.setItem(
      'mtrb.categorization',
      JSON.stringify({ categories: [{ id: 'a', name: 'A' }], rules: [], annotations: {} })
    );

    const { bundle } = await applyRemotePayload(remote);
    expect(bundle).toBe(true);

    const cat = JSON.parse(localStorage.getItem('mtrb.categorization') ?? '{}');
    expect(cat.categories.map((c: { id: string }) => c.id).sort()).toEqual(['a', 'b']);
  });

  test('id collision resolves last-(remote)-writer-wins', async () => {
    const remote = await remoteBundleWith({
      'mtrb.categorization': {
        categories: [{ id: 'x', name: 'Remote' }],
        rules: [],
        annotations: {}
      }
    });
    localStorage.setItem(
      'mtrb.categorization',
      JSON.stringify({ categories: [{ id: 'x', name: 'Local' }], rules: [], annotations: {} })
    );

    await applyRemotePayload(remote);

    const cat = JSON.parse(localStorage.getItem('mtrb.categorization') ?? '{}');
    expect(cat.categories).toEqual([{ id: 'x', name: 'Remote' }]);
  });

  test('annotations union: remote wins on a shared key, both unique keys survive', async () => {
    const remote = await remoteBundleWith({
      'mtrb.categorization': {
        categories: [],
        rules: [],
        annotations: { k1: { category_id: 'r' }, k2: { category_id: 'r2' } }
      }
    });
    localStorage.setItem(
      'mtrb.categorization',
      JSON.stringify({
        categories: [],
        rules: [],
        annotations: { k1: { category_id: 'l' }, k3: { category_id: 'l3' } }
      })
    );

    await applyRemotePayload(remote);

    const cat = JSON.parse(localStorage.getItem('mtrb.categorization') ?? '{}');
    expect(cat.annotations.k1.category_id).toBe('r'); // remote wins
    expect(cat.annotations.k2.category_id).toBe('r2'); // remote-only added
    expect(cat.annotations.k3.category_id).toBe('l3'); // local-only kept
  });

  test('recurring items union and {$bigint} sentinels ride along untouched', async () => {
    const remote = await remoteBundleWith({
      'mtrb.recurring': { items: [{ id: 'r1', amount_minor: { $bigint: '500' } }], sections: [] }
    });
    localStorage.setItem(
      'mtrb.recurring',
      JSON.stringify({ items: [{ id: 'l1', amount_minor: { $bigint: '100' } }], sections: [] })
    );

    await applyRemotePayload(remote);

    const rec = JSON.parse(localStorage.getItem('mtrb.recurring') ?? '{}');
    expect(rec.items.map((i: { id: string }) => i.id).sort()).toEqual(['l1', 'r1']);
    const r1 = rec.items.find((i: { id: string }) => i.id === 'r1');
    expect(r1.amount_minor).toEqual({ $bigint: '500' });
  });

  test('budgets map, goals array, and the paycheck anchor merge', async () => {
    const remote = await remoteBundleWith({
      'mtrb.budgets': { cat1: '1000', cat2: '2000' },
      'mtrb.goals': [{ id: 'g1', name: 'G1' }],
      'mtrb.budget.anchor': { year: 2026, month: 6 }
    });
    localStorage.setItem('mtrb.budgets', JSON.stringify({ cat1: '999', cat3: '3000' }));
    localStorage.setItem('mtrb.goals', JSON.stringify([{ id: 'g0', name: 'G0' }]));
    localStorage.setItem('mtrb.budget.anchor', JSON.stringify({ year: 2025, month: 1 }));

    await applyRemotePayload(remote);

    expect(JSON.parse(localStorage.getItem('mtrb.budgets') ?? '{}')).toEqual({
      cat1: '1000', // remote wins
      cat2: '2000', // remote-only
      cat3: '3000' // local-only kept
    });
    expect(
      JSON.parse(localStorage.getItem('mtrb.goals') ?? '[]')
        .map((g: { id: string }) => g.id)
        .sort()
    ).toEqual(['g0', 'g1']);
    expect(JSON.parse(localStorage.getItem('mtrb.budget.anchor') ?? '{}')).toEqual({
      year: 2026,
      month: 6
    });
  });

  test('a store absent from the remote bundle leaves the local copy untouched', async () => {
    const remote = await remoteBundleWith({
      'mtrb.categorization': { categories: [{ id: 'x' }], rules: [], annotations: {} }
    });
    localStorage.setItem(
      'mtrb.recurring',
      JSON.stringify({ items: [{ id: 'keep' }], sections: [] })
    );

    await applyRemotePayload(remote);

    const rec = JSON.parse(localStorage.getItem('mtrb.recurring') ?? '{}');
    expect(rec.items[0].id).toBe('keep');
  });

  test('a legacy main-only blob (no bundle schema) is still accepted and unioned', async () => {
    const legacy = serializeState({
      version: 1,
      imports: [],
      reconciliation_links: []
    } as PersistedState);

    const { bundle } = await applyRemotePayload(legacy);
    expect(bundle).toBe(false);
    expect((await loadState()).imports).toEqual([]);
  });

  test('round-trip fidelity: a fresh device reproduces realistic stores with nothing dropped', async () => {
    // Mirrors the real shapes: a split annotation with a {$bigint} amount + an
    // income_pocket, a full pocket list, and a recurring item with a payment
    // history (also bigint). On a FRESH device (empty local), union-with-empty
    // must reproduce these EXACTLY — any dropped field would surface as inequality.
    const categorization = {
      categories: [
        { id: 'food', name: 'Food', color: '#84cc16' },
        { id: 'rent', name: 'Rent', color: '#6366f1' }
      ],
      rules: [{ id: 'r1', contains: 'WHOLEFOODS', category_id: 'food' }],
      annotations: {
        'hash#0': {
          source: 'manual',
          split: [
            { category_id: 'food', amount_minor: { $bigint: '-1200' } },
            { category_id: 'rent', amount_minor: { $bigint: '-800' } }
          ]
        },
        'hash#3': {
          category_id: null,
          source: 'manual',
          income_pocket: 'paychecks',
          income_kind: 'paycheck'
        }
      },
      pockets: [
        { id: 'paychecks', name: 'Paychecks', logo: '💵', color: 'success', order: 0 },
        { id: 'extra', name: 'Extra', logo: '🎁', color: 'accent', order: 1 }
      ]
    };
    const recurring = {
      items: [
        {
          id: 'bill1',
          name: 'Rent',
          amount_minor: { $bigint: '220000' },
          section_id: 'bills',
          cadence: 'monthly',
          due_date: '2026-06-30',
          order: 0,
          payments: [
            {
              month: '2026-05',
              amount_minor: { $bigint: '220000' },
              paid_date: '2026-05-30',
              paid_from: 'paychecks'
            }
          ]
        }
      ],
      sections: [{ id: 'bills', name: 'Bills', logo: '📋', order: 0 }]
    };

    const remote = await remoteBundleWith({
      'mtrb.categorization': categorization,
      'mtrb.recurring': recurring
    });
    // Fresh device: no local side stores.
    await applyRemotePayload(remote);

    expect(JSON.parse(localStorage.getItem('mtrb.categorization') ?? 'null')).toEqual(
      categorization
    );
    expect(JSON.parse(localStorage.getItem('mtrb.recurring') ?? 'null')).toEqual(recurring);
  });
});
