/**
 * spendDetailRowsFromImports — the row source for the dashboard's category
 * drill-down panel. The critical money-truth property: aggregating these rows by
 * category EXACTLY equals spendingByCategory(summaryByFlowIntent(...).spend), so
 * the category total a row shows and the transactions it reveals can never
 * silently drift apart. Plus: movement (CC payments / transfers / investments)
 * and ignored rows are excluded (they are not in the total either), and splits
 * are expanded per part with unique keys.
 *
 * Regression guard for the 2026-06-01 review finding: the panel previously read
 * raw `detailedRowsFromImports`, so opening "Uncategorized" listed ~$8.4k of CC
 * payments/transfers that were never in the displayed total.
 */
import { describe, expect, test } from 'vitest';
import {
  spendDetailRowsFromImports,
  summaryByFlowIntent,
  flowIntentRowsFromImports
} from '../../../src/lib/app/categorization-glue';
import { inferAllFlowIntents } from '../../../src/lib/app/flow-intent';
import { spendingByCategory } from '../../../src/lib/app/spending-summary';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { ParsedTransaction } from '../../../src/lib/adapters/types';
import type { TransactionAnnotation } from '../../../src/lib/app/categorization';

function txn(
  date: string,
  desc: string,
  cents: bigint,
  kind:
    | 'purchase'
    | 'refund'
    | 'deposit'
    | 'payment_to_card'
    | 'transfer'
    | 'withdrawal' = 'purchase'
): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: cents,
    currency: 'USD',
    transaction_type: kind
  };
}

const imp: ImportRecord = {
  bank_name: 'Chase',
  adapter_name: 'layout-chase-checking',
  adapter_version: '0.2.0',
  pdf_source_hash: 'h',
  imported_at: '2026-05-28T00:00:00Z',
  statement: {
    account_type: 'checking',
    account_last_4: '9535',
    period_start: '2026-05-01',
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
    txn('2026-05-08', 'Altera Corporati Payroll', 3000_00n, 'deposit'), // #0 income (salary)
    txn('2026-05-10', 'Robinhood Card Payment', -1000_00n, 'payment_to_card'), // #1 movement (cc_payment)
    txn(
      '2026-05-12',
      '05/10 Online Realtime Payment To Robinhood Securities',
      -5000_00n,
      'transfer'
    ), // #2 movement
    txn('2026-05-20', 'COSTCO WHSE #1385 GEORGETOWN TX', -100_00n, 'withdrawal'), // #3 spend → groceries
    txn('2026-05-25', 'CARD PURCHASE RETURN COSTCO', 25_00n, 'refund'), // #4 refund (positive) → groceries
    txn('2026-05-21', 'OLD NAVY', -50_00n, 'withdrawal'), // #5 spend → clothes, but IGNORED
    txn('2026-05-22', 'TARGET', -100_00n, 'withdrawal') // #6 split: 60 groceries / 40 dining
  ]
};

const annotations: Record<string, TransactionAnnotation> = {
  'h#3': { category_id: 'groceries', source: 'manual' },
  'h#4': { category_id: 'groceries', source: 'manual', refund_of: 'h#3' },
  'h#5': { category_id: 'clothes', source: 'manual', ignored: true },
  'h#6': {
    category_id: 'groceries',
    source: 'manual',
    split: [
      { category_id: 'groceries', amount_minor: -60_00n },
      { category_id: 'dining', amount_minor: -40_00n }
    ]
  }
};

const flowIntents = inferAllFlowIntents(flowIntentRowsFromImports([imp], annotations));
const spendDetail = spendDetailRowsFromImports([imp], annotations, flowIntents);

describe('spendDetailRowsFromImports — reconciles with the category totals', () => {
  test('INVARIANT: by-category aggregation equals spendingByCategory(spend projection)', () => {
    // This is the load-bearing property — it holds by construction for ANY input,
    // because both functions apply the same flow-intent routing to the same rows.
    const fromDetail = spendingByCategory(spendDetail);
    const fromSpend = spendingByCategory(
      summaryByFlowIntent([imp], annotations, flowIntents).spend
    );
    expect(fromDetail).toEqual(fromSpend);
  });

  test('category totals are the expected outflow magnitudes', () => {
    const byCat = spendingByCategory(spendDetail);
    expect(byCat.get('groceries')).toBe(160_00n); // 100 (Costco) + 60 (Target split part)
    expect(byCat.get('dining')).toBe(40_00n); // 40 (Target split part)
    expect(byCat.get('clothes')).toBeUndefined(); // ignored → never counted
  });

  test('the panel rows for a category SUM to that category total', () => {
    const byCat = spendingByCategory(spendDetail);
    for (const catId of ['groceries', 'dining']) {
      const listed = spendDetail
        .filter((r) => r.amount_minor < 0n && r.category_id === catId)
        .reduce((s, r) => s + -r.amount_minor, 0n);
      expect(listed).toBe(byCat.get(catId));
    }
  });
});

describe('spendDetailRowsFromImports — exclusions & shape', () => {
  test('movement (CC payment / investment transfer) is excluded', () => {
    expect(spendDetail.find((r) => r.key === 'h#1')).toBeUndefined();
    expect(spendDetail.find((r) => r.key === 'h#2')).toBeUndefined();
    expect(spendDetail.some((r) => r.description.includes('Robinhood'))).toBe(false);
  });

  test('ignored transactions are excluded', () => {
    expect(spendDetail.find((r) => r.key === 'h#5')).toBeUndefined();
  });

  test('income deposits are excluded (spend bucket only)', () => {
    expect(spendDetail.find((r) => r.key === 'h#0')).toBeUndefined();
  });

  test('split parts are expanded with unique keys and their own category', () => {
    const parts = spendDetail.filter((r) => r.key.startsWith('h#6'));
    expect(parts.map((r) => r.key).sort()).toEqual(['h#6#0', 'h#6#1']);
    expect(parts.find((r) => r.category_id === 'groceries')!.amount_minor).toBe(-60_00n);
    expect(parts.find((r) => r.category_id === 'dining')!.amount_minor).toBe(-40_00n);
  });

  test('every row key is unique (safe for a keyed {#each})', () => {
    const keys = spendDetail.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('display fields are carried (description + bank_name) and ignored is false', () => {
    const groc = spendDetail.find((r) => r.key === 'h#3')!;
    expect(groc.bank_name).toBe('Chase');
    expect(typeof groc.description).toBe('string');
    expect(groc.ignored).toBe(false);
  });
});
