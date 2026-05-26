import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import {
  monthKey,
  summarize,
  spendingByCategory,
  netByMonth,
  spendingByCategoryByMonth,
  sortedMonths,
  type SummaryTransaction
} from '../../../src/lib/app/spending-summary';

const tx = (
  amount_minor: bigint,
  posted_date = '2026-01-15',
  category_id: string | null = null
): SummaryTransaction => ({ amount_minor, posted_date, category_id });

describe('monthKey', () => {
  test('extracts YYYY-MM', () => {
    expect(monthKey('2026-03-09')).toBe('2026-03');
  });
});

describe('summarize', () => {
  test('splits inflow / outflow / net with outflow as a positive magnitude', () => {
    const s = summarize([tx(-500n), tx(2000n), tx(-1500n)]);
    expect(s).toEqual({ inflow_minor: 2000n, outflow_minor: 2000n, net_minor: 0n });
  });

  test('ignores zero-amount rows', () => {
    expect(summarize([tx(0n), tx(-100n)])).toEqual({
      inflow_minor: 0n,
      outflow_minor: 100n,
      net_minor: -100n
    });
  });

  test('empty input is all zeros', () => {
    expect(summarize([])).toEqual({ inflow_minor: 0n, outflow_minor: 0n, net_minor: 0n });
  });
});

describe('spendingByCategory', () => {
  test('groups outflow magnitudes by category, excludes inflows', () => {
    const m = spendingByCategory([
      tx(-500n, '2026-01-01', 'groceries'),
      tx(-300n, '2026-01-02', 'groceries'),
      tx(-1000n, '2026-01-03', 'rent'),
      tx(2500n, '2026-01-04', 'salary') // inflow → excluded
    ]);
    expect(m.get('groceries')).toBe(800n);
    expect(m.get('rent')).toBe(1000n);
    expect(m.has('salary')).toBe(false);
  });

  test('uncategorized outflows land in the null bucket', () => {
    expect(spendingByCategory([tx(-700n)]).get(null)).toBe(700n);
  });
});

describe('netByMonth', () => {
  test('buckets by calendar month', () => {
    const m = netByMonth([
      tx(-500n, '2026-01-10'),
      tx(2000n, '2026-01-20'),
      tx(-300n, '2026-02-05')
    ]);
    expect(m.get('2026-01')).toEqual({
      inflow_minor: 2000n,
      outflow_minor: 500n,
      net_minor: 1500n
    });
    expect(m.get('2026-02')).toEqual({ inflow_minor: 0n, outflow_minor: 300n, net_minor: -300n });
  });
});

describe('spendingByCategoryByMonth', () => {
  test('nests month → category → outflow magnitude', () => {
    const m = spendingByCategoryByMonth([
      tx(-500n, '2026-01-10', 'food'),
      tx(-200n, '2026-01-15', 'food'),
      tx(-100n, '2026-02-01', 'gas'),
      tx(900n, '2026-02-02', 'salary') // inflow excluded
    ]);
    expect(m.get('2026-01')?.get('food')).toBe(700n);
    expect(m.get('2026-02')?.get('gas')).toBe(100n);
    expect(m.get('2026-02')?.has('salary')).toBe(false);
  });
});

describe('sortedMonths', () => {
  test('returns ascending month keys', () => {
    const m = netByMonth([tx(-1n, '2026-03-01'), tx(-1n, '2026-01-01'), tx(-1n, '2026-02-01')]);
    expect(sortedMonths(m)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('conservation properties (money is never created or lost)', () => {
  const arbDate = fc
    .tuple(
      fc.integer({ min: 2020, max: 2027 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 })
    )
    .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  const arbTxn = fc.record({
    posted_date: arbDate,
    amount_minor: fc.bigInt({ min: -100_000_000_000n, max: 100_000_000_000n }),
    category_id: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null })
  });

  test('net == signed sum; inflow − outflow == net', () => {
    fc.assert(
      fc.property(fc.array(arbTxn), (txns) => {
        const s = summarize(txns);
        const signedSum = txns.reduce((acc, t) => acc + t.amount_minor, 0n);
        expect(s.net_minor).toBe(signedSum);
        expect(s.inflow_minor - s.outflow_minor).toBe(s.net_minor);
      })
    );
  });

  test('sum of per-category spending == total outflow', () => {
    fc.assert(
      fc.property(fc.array(arbTxn), (txns) => {
        const total = [...spendingByCategory(txns).values()].reduce((a, v) => a + v, 0n);
        expect(total).toBe(summarize(txns).outflow_minor);
      })
    );
  });

  test('sum of monthly net == overall net; monthly outflow sums to total', () => {
    fc.assert(
      fc.property(fc.array(arbTxn), (txns) => {
        const overall = summarize(txns);
        const months = [...netByMonth(txns).values()];
        expect(months.reduce((a, c) => a + c.net_minor, 0n)).toBe(overall.net_minor);
        expect(months.reduce((a, c) => a + c.outflow_minor, 0n)).toBe(overall.outflow_minor);
      })
    );
  });

  test('per-category-by-month sums to per-category overall', () => {
    fc.assert(
      fc.property(fc.array(arbTxn), (txns) => {
        const flat = spendingByCategory(txns);
        const nested = spendingByCategoryByMonth(txns);
        const recombined = new Map<string | null, bigint>();
        for (const inner of nested.values()) {
          for (const [cat, v] of inner) recombined.set(cat, (recombined.get(cat) ?? 0n) + v);
        }
        expect([...recombined.entries()].sort()).toEqual([...flat.entries()].sort());
      })
    );
  });
});
