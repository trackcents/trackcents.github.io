/**
 * Paycheck → budget-month attribution (spec 002-income-pockets §6, §7.11).
 * The grid-anchored mapping that lets a late-month paycheck fund the NEXT month.
 */
import { describe, expect, test } from 'vitest';
import {
  detectedPaychecksNewestFirst,
  paycheckBudgetMonths,
  smartDefaultAnchor
} from '../../../src/lib/app/paycheck-budget';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { ParsedTransaction } from '../../../src/lib/adapters/types';

function dep(date: string, cents: bigint): ParsedTransaction {
  return {
    posted_date: date,
    description: 'Altera Corporati Payroll PPD ID: 9111111101',
    raw_text: 'Altera Corporati Payroll',
    amount_minor: cents,
    currency: 'USD',
    transaction_type: 'deposit'
  };
}

/** A checking statement whose deposits land every 14 days (a paycheck cadence). */
const checking: ImportRecord = {
  bank_name: 'Chase',
  adapter_name: 'layout-chase-checking',
  adapter_version: '0.2.0',
  pdf_source_hash: 'chk',
  imported_at: '2026-05-28T00:00:00Z',
  statement: {
    account_type: 'checking',
    account_last_4: '9535',
    period_start: '2026-04-01',
    period_end: '2026-05-31',
    currency: 'USD',
    opening_balance_minor: 0n,
    closing_balance_minor: 0n,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: null,
    summary_lines: [],
    payment_due_date: null,
    statement_date: null,
    minimum_payment_due_minor: null,
    parser_provides: ['A']
  },
  checksum_strategy_used: 'A',
  transactions: [
    dep('2026-04-10', 3225_12n), // #0
    dep('2026-04-24', 3225_13n), // #1
    dep('2026-05-08', 3797_04n), // #2
    dep('2026-05-22', 3465_99n) // #3
  ]
};

describe('detectedPaychecksNewestFirst', () => {
  test('finds the 4 biweekly deposits, newest first', () => {
    const pcs = detectedPaychecksNewestFirst([checking]);
    expect(pcs.map((p) => p.posted_date)).toEqual([
      '2026-05-22',
      '2026-05-08',
      '2026-04-24',
      '2026-04-10'
    ]);
  });
});

describe('smartDefaultAnchor — last-third paycheck funds next month', () => {
  test('day ≥ 21 → next calendar month (Apr 24 → May)', () => {
    expect(smartDefaultAnchor(detectedPaychecksNewestFirst([checking])[2])).toEqual({
      year: 2026,
      month: 5
    }); // index 2 = Apr 24
  });
  test('day < 21 → same month (Apr 10 → April)', () => {
    expect(smartDefaultAnchor(detectedPaychecksNewestFirst([checking])[3])).toEqual({
      year: 2026,
      month: 4
    }); // index 3 = Apr 10
  });
  test('December day ≥ 21 wraps to next January', () => {
    const dec: ImportRecord = {
      ...checking,
      pdf_source_hash: 'dec',
      transactions: [dep('2026-12-24', 100_00n), dep('2027-01-07', 100_00n)]
    };
    expect(smartDefaultAnchor(detectedPaychecksNewestFirst([dec])[1])).toEqual({
      year: 2027,
      month: 1
    }); // first = Dec 24
  });
  test('undefined → null', () => {
    expect(smartDefaultAnchor(undefined)).toBeNull();
  });
});

describe('paycheckBudgetMonths — maps each paycheck to its budget month', () => {
  test('anchor April → {Apr10,Apr24}=Apr, {May8,May22}=May', () => {
    const map = paycheckBudgetMonths([checking], { year: 2026, month: 4 });
    expect(map.get('chk#0')).toBe('2026-04');
    expect(map.get('chk#1')).toBe('2026-04');
    expect(map.get('chk#2')).toBe('2026-05');
    expect(map.get('chk#3')).toBe('2026-05');
  });

  test('anchor May → the same pairs shift forward one month', () => {
    const map = paycheckBudgetMonths([checking], { year: 2026, month: 5 });
    expect(map.get('chk#0')).toBe('2026-05'); // {Apr10,Apr24} now fund May
    expect(map.get('chk#1')).toBe('2026-05');
    expect(map.get('chk#2')).toBe('2026-06'); // {May8,May22} fund June
    expect(map.get('chk#3')).toBe('2026-06');
  });

  test('no anchor → empty map (calendar months unchanged)', () => {
    expect(paycheckBudgetMonths([checking], null).size).toBe(0);
  });
});
