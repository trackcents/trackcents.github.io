/**
 * Hierarchical category roll-up — pure logic. Parent totals must include every
 * descendant; drill levels rank by rolled total; uncategorized + orphan spend
 * are never lost.
 */
import { describe, expect, test } from 'vitest';
import {
  buildCategoryTree,
  findNode,
  levelRows,
  pathTo,
  sumTotals,
  UNCATEGORIZED_ID,
  type CatNode
} from '../../../src/lib/app/category-tree';
import type { Category } from '../../../src/lib/app/categorization';

const cats: Category[] = [
  { id: 'food', name: 'Food' },
  { id: 'rest', name: 'Restaurants', parent_id: 'food' },
  { id: 'biryani', name: 'Biryani', parent_id: 'rest' },
  { id: 'groc', name: 'Groceries', parent_id: 'food' },
  { id: 'shop', name: 'Shopping' }
];
const nameOf = (id: string | null): string =>
  id === null ? 'Uncategorized' : (cats.find((c) => c.id === id)?.name ?? id);

// Food has $10 direct; Restaurants $20 direct; Biryani $30; Groceries $40; Shopping $50.
// Uncategorized $5; an orphan id 'ghost' $7.
const spend = new Map<string | null, bigint>([
  ['food', 1000n],
  ['rest', 2000n],
  ['biryani', 3000n],
  ['groc', 4000n],
  ['shop', 5000n],
  [null, 500n],
  ['ghost', 700n]
]);

const roots = buildCategoryTree(cats, spend, nameOf);

describe('buildCategoryTree — roll-up', () => {
  test('parent total = own + all descendants', () => {
    const food = findNode(roots, 'food')!;
    // own 1000 + Restaurants(2000 + Biryani 3000) + Groceries 4000 = 10000
    expect(food.totalMinor).toBe(10000n);
    expect(food.ownMinor).toBe(1000n);
    expect(findNode(roots, 'rest')!.totalMinor).toBe(5000n); // 2000 + 3000
    expect(findNode(roots, 'biryani')!.totalMinor).toBe(3000n);
  });
  test('hasChildrenWithSpend flags drillability', () => {
    expect(findNode(roots, 'food')!.hasChildrenWithSpend).toBe(true);
    expect(findNode(roots, 'biryani')!.hasChildrenWithSpend).toBe(false);
    expect(findNode(roots, 'shop')!.hasChildrenWithSpend).toBe(false);
  });
  test('uncategorized + orphan spend become roots (never lost)', () => {
    expect(findNode(roots, UNCATEGORIZED_ID)!.totalMinor).toBe(500n);
    expect(findNode(roots, 'ghost')!.totalMinor).toBe(700n); // unknown id kept as a root
  });
  test('CONSERVATION: sum of root totals = sum of all direct spend', () => {
    const allDirect = [...spend.values()].reduce((a, b) => a + b, 0n);
    expect(sumTotals(levelRows(roots, null))).toBe(allDirect);
  });
});

describe('levelRows — one drill level, ranked', () => {
  test('top level ranked by total desc, zero-spend hidden', () => {
    const top = levelRows(roots, null).map((n) => n.id);
    // Food 10000, Shopping 5000, ghost 700, Uncategorized 500
    expect(top).toEqual(['food', 'shop', 'ghost', UNCATEGORIZED_ID]);
  });
  test('drilling Food shows its children ranked (Groceries 4000 > Restaurants 5000? no)', () => {
    const kids = levelRows(roots, 'food').map((n) => n.id);
    // Restaurants rolled 5000 > Groceries 4000
    expect(kids).toEqual(['rest', 'groc']);
  });
  test('a leaf has no level rows', () => {
    expect(levelRows(roots, 'biryani')).toEqual([]);
  });
});

describe('pathTo — breadcrumb', () => {
  test('path to a deep node', () => {
    expect(pathTo(roots, 'biryani').map((n) => n.name)).toEqual(['Food', 'Restaurants', 'Biryani']);
  });
  test('empty for unknown', () => {
    expect(pathTo(roots, 'nope')).toEqual([]);
  });
});

describe('zero-spend parent still rolls up children', () => {
  test('parent with no direct spend but spending children', () => {
    const c2: Category[] = [
      { id: 'p', name: 'Parent' },
      { id: 'k', name: 'Kid', parent_id: 'p' }
    ];
    const r = buildCategoryTree(c2, new Map<string | null, bigint>([['k', 900n]]), (id) =>
      id === null ? 'U' : (c2.find((c) => c.id === id)?.name ?? id)
    );
    const p = findNode(r, 'p') as CatNode;
    expect(p.ownMinor).toBe(0n);
    expect(p.totalMinor).toBe(900n);
    expect(levelRows(r, null).map((n) => n.id)).toEqual(['p']); // shows up via rolled total
  });
});

describe('cycle / self-parent robustness (defensive — unreachable via UI today)', () => {
  const nm = (id: string | null): string => id ?? 'U';

  test('self-parent (X→X): spend is conserved and the build terminates', () => {
    const c: Category[] = [{ id: 'x', name: 'X', parent_id: 'x' }];
    const r = buildCategoryTree(c, new Map<string | null, bigint>([['x', 500n]]), nm);
    expect(sumTotals(r)).toBe(500n); // not silently dropped
    expect(findNode(r, 'x')!.totalMinor).toBe(500n);
    expect(pathTo(r, 'x').length).toBeGreaterThan(0); // findNode/pathTo don't hang
  });

  test('2-cycle (A→B→A): both counted exactly once, build terminates', () => {
    const c: Category[] = [
      { id: 'a', name: 'A', parent_id: 'b' },
      { id: 'b', name: 'B', parent_id: 'a' }
    ];
    const r = buildCategoryTree(
      c,
      new Map<string | null, bigint>([
        ['a', 100n],
        ['b', 200n]
      ]),
      nm
    );
    expect(sumTotals(r)).toBe(300n); // conserved, no double-count, no infinite loop
    expect(findNode(r, 'a')).not.toBeNull();
    expect(findNode(r, 'b')).not.toBeNull();
  });
});

describe('levelRows — equal totals get a deterministic, name-ordered tie-break', () => {
  test('tied rows are ordered by name (comparator returns a 0-equivalent)', () => {
    const c: Category[] = [
      { id: 'z', name: 'Zebra' },
      { id: 'm', name: 'Mango' },
      { id: 'a', name: 'Apple' }
    ];
    const r = buildCategoryTree(
      c,
      new Map<string | null, bigint>([
        ['z', 100n],
        ['m', 100n],
        ['a', 100n]
      ]),
      (id) => id ?? 'U'
    );
    expect(levelRows(r, null).map((n) => n.name)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  test('ordering is independent of input order (was reversed-input-order before the fix)', () => {
    const mk = (cs: Category[]): string[] =>
      levelRows(
        buildCategoryTree(
          cs,
          new Map<string | null, bigint>([
            ['p', 50n],
            ['q', 50n]
          ]),
          (id) => id ?? 'U'
        ),
        null
      ).map((n) => n.name);
    const fwd = mk([
      { id: 'p', name: 'Pp' },
      { id: 'q', name: 'Qq' }
    ]);
    const rev = mk([
      { id: 'q', name: 'Qq' },
      { id: 'p', name: 'Pp' }
    ]);
    expect(fwd).toEqual(rev);
    expect(fwd).toEqual(['Pp', 'Qq']);
  });
});
