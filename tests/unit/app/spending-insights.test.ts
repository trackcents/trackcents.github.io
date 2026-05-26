import { describe, it, expect } from 'vitest';
import {
  compareCategorySpending,
  latestTwoMonthKeys,
  topMovers,
  monthOverMonthInsight,
  type CategoryDelta
} from '../../../src/lib/app/spending-insights';

// Helper: build a category→cents map.
function m(entries: Array<[string | null, bigint]>): Map<string | null, bigint> {
  return new Map(entries);
}

describe('compareCategorySpending', () => {
  const current = m([
    ['groceries', 15000n],
    ['gas', 4000n],
    ['fun', 3000n] // new this month
  ]);
  const previous = m([
    ['groceries', 10000n],
    ['gas', 8000n],
    ['rent', 200000n] // gone this month
  ]);
  const deltas = compareCategorySpending(current, previous);

  it('emits one row per category present in either period', () => {
    const ids = deltas.map((d) => d.category_id).sort();
    expect(ids).toEqual(['fun', 'gas', 'groceries', 'rent']);
  });

  it('computes signed delta = current − previous', () => {
    const byId = new Map(deltas.map((d) => [d.category_id, d]));
    expect(byId.get('groceries')!.delta_minor).toBe(5000n); // 150 − 100 = +50
    expect(byId.get('gas')!.delta_minor).toBe(-4000n); // 40 − 80 = −40
    expect(byId.get('fun')!.delta_minor).toBe(3000n); // new
    expect(byId.get('rent')!.delta_minor).toBe(-200000n); // gone
  });

  it('percentage is null for a new category (no prior baseline), else (delta/prev)*100', () => {
    const byId = new Map(deltas.map((d) => [d.category_id, d]));
    expect(byId.get('fun')!.pct_change).toBeNull(); // previous 0 → null
    expect(byId.get('groceries')!.pct_change).toBeCloseTo(50, 6); // +50%
    expect(byId.get('gas')!.pct_change).toBeCloseTo(-50, 6); // −50%
    expect(byId.get('rent')!.pct_change).toBeCloseTo(-100, 6); // gone → −100%
  });

  it('CONSERVATION: Σ delta = total current − total previous', () => {
    const sumDelta = deltas.reduce((s, d) => s + d.delta_minor, 0n);
    const totalCur = [...current.values()].reduce((s, v) => s + v, 0n);
    const totalPrev = [...previous.values()].reduce((s, v) => s + v, 0n);
    expect(sumDelta).toBe(totalCur - totalPrev);
  });

  it('ranks by absolute change, biggest mover first (rent dominates)', () => {
    expect(deltas[0]!.category_id).toBe('rent'); // |−200000| is largest
  });

  it('is deterministic regardless of input map order', () => {
    const reversed = compareCategorySpending(
      m([...current.entries()].reverse()),
      m([...previous.entries()].reverse())
    );
    expect(reversed).toEqual(deltas);
  });
});

describe('latestTwoMonthKeys', () => {
  it('picks the two most recent months', () => {
    const byMonth = new Map<string, Map<string | null, bigint>>([
      ['2026-01', m([['a', 1n]])],
      ['2026-03', m([['a', 3n]])],
      ['2026-02', m([['a', 2n]])]
    ]);
    expect(latestTwoMonthKeys(byMonth)).toEqual({ current: '2026-03', previous: '2026-02' });
  });

  it('returns null with fewer than two months', () => {
    expect(latestTwoMonthKeys(new Map([['2026-01', m([['a', 1n]])]]))).toBeNull();
    expect(latestTwoMonthKeys(new Map())).toBeNull();
  });
});

describe('topMovers', () => {
  it('splits into top increases and decreases, omitting zero deltas', () => {
    const deltas: CategoryDelta[] = [
      {
        category_id: 'a',
        current_minor: 0n,
        previous_minor: 0n,
        delta_minor: 0n,
        pct_change: null
      },
      {
        category_id: 'b',
        current_minor: 90n,
        previous_minor: 10n,
        delta_minor: 80n,
        pct_change: 800
      },
      {
        category_id: 'c',
        current_minor: 10n,
        previous_minor: 60n,
        delta_minor: -50n,
        pct_change: -83
      },
      {
        category_id: 'd',
        current_minor: 30n,
        previous_minor: 10n,
        delta_minor: 20n,
        pct_change: 200
      }
    ];
    const { increased, decreased } = topMovers(deltas, 1);
    expect(increased.map((d) => d.category_id)).toEqual(['b']); // biggest increase
    expect(decreased.map((d) => d.category_id)).toEqual(['c']); // biggest decrease
  });
});

describe('monthOverMonthInsight', () => {
  it('compares the two most recent months end-to-end', () => {
    const byMonth = new Map<string, Map<string | null, bigint>>([
      ['2026-02', m([['groceries', 10000n]])],
      ['2026-03', m([['groceries', 12000n]])]
    ]);
    const res = monthOverMonthInsight(byMonth)!;
    expect(res.current).toBe('2026-03');
    expect(res.previous).toBe('2026-02');
    expect(res.deltas[0]!.delta_minor).toBe(2000n);
  });

  it('returns null when there is only one month', () => {
    expect(monthOverMonthInsight(new Map([['2026-03', m([['a', 1n]])]]))).toBeNull();
  });
});
