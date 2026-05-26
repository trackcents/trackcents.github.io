import { describe, test, expect } from 'vitest';
import { computeBudgetSummaries, type BankTxn } from '../../../src/lib/app/budget-summary';
import type { BudgetWindow } from '../../../src/lib/app/budget-window';
import type { Paycheck } from '../../../src/lib/app/paycheck-detector';

const pay = (posted_date: string, amount_minor: bigint): Paycheck =>
  ({ posted_date, amount_minor }) as unknown as Paycheck;

const win = (
  over: Partial<BudgetWindow> & Pick<BudgetWindow, 'start_date' | 'end_date'>
): BudgetWindow => ({
  index: 0,
  budget_month: '2026-06',
  paychecks: [],
  complete: true,
  ...over
});

describe('computeBudgetSummaries', () => {
  test('income = sum of paychecks; spending = bank outflows in range; remaining = income − spending', () => {
    const windows = [
      win({
        start_date: '2026-05-20',
        end_date: '2026-06-02',
        paychecks: [pay('2026-05-20', 200000n), pay('2026-05-27', 200000n)] // $4000 in
      })
    ];
    const bank: BankTxn[] = [
      { posted_date: '2026-05-21', amount_minor: -150000n }, // rent $1500 (out)
      { posted_date: '2026-05-25', amount_minor: -80000n }, // CC payment $800 (out)
      { posted_date: '2026-05-27', amount_minor: 200000n }, // a paycheck deposit (in — excluded)
      { posted_date: '2026-06-10', amount_minor: -50000n } // OUT of range (after end)
    ];
    const [s] = computeBudgetSummaries(windows, bank);
    expect(s?.income_minor).toBe(400000n);
    expect(s?.spending_minor).toBe(230000n); // 1500 + 800
    expect(s?.remaining_minor).toBe(170000n);
  });

  test('range is inclusive of start and end', () => {
    const windows = [win({ start_date: '2026-05-20', end_date: '2026-05-25', paychecks: [] })];
    const bank: BankTxn[] = [
      { posted_date: '2026-05-19', amount_minor: -100n }, // before → excluded
      { posted_date: '2026-05-20', amount_minor: -200n }, // on start → included
      { posted_date: '2026-05-25', amount_minor: -300n }, // on end → included
      { posted_date: '2026-05-26', amount_minor: -400n } // after → excluded
    ];
    expect(computeBudgetSummaries(windows, bank)[0]?.spending_minor).toBe(500n);
  });

  test('a final open-ended window (end_date null) includes everything from start onward', () => {
    const windows = [
      win({
        start_date: '2026-05-20',
        end_date: null,
        complete: false,
        paychecks: [pay('2026-05-20', 100000n)]
      })
    ];
    const bank: BankTxn[] = [
      { posted_date: '2026-05-19', amount_minor: -999n }, // before start → excluded
      { posted_date: '2026-09-01', amount_minor: -7000n } // far future → included
    ];
    const [s] = computeBudgetSummaries(windows, bank);
    expect(s?.spending_minor).toBe(7000n);
    expect(s?.remaining_minor).toBe(93000n);
  });

  test('remaining can be negative when overspent', () => {
    const windows = [
      win({
        start_date: '2026-05-20',
        end_date: '2026-06-02',
        paychecks: [pay('2026-05-20', 100000n)]
      })
    ];
    const bank: BankTxn[] = [{ posted_date: '2026-05-22', amount_minor: -130000n }];
    expect(computeBudgetSummaries(windows, bank)[0]?.remaining_minor).toBe(-30000n);
  });

  test('empty windows → empty summaries', () => {
    expect(
      computeBudgetSummaries([], [{ posted_date: '2026-05-20', amount_minor: -100n }])
    ).toEqual([]);
  });
});
