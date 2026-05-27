import { describe, expect, test } from 'vitest';
import { daysInMonth, monthBudget } from '../../../src/lib/app/month-budget';

describe('daysInMonth', () => {
  test('handles 31/30/28/29-day months (leap aware)', () => {
    expect(daysInMonth('2026-05')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2025-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29); // leap
  });
});

describe('monthBudget', () => {
  test('mid-month: income/spent/remaining, days left, safe daily pace, percent', () => {
    const b = monthBudget(
      { inflow_minor: 3_000_000n, outflow_minor: 1_500_000n },
      '2026-05',
      '2026-05-15'
    );
    expect(b.income_minor).toBe(3_000_000n);
    expect(b.spent_minor).toBe(1_500_000n);
    expect(b.remaining_minor).toBe(1_500_000n);
    expect(b.pct_spent).toBe(50);
    expect(b.days_left).toBe(16); // 31 - 15
    expect(b.daily_pace_minor).toBe(1_500_000n / 17n); // remaining / (days_left + 1)
    expect(b.over_pace).toBe(true); // 50% spent by day 15 of 31 is ahead of even pace
  });

  test('under pace late in month is not over_pace', () => {
    const b = monthBudget(
      { inflow_minor: 5_000_000n, outflow_minor: 1_152_800n },
      '2026-05',
      '2026-05-27'
    );
    expect(b.remaining_minor).toBe(3_847_200n);
    expect(b.days_left).toBe(4);
    expect(b.daily_pace_minor).toBe(3_847_200n / 5n);
    expect(b.pct_spent).toBe(23);
    expect(b.over_pace).toBe(false);
  });

  test('last day of month: days_left 0, pace divides by 1 (= remaining)', () => {
    const b = monthBudget(
      { inflow_minor: 1_000_000n, outflow_minor: 400_000n },
      '2026-05',
      '2026-05-31'
    );
    expect(b.days_left).toBe(0);
    expect(b.daily_pace_minor).toBe(600_000n);
  });

  test('no income: percent 0, pace 0, remaining is negative spent', () => {
    const b = monthBudget({ inflow_minor: 0n, outflow_minor: 250_000n }, '2026-05', '2026-05-10');
    expect(b.income_minor).toBe(0n);
    expect(b.pct_spent).toBe(0);
    expect(b.daily_pace_minor).toBe(0n);
    expect(b.remaining_minor).toBe(-250_000n);
    expect(b.over_pace).toBe(false);
  });

  test('overspent (remaining negative) yields zero safe pace', () => {
    const b = monthBudget(
      { inflow_minor: 1_000_000n, outflow_minor: 1_400_000n },
      '2026-05',
      '2026-05-10'
    );
    expect(b.remaining_minor).toBe(-400_000n);
    expect(b.daily_pace_minor).toBe(0n);
    expect(b.over_pace).toBe(true);
  });

  test('undefined flow = empty month', () => {
    const b = monthBudget(undefined, '2026-05', '2026-05-10');
    expect(b.income_minor).toBe(0n);
    expect(b.spent_minor).toBe(0n);
    expect(b.remaining_minor).toBe(0n);
    expect(b.daily_pace_minor).toBe(0n);
  });

  test('a past month counts as fully elapsed (0 days left)', () => {
    const b = monthBudget(
      { inflow_minor: 1_000_000n, outflow_minor: 300_000n },
      '2026-04',
      '2026-05-10'
    );
    expect(b.days_left).toBe(0);
    expect(b.daily_pace_minor).toBe(700_000n); // remaining / 1
  });
});
