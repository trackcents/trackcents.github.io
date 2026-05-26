// IV&V verification environment — spending-insights (US-INSIGHT month-over-month deltas).
//
// Independent of the implementation: the reference model below is written ONLY
// from the verification contract + spec §8, never from the DUT source. The DUT
// source (src/lib/app/spending-insights.ts) was NOT read.
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
//
// Headlines (oracle-free, per contract §11): INV1 conservation + INV3 delta
// correctness + INV4 ranking-determinism (permutation invariance). The pct is
// display-only — verified for null-iff-previous-0, sign, and hand cases only.

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import {
  compareCategorySpending,
  latestTwoMonthKeys,
  topMovers,
  monthOverMonthInsight,
  type CategoryDelta,
  type TopMovers
} from '../../../src/lib/app/spending-insights';
import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---------------------------------------------------------------------------
// Functional coverage plan (vplan cover points → INV/R traceability)
// ---------------------------------------------------------------------------
const cov = new CoverageModel([
  'empty-both', // edge: both maps empty
  'only-current', // category present only this period (previous 0)
  'only-previous', // category present only last period (current 0)
  'overlap', // category present in both periods
  'large-bigint', // a value > 2^53 (bigint exactness)
  'delta-tie', // two rows with equal |delta| (tiebreak path)
  'null-category', // a null category_id present
  'pct-null', // previous == 0 => pct null
  'pct-positive', // delta > 0 with previous > 0
  'pct-negative', // delta < 0 with previous > 0
  'pct-zero', // delta == 0 with previous > 0
  'months-0', // latestTwoMonthKeys / insight with 0 months
  'months-1', // ... with 1 month
  'months-2plus', // ... with >= 2 months
  'topMovers-n-le-0', // n <= 0 => empty
  'topMovers-n-gt-avail', // n larger than available => all
  'topMovers-excludes-zero' // delta == 0 excluded from both lists
]);

// ---------------------------------------------------------------------------
// Independent reference model (the "golden") — written from the contract alone.
// ---------------------------------------------------------------------------
function refCompare(
  current: ReadonlyMap<string | null, bigint>,
  previous: ReadonlyMap<string | null, bigint>
): CategoryDelta[] {
  const keys = new Set<string | null>();
  for (const k of current.keys()) keys.add(k);
  for (const k of previous.keys()) keys.add(k);

  const rows: CategoryDelta[] = [];
  for (const k of keys) {
    const cur = current.get(k) ?? 0n;
    const prev = previous.get(k) ?? 0n;
    const delta = cur - prev;
    const pct = prev === 0n ? null : (Number(delta) / Number(prev)) * 100;
    rows.push({
      category_id: k,
      current_minor: cur,
      previous_minor: prev,
      delta_minor: delta,
      pct_change: pct
    });
  }

  // Ranking: |delta| desc, then current desc, then category_id asc (null LAST).
  rows.sort((a, b) => {
    const absA = a.delta_minor < 0n ? -a.delta_minor : a.delta_minor;
    const absB = b.delta_minor < 0n ? -b.delta_minor : b.delta_minor;
    if (absA !== absB) return absA > absB ? -1 : 1;
    if (a.current_minor !== b.current_minor) return a.current_minor > b.current_minor ? -1 : 1;
    // category_id asc, null sorts last.
    if (a.category_id === b.category_id) return 0;
    if (a.category_id === null) return 1;
    if (b.category_id === null) return -1;
    return a.category_id < b.category_id ? -1 : 1;
  });
  return rows;
}

function refLatestTwo(
  byMonth: ReadonlyMap<string, ReadonlyMap<string | null, bigint>>
): { current: string; previous: string } | null {
  const months = [...byMonth.keys()].sort(); // lexicographic asc
  if (months.length < 2) return null;
  const current = months[months.length - 1]!;
  const previous = months[months.length - 2]!;
  return { current, previous };
}

function refTopMovers(deltas: readonly CategoryDelta[], n: number): TopMovers {
  if (n <= 0) return { increased: [], decreased: [] };
  const increased = deltas
    .filter((d) => d.delta_minor > 0n)
    .slice()
    .sort((a, b) => (a.delta_minor > b.delta_minor ? -1 : a.delta_minor < b.delta_minor ? 1 : 0))
    .slice(0, n);
  const decreased = deltas
    .filter((d) => d.delta_minor < 0n)
    .slice()
    .sort((a, b) => (a.delta_minor < b.delta_minor ? -1 : a.delta_minor > b.delta_minor ? 1 : 0))
    .slice(0, n);
  return { increased, decreased };
}

// ---------------------------------------------------------------------------
// Generators (constrained-random stimulus)
// ---------------------------------------------------------------------------
// Category keys: a small alphabet of strings PLUS null, to force collisions,
// ties and the null-last ordering branch.
const arbKey: fc.Arbitrary<string | null> = fc.oneof(
  fc.constantFrom('a', 'b', 'c', 'd', 'food', 'rent', 'fuel'),
  fc.constant<string | null>(null)
);

// Positive spend magnitudes (contract: maps hold POSITIVE magnitudes). Include
// values well beyond 2^53 to exercise bigint exactness vs float.
const arbMagnitude: fc.Arbitrary<bigint> = fc.oneof(
  fc.bigInt({ min: 1n, max: 1_000_000n }),
  fc.bigInt({ min: 2n ** 53n, max: 2n ** 70n })
);

const arbMap: fc.Arbitrary<Map<string | null, bigint>> = fc
  .array(fc.tuple(arbKey, arbMagnitude), { maxLength: 8 })
  .map((pairs) => new Map(pairs));

const arbPair = fc.record({ current: arbMap, previous: arbMap });

// Sum helper over a map's values.
function sumValues(m: ReadonlyMap<string | null, bigint>): bigint {
  let s = 0n;
  for (const v of m.values()) s += v;
  return s;
}

// Permute a map's insertion order (for the metamorphic relation INV4).
function shuffleMap(
  m: ReadonlyMap<string | null, bigint>,
  seed: number
): Map<string | null, bigint> {
  const entries = [...m.entries()];
  // Deterministic Fisher–Yates driven by a simple LCG seeded by `seed`.
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = entries[i]!;
    const b = entries[j]!;
    entries[i] = b;
    entries[j] = a;
  }
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// INV1 — Conservation (oracle-free headline)
// ---------------------------------------------------------------------------
describe('INV1 conservation', () => {
  test('Σ current/previous/delta reconcile to the input sums (incl. >2^53)', () => {
    fc.assert(
      fc.property(arbPair, ({ current, previous }) => {
        const rows = compareCategorySpending(current, previous);
        let sumCur = 0n;
        let sumPrev = 0n;
        let sumDelta = 0n;
        for (const r of rows) {
          sumCur += r.current_minor;
          sumPrev += r.previous_minor;
          sumDelta += r.delta_minor;
        }
        const inCur = sumValues(current);
        const inPrev = sumValues(previous);
        cov.coverIf(current.size === 0 && previous.size === 0, 'empty-both');
        cov.coverIf(
          [...current.values(), ...previous.values()].some((v) => v > 2n ** 53n),
          'large-bigint'
        );
        expect(sumCur).toBe(inCur);
        expect(sumPrev).toBe(inPrev);
        expect(sumDelta).toBe(inCur - inPrev);
      }),
      { numRuns: 400 }
    );
  });
});

// ---------------------------------------------------------------------------
// INV3 — Delta correctness (bigint-exact, oracle-free)
// ---------------------------------------------------------------------------
describe('INV3 delta correctness', () => {
  test('every row delta_minor === current_minor − previous_minor', () => {
    fc.assert(
      fc.property(arbPair, ({ current, previous }) => {
        for (const r of compareCategorySpending(current, previous)) {
          expect(r.delta_minor).toBe(r.current_minor - r.previous_minor);
        }
      }),
      { numRuns: 400 }
    );
  });
});

// ---------------------------------------------------------------------------
// INV2 — Completeness & uniqueness
// ---------------------------------------------------------------------------
describe('INV2 completeness & uniqueness', () => {
  test('output category set == union of input keys, no dups', () => {
    fc.assert(
      fc.property(arbPair, ({ current, previous }) => {
        const rows = compareCategorySpending(current, previous);
        const union = new Set<string | null>([...current.keys(), ...previous.keys()]);
        const outKeys = rows.map((r) => r.category_id);
        // no duplicates
        expect(new Set(outKeys).size).toBe(outKeys.length);
        // exact set equality
        expect(new Set(outKeys)).toEqual(union);

        cov.coverIf(outKeys.includes(null), 'null-category');
        for (const k of current.keys()) cov.coverIf(!previous.has(k), 'only-current');
        for (const k of previous.keys()) cov.coverIf(!current.has(k), 'only-previous');
        for (const k of current.keys()) cov.coverIf(previous.has(k), 'overlap');
      }),
      { numRuns: 400 }
    );
  });
});

// ---------------------------------------------------------------------------
// INV4 — Ranking determinism (metamorphic: permutation invariance)
// ---------------------------------------------------------------------------
describe('INV4 ranking determinism', () => {
  test('permuting input insertion order yields a deep-equal ordered result', () => {
    fc.assert(
      fc.property(arbPair, fc.integer(), fc.integer(), ({ current, previous }, s1, s2) => {
        const base = compareCategorySpending(current, previous);
        const permuted = compareCategorySpending(shuffleMap(current, s1), shuffleMap(previous, s2));
        expect(permuted).toEqual(base);
      }),
      { numRuns: 300 }
    );
  });

  test('ordering obeys |delta| desc → current desc → category_id asc (null last)', () => {
    fc.assert(
      fc.property(arbPair, ({ current, previous }) => {
        const rows = compareCategorySpending(current, previous);
        for (let i = 1; i < rows.length; i++) {
          const a = rows[i - 1]!;
          const b = rows[i]!;
          const absA = a.delta_minor < 0n ? -a.delta_minor : a.delta_minor;
          const absB = b.delta_minor < 0n ? -b.delta_minor : b.delta_minor;
          // a must not rank AFTER b — assert a <= b in the ordering.
          let cmp: number;
          if (absA !== absB) cmp = absA > absB ? -1 : 1;
          else if (a.current_minor !== b.current_minor)
            cmp = a.current_minor > b.current_minor ? -1 : 1;
          else if (a.category_id === b.category_id) cmp = 0;
          else if (a.category_id === null) cmp = 1;
          else if (b.category_id === null) cmp = -1;
          else cmp = a.category_id < b.category_id ? -1 : 1;
          expect(cmp).toBeLessThanOrEqual(0);
          cov.coverIf(absA === absB, 'delta-tie');
        }
      }),
      { numRuns: 400 }
    );
  });
});

// ---------------------------------------------------------------------------
// INV5 — Purity (input maps not mutated)
// ---------------------------------------------------------------------------
describe('INV5 purity', () => {
  test('input maps are not mutated', () => {
    fc.assert(
      fc.property(arbPair, ({ current, previous }) => {
        const snapCur = [...current.entries()];
        const snapPrev = [...previous.entries()];
        compareCategorySpending(current, previous);
        expect([...current.entries()]).toEqual(snapCur);
        expect([...previous.entries()]).toEqual(snapPrev);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// INV6 — pct semantics + hand cases
// ---------------------------------------------------------------------------
describe('INV6 pct semantics', () => {
  test('pct_change null IFF previous==0; else sign matches delta', () => {
    fc.assert(
      fc.property(arbPair, ({ current, previous }) => {
        for (const r of compareCategorySpending(current, previous)) {
          if (r.previous_minor === 0n) {
            expect(r.pct_change).toBeNull();
            cov.cover('pct-null');
          } else {
            expect(r.pct_change).not.toBeNull();
            const pct = r.pct_change as number;
            if (r.delta_minor > 0n) {
              expect(pct).toBeGreaterThan(0);
              cov.cover('pct-positive');
            } else if (r.delta_minor < 0n) {
              expect(pct).toBeLessThan(0);
              cov.cover('pct-negative');
            } else {
              expect(pct).toBe(0);
              cov.cover('pct-zero');
            }
          }
        }
      }),
      { numRuns: 400 }
    );
  });

  test('hand-computed clean cases', () => {
    // 10000 -> 15000 ⇒ +50%
    const c1 = compareCategorySpending(new Map([['a', 15000n]]), new Map([['a', 10000n]]));
    expect(c1[0]!.pct_change).toBe(50);
    // 8000 -> 4000 ⇒ -50%
    const c2 = compareCategorySpending(new Map([['a', 4000n]]), new Map([['a', 8000n]]));
    expect(c2[0]!.pct_change).toBe(-50);
    // 200000 -> 0 ⇒ -100%
    const c3 = compareCategorySpending(new Map([['a', 0n]]), new Map([['a', 200000n]]));
    expect(c3[0]!.delta_minor).toBe(-200000n);
    expect(c3[0]!.pct_change).toBe(-100);
    // 0 -> 3000 (new category) ⇒ pct null, delta +3000
    const c4 = compareCategorySpending(new Map([['a', 3000n]]), new Map());
    expect(c4[0]!.delta_minor).toBe(3000n);
    expect(c4[0]!.pct_change).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scoreboard — DUT vs independent reference model on full output
// ---------------------------------------------------------------------------
describe('Scoreboard (DUT vs independent reference model)', () => {
  test('compareCategorySpending agrees with golden over constrained-random', () => {
    const sb = new Scoreboard<
      { current: ReadonlyMap<string | null, bigint>; previous: ReadonlyMap<string | null, bigint> },
      CategoryDelta[]
    >({
      dut: ({ current, previous }) => compareCategorySpending(current, previous),
      model: ({ current, previous }) => refCompare(current, previous)
    });
    fc.assert(
      fc.property(arbPair, (input) => {
        sb.check(input);
      }),
      { numRuns: 600 }
    );
    sb.assertClean();
    expect(sb.comparisons).toBeGreaterThanOrEqual(600);
  });
});

// ---------------------------------------------------------------------------
// R3 — latestTwoMonthKeys
// ---------------------------------------------------------------------------
const arbMonth = fc.constantFrom(
  '2025-01',
  '2025-02',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-05',
  '2024-07'
);
const arbByMonth: fc.Arbitrary<Map<string, Map<string | null, bigint>>> = fc
  .uniqueArray(arbMonth, { maxLength: 7 })
  .chain((months) =>
    fc
      .tuple(...months.map(() => arbMap))
      .map((maps) => new Map(months.map((m, i) => [m, maps[i] ?? new Map()])))
  );

describe('R3 latestTwoMonthKeys', () => {
  test('two greatest keys; null when < 2 months (vs golden)', () => {
    const sb = new Scoreboard<
      ReadonlyMap<string, ReadonlyMap<string | null, bigint>>,
      { current: string; previous: string } | null
    >({
      dut: (m) => latestTwoMonthKeys(m),
      model: (m) => refLatestTwo(m)
    });
    fc.assert(
      fc.property(arbByMonth, (byMonth) => {
        sb.check(byMonth);
        const r = latestTwoMonthKeys(byMonth);
        if (byMonth.size === 0) cov.cover('months-0');
        else if (byMonth.size === 1) cov.cover('months-1');
        else cov.cover('months-2plus');
        if (byMonth.size < 2) {
          expect(r).toBeNull();
        } else {
          expect(r).not.toBeNull();
          const sorted = [...byMonth.keys()].sort();
          expect(r!.current).toBe(sorted[sorted.length - 1]);
          expect(r!.previous).toBe(sorted[sorted.length - 2]);
          // current is lexicographically greater than previous
          expect(r!.current > r!.previous).toBe(true);
        }
      }),
      { numRuns: 300 }
    );
    sb.assertClean();
  });

  test('directed: 0 and 1 month return null', () => {
    expect(latestTwoMonthKeys(new Map())).toBeNull();
    expect(latestTwoMonthKeys(new Map([['2025-01', new Map()]]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R4 — topMovers
// ---------------------------------------------------------------------------
describe('R4 topMovers', () => {
  test('top n increases / decreases, zero excluded, n bounds (vs golden)', () => {
    const sb = new Scoreboard<{ deltas: CategoryDelta[]; n: number }, TopMovers>({
      dut: ({ deltas, n }) => topMovers(deltas, n),
      model: ({ deltas, n }) => refTopMovers(deltas, n)
    });
    fc.assert(
      fc.property(arbPair, fc.integer({ min: -2, max: 6 }), ({ current, previous }, n) => {
        const deltas = compareCategorySpending(current, previous);
        const tm = topMovers(deltas, n);
        sb.check({ deltas, n });

        if (n <= 0) {
          cov.cover('topMovers-n-le-0');
          expect(tm.increased).toEqual([]);
          expect(tm.decreased).toEqual([]);
        } else {
          // none with delta == 0 in either list
          expect(tm.increased.every((d) => d.delta_minor > 0n)).toBe(true);
          expect(tm.decreased.every((d) => d.delta_minor < 0n)).toBe(true);
          cov.coverIf(
            deltas.some((d) => d.delta_minor === 0n),
            'topMovers-excludes-zero'
          );
          // increased sorted by delta desc
          for (let i = 1; i < tm.increased.length; i++) {
            expect(tm.increased[i - 1]!.delta_minor >= tm.increased[i]!.delta_minor).toBe(true);
          }
          // decreased sorted by delta asc (most negative first)
          for (let i = 1; i < tm.decreased.length; i++) {
            expect(tm.decreased[i - 1]!.delta_minor <= tm.decreased[i]!.delta_minor).toBe(true);
          }
          // never more than n
          expect(tm.increased.length).toBeLessThanOrEqual(n);
          expect(tm.decreased.length).toBeLessThanOrEqual(n);
          const availInc = deltas.filter((d) => d.delta_minor > 0n).length;
          const availDec = deltas.filter((d) => d.delta_minor < 0n).length;
          cov.coverIf(n > availInc && availInc > 0, 'topMovers-n-gt-avail');
          // n >= available => returns all available
          if (n >= availInc) expect(tm.increased.length).toBe(availInc);
          if (n >= availDec) expect(tm.decreased.length).toBe(availDec);
        }
      }),
      { numRuns: 500 }
    );
    sb.assertClean();
  });

  test('directed: n<=0 empties; zero-delta excluded', () => {
    const deltas = compareCategorySpending(new Map([['a', 5000n]]), new Map([['a', 5000n]]));
    // a's delta is 0 → excluded from both lists for any n
    expect(topMovers(deltas, 5).increased).toEqual([]);
    expect(topMovers(deltas, 5).decreased).toEqual([]);
    expect(topMovers(deltas, 0)).toEqual({ increased: [], decreased: [] });
    expect(topMovers(deltas, -3)).toEqual({ increased: [], decreased: [] });
  });
});

// ---------------------------------------------------------------------------
// R5 — monthOverMonthInsight
// ---------------------------------------------------------------------------
describe('R5 monthOverMonthInsight', () => {
  test('latest two months => their comparison; null when < 2 months', () => {
    fc.assert(
      fc.property(arbByMonth, (byMonth) => {
        const insight = monthOverMonthInsight(byMonth);
        const keys = refLatestTwo(byMonth);
        if (keys === null) {
          expect(insight).toBeNull();
        } else {
          expect(insight).not.toBeNull();
          expect(insight!.current).toBe(keys.current);
          expect(insight!.previous).toBe(keys.previous);
          const expected = compareCategorySpending(
            byMonth.get(keys.current) ?? new Map(),
            byMonth.get(keys.previous) ?? new Map()
          );
          expect(insight!.deltas).toEqual(expected);
        }
      }),
      { numRuns: 300 }
    );
  });

  test('directed: 0/1 month => null', () => {
    expect(monthOverMonthInsight(new Map())).toBeNull();
    expect(monthOverMonthInsight(new Map([['2025-01', new Map([['a', 100n]])]]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases (directed) + bench-teeth proof (reference-model self-mutation)
// ---------------------------------------------------------------------------
describe('edges & bench teeth', () => {
  test('empty maps => empty list', () => {
    expect(compareCategorySpending(new Map(), new Map())).toEqual([]);
    cov.cover('empty-both');
  });

  test('large bigint delta is exact (> 2^53)', () => {
    const big = 2n ** 60n + 7n;
    const r = compareCategorySpending(new Map([['a', big]]), new Map([['a', 5n]]));
    expect(r[0]!.delta_minor).toBe(big - 5n);
    cov.cover('large-bigint');
  });

  test('delta==0 with previous>0 => pct exactly 0 (directed)', () => {
    // current === previous so delta is 0; previous > 0 so pct is defined.
    const r = compareCategorySpending(new Map([['a', 5000n]]), new Map([['a', 5000n]]));
    expect(r[0]!.delta_minor).toBe(0n);
    expect(r[0]!.pct_change).toBe(0);
    cov.cover('pct-zero');
  });

  test('topMovers excludes zero-delta rows (directed)', () => {
    // a: unchanged (delta 0), b: +100, c: -100. zero-delta must appear in neither list.
    const deltas = compareCategorySpending(
      new Map([
        ['a', 5000n],
        ['b', 300n],
        ['c', 200n]
      ]),
      new Map([
        ['a', 5000n],
        ['b', 200n],
        ['c', 300n]
      ])
    );
    expect(deltas.some((d) => d.delta_minor === 0n)).toBe(true);
    const tm = topMovers(deltas, 5);
    expect(tm.increased.map((d) => d.category_id)).toEqual(['b']);
    expect(tm.decreased.map((d) => d.category_id)).toEqual(['c']);
    expect([...tm.increased, ...tm.decreased].some((d) => d.delta_minor === 0n)).toBe(false);
    cov.cover('topMovers-excludes-zero');
  });

  test('|delta| tie tiebreak is deterministic (current desc then id asc)', () => {
    // a: 300->100 (delta -200), b: 100->300 (delta +200): equal |delta|=200.
    // current: a=100, b=300 → b (higher current) ranks first.
    const r = compareCategorySpending(
      new Map([
        ['a', 100n],
        ['b', 300n]
      ]),
      new Map([
        ['a', 300n],
        ['b', 100n]
      ])
    );
    expect(r.map((x) => x.category_id)).toEqual(['b', 'a']);
    cov.cover('delta-tie');
  });

  test('null category sorts LAST on full tie', () => {
    // same |delta|, same current → category_id asc with null last.
    const r = compareCategorySpending(
      new Map<string | null, bigint>([
        ['z', 100n],
        [null, 100n]
      ]),
      new Map<string | null, bigint>([
        ['z', 100n],
        [null, 100n]
      ])
    );
    expect(r.map((x) => x.category_id)).toEqual(['z', null]);
    cov.cover('null-category');
  });

  test('BENCH TEETH: a corrupted reference model is caught by the scoreboard', () => {
    // Sanity-mutate our OWN golden (off-by-one in delta) and confirm the
    // scoreboard FAILS — proving the comparison is not vacuously passing.
    const badModel = (input: {
      current: ReadonlyMap<string | null, bigint>;
      previous: ReadonlyMap<string | null, bigint>;
    }): CategoryDelta[] =>
      refCompare(input.current, input.previous).map((r) => ({
        ...r,
        delta_minor: r.delta_minor + 1n // injected fault
      }));
    const sb = new Scoreboard<
      { current: ReadonlyMap<string | null, bigint>; previous: ReadonlyMap<string | null, bigint> },
      CategoryDelta[]
    >({
      dut: ({ current, previous }) => compareCategorySpending(current, previous),
      model: badModel
    });
    sb.check({ current: new Map([['a', 100n]]), previous: new Map([['a', 50n]]) });
    expect(() => sb.assertClean()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Coverage closure gate
// ---------------------------------------------------------------------------
describe('functional coverage closure', () => {
  test('all planned cover points were exercised', () => {
    console.log(cov.report());
    cov.assertClosed();
  });
});
