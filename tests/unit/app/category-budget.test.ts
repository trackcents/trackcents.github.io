import { describe, test, expect } from 'vitest';
import {
  netSpendingByCategory,
  computeCategoryBudgets,
  budgetTotals
} from '../../../src/lib/app/category-budget';
import type { SummaryTransaction } from '../../../src/lib/app/spending-summary';

const tx = (amount_minor: bigint, category_id: string | null): SummaryTransaction => ({
  posted_date: '2026-05-10',
  amount_minor,
  category_id
});

describe('netSpendingByCategory', () => {
  test('sums outflows as positive spending per category', () => {
    const m = netSpendingByCategory([tx(-5000n, 'food'), tx(-2000n, 'food'), tx(-1000n, 'gas')]);
    expect(m.get('food')).toBe(7000n);
    expect(m.get('gas')).toBe(1000n);
  });

  test('nets a refund (relabeled to the original category) against spending', () => {
    // purchase -5000 + refund +2000 both in 'shopping' → net spend 3000
    const m = netSpendingByCategory([tx(-5000n, 'shopping'), tx(2000n, 'shopping')]);
    expect(m.get('shopping')).toBe(3000n);
  });

  test('a category with net inflow clamps to 0 spending (never negative)', () => {
    const m = netSpendingByCategory([tx(-1000n, 'misc'), tx(3000n, 'misc')]);
    expect(m.get('misc')).toBe(0n);
  });
});

describe('computeCategoryBudgets', () => {
  const txns = [tx(-9000n, 'food'), tx(-1000n, 'gas'), tx(-3000n, 'fun')];

  test('computes spent / remaining / pct / over per limited category', () => {
    const rows = computeCategoryBudgets({ food: 8000n, gas: 5000n, fun: 3000n }, txns);
    const food = rows.find((r) => r.category_id === 'food')!;
    expect(food.spent_minor).toBe(9000n);
    expect(food.remaining_minor).toBe(-1000n);
    expect(food.over).toBe(true);
    expect(food.pct).toBeCloseTo(112.5, 5);
    const gas = rows.find((r) => r.category_id === 'gas')!;
    expect(gas.over).toBe(false);
    expect(gas.remaining_minor).toBe(4000n);
    const fun = rows.find((r) => r.category_id === 'fun')!;
    expect(fun.over).toBe(false); // exactly at limit is NOT over
    expect(fun.remaining_minor).toBe(0n);
  });

  test('ignores non-positive limits and categories without a limit', () => {
    const rows = computeCategoryBudgets({ food: 0n, gas: -100n, fun: 3000n }, txns);
    expect(rows.map((r) => r.category_id)).toEqual(['fun']);
  });

  test('a limited category with no spending shows spent 0, not over', () => {
    const rows = computeCategoryBudgets({ travel: 5000n }, txns);
    expect(rows[0]!.spent_minor).toBe(0n);
    expect(rows[0]!.over).toBe(false);
  });

  test('sorted most-over (highest pct) first', () => {
    const rows = computeCategoryBudgets({ food: 8000n, gas: 5000n }, txns);
    expect(rows[0]!.category_id).toBe('food'); // 112.5% before gas 20%
  });
});

describe('budgetTotals', () => {
  test('sums limits and spend', () => {
    const rows = computeCategoryBudgets({ food: 8000n, gas: 5000n }, [
      tx(-9000n, 'food'),
      tx(-1000n, 'gas')
    ]);
    const t = budgetTotals(rows);
    expect(t.limit_minor).toBe(13000n);
    expect(t.spent_minor).toBe(10000n);
    expect(t.remaining_minor).toBe(3000n);
  });
});
