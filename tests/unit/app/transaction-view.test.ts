// Tests for the unified-transactions service.
//
// Coverage targets: toUnifiedRows ordering, listAccounts dedup, applyFilter
// across every dimension AND combinations, sortRows on every key in both
// directions.  Each filter dimension has at least one positive and one
// negative case.

import { describe, test, expect } from 'vitest';
import {
  toUnifiedRows,
  listAccounts,
  accountKeyString,
  applyFilter,
  sortRows
} from '../../../src/lib/app/transaction-view';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type {
  AccountType,
  ParsedTransaction,
  ParsedStatement
} from '../../../src/lib/adapters/types';

function mkTxn(
  posted_date: string,
  amount: number,
  type: ParsedTransaction['transaction_type'],
  description: string
): ParsedTransaction {
  return {
    posted_date,
    description,
    raw_text: description,
    amount_minor: BigInt(Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: type
  };
}

function mkImport(
  bank_name: string,
  account_type: AccountType,
  account_last_4: string | null,
  txns: ParsedTransaction[],
  pdf_source_hash = `hash-${bank_name}-${account_last_4}`
): ImportSuccess {
  const statement: ParsedStatement = {
    account_type,
    account_last_4,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor: null,
    statement_balance_minor: null,
    printed_transaction_count: null,
    summary_lines: [],
    payment_due_date: null,
    statement_date: '2026-01-31',
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name,
    pdf_source_hash,
    statement,
    transactions: txns,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

// Reusable fixture: 3 imports across 2 accounts.
function fixture(): ImportSuccess[] {
  return [
    mkImport('Chase', 'checking', '9535', [
      mkTxn('2026-01-15', -50.0, 'purchase', 'WHOLE FOODS AUSTIN TX'),
      mkTxn('2026-01-20', -25.0, 'purchase', 'STARBUCKS - DOWNTOWN'),
      mkTxn('2026-01-28', 3200.0, 'deposit', 'PAYROLL - ACME CORP')
    ]),
    mkImport('Chase', 'credit_card', '1797', [
      mkTxn('2026-01-10', -100.0, 'purchase', 'AMAZON MARKETPLACE'),
      mkTxn('2026-01-25', 100.0, 'payment_to_card', 'AUTOPAY - THANK YOU')
    ]),
    mkImport('Discover', 'credit_card', '3562', [
      mkTxn('2026-01-12', -3.99, 'purchase', 'GOOGLE *YOUTUBE')
    ])
  ];
}

// ── toUnifiedRows ────────────────────────────────────────────────────────────

describe('toUnifiedRows', () => {
  test('flattens all imports into a single row list with provenance fields', () => {
    const rows = toUnifiedRows(fixture());
    expect(rows.length).toBe(6);
    // Spot-check one row — it carries bank_name, account_last_4, hash, etc.
    const amazon = rows.find((r) => r.description.includes('AMAZON'))!;
    expect(amazon.bank_name).toBe('Chase');
    expect(amazon.account_type).toBe('credit_card');
    expect(amazon.account_last_4).toBe('1797');
    expect(amazon.amount_minor).toBe(-10000n);
    expect(amazon.pdf_source_hash).toMatch(/Chase-1797/);
  });

  test('rows are sorted chronologically (earliest first)', () => {
    const rows = toUnifiedRows(fixture());
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.posted_date >= rows[i - 1]!.posted_date).toBe(true);
    }
  });

  test('same-date rows preserve a deterministic order across runs', () => {
    const imports = fixture();
    const a = toUnifiedRows(imports);
    const b = toUnifiedRows(imports);
    // Same input → same output (deterministic).
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.description).toBe(b[i]!.description);
    }
  });

  test('empty imports produces empty rows', () => {
    expect(toUnifiedRows([])).toEqual([]);
  });
});

// ── listAccounts ─────────────────────────────────────────────────────────────

describe('listAccounts', () => {
  test('enumerates each distinct (bank, type, last_4) exactly once', () => {
    const rows = toUnifiedRows(fixture());
    const accounts = listAccounts(rows);
    expect(accounts.length).toBe(3);
    expect(accounts.map(accountKeyString).sort()).toEqual(
      ['Chase::checking::9535', 'Chase::credit_card::1797', 'Discover::credit_card::3562'].sort()
    );
  });

  test('does NOT double-count the same account across multiple statements', () => {
    // Add another Chase 1797 import (the user has Apr + May statements for the same card).
    const imports = [
      ...fixture(),
      mkImport('Chase', 'credit_card', '1797', [mkTxn('2026-02-10', -50.0, 'purchase', 'p')], 'h2')
    ];
    const rows = toUnifiedRows(imports);
    expect(listAccounts(rows).length).toBe(3); // still 3 distinct accounts
  });

  test('sorts accounts alphabetically by bank, then type, then last_4', () => {
    const rows = toUnifiedRows(fixture());
    const accounts = listAccounts(rows);
    // Chase comes before Discover; within Chase, checking before credit_card
    expect(accounts[0]!.bank_name).toBe('Chase');
    expect(accounts[0]!.account_type).toBe('checking');
    expect(accounts[1]!.bank_name).toBe('Chase');
    expect(accounts[1]!.account_type).toBe('credit_card');
    expect(accounts[2]!.bank_name).toBe('Discover');
  });
});

// ── applyFilter — each dimension ─────────────────────────────────────────────

describe('applyFilter — single-dimension cases', () => {
  test('no filter returns every row', () => {
    const rows = toUnifiedRows(fixture());
    expect(applyFilter(rows, {}).length).toBe(rows.length);
  });

  test('account_keys filter narrows to selected accounts only', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, { account_keys: ['Chase::checking::9535'] });
    expect(filtered.length).toBe(3);
    expect(filtered.every((r) => r.bank_name === 'Chase' && r.account_type === 'checking')).toBe(
      true
    );
  });

  test('date_from filter is inclusive', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, { date_from: '2026-01-20' });
    expect(filtered.every((r) => r.posted_date >= '2026-01-20')).toBe(true);
    expect(filtered.length).toBe(3); // Jan 20, 25, 28
  });

  test('date_to filter is inclusive', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, { date_to: '2026-01-15' });
    expect(filtered.every((r) => r.posted_date <= '2026-01-15')).toBe(true);
    expect(filtered.length).toBe(3); // Jan 10, 12, 15
  });

  test('amount_min is on ABSOLUTE amount (so it catches negatives too)', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, { amount_min: 50 });
    // Keeps |amount| >= $50: -$50 grocery, -$100 amazon, +$100 payment, +$3200 payroll
    expect(filtered.length).toBe(4);
  });

  test('amount_max is on ABSOLUTE amount', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, { amount_max: 30 });
    // Keeps |amount| <= $30: -$25 starbucks, -$3.99 youtube
    expect(filtered.length).toBe(2);
  });

  test('search matches case-insensitive substring', () => {
    const rows = toUnifiedRows(fixture());
    expect(applyFilter(rows, { search: 'starbucks' }).length).toBe(1);
    expect(applyFilter(rows, { search: 'STARBUCKS' }).length).toBe(1);
    expect(applyFilter(rows, { search: 'star' }).length).toBe(1);
  });

  test('multi-token search is AND, not OR', () => {
    const rows = toUnifiedRows(fixture());
    // "whole foods" should match "WHOLE FOODS AUSTIN TX" (both tokens present)
    expect(applyFilter(rows, { search: 'whole foods' }).length).toBe(1);
    // "whole amazon" should match NOTHING (no row has BOTH "whole" and "amazon")
    expect(applyFilter(rows, { search: 'whole amazon' }).length).toBe(0);
  });

  test('types filter accepts a subset of TransactionType', () => {
    const rows = toUnifiedRows(fixture());
    expect(applyFilter(rows, { types: ['payment_to_card'] }).length).toBe(1);
    expect(applyFilter(rows, { types: ['deposit', 'purchase'] }).length).toBe(5);
  });

  test('empty arrays / empty strings / undefined all mean "no constraint"', () => {
    const rows = toUnifiedRows(fixture());
    expect(applyFilter(rows, { account_keys: [] }).length).toBe(rows.length);
    expect(applyFilter(rows, { search: '' }).length).toBe(rows.length);
    expect(applyFilter(rows, { search: '   ' }).length).toBe(rows.length);
    expect(applyFilter(rows, { types: [] }).length).toBe(rows.length);
  });
});

// ── applyFilter — composed (AND) ─────────────────────────────────────────────

describe('applyFilter — composed AND across dimensions', () => {
  test('account + date + search must ALL match', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, {
      account_keys: ['Chase::checking::9535'],
      date_from: '2026-01-14',
      date_to: '2026-01-25',
      search: 'whole'
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.description).toContain('WHOLE');
  });

  test('over-constrained filter returns empty', () => {
    const rows = toUnifiedRows(fixture());
    const filtered = applyFilter(rows, {
      account_keys: ['Discover::credit_card::3562'],
      search: 'STARBUCKS' // not on Discover
    });
    expect(filtered.length).toBe(0);
  });
});

// ── sortRows ─────────────────────────────────────────────────────────────────

describe('sortRows', () => {
  test('sort by date ascending vs descending', () => {
    const rows = toUnifiedRows(fixture());
    const asc = sortRows(rows, { key: 'date', dir: 'asc' });
    const desc = sortRows(rows, { key: 'date', dir: 'desc' });
    expect(asc[0]!.posted_date).toBe('2026-01-10');
    expect(desc[0]!.posted_date).toBe('2026-01-28');
  });

  test('sort by amount (signed) — desc puts largest credit at top', () => {
    const rows = toUnifiedRows(fixture());
    const desc = sortRows(rows, { key: 'amount', dir: 'desc' });
    expect(desc[0]!.amount_minor).toBe(320000n); // +$3200 payroll
    expect(desc[desc.length - 1]!.amount_minor).toBe(-10000n); // -$100 amazon
  });

  test('sort by description is case-insensitive alphabetical', () => {
    const rows = toUnifiedRows(fixture());
    const asc = sortRows(rows, { key: 'description', dir: 'asc' });
    expect(asc[0]!.description).toBe('AMAZON MARKETPLACE');
  });

  test('sortRows does NOT mutate input', () => {
    const rows = toUnifiedRows(fixture());
    const before = rows.map((r) => r.description);
    sortRows(rows, { key: 'amount', dir: 'desc' });
    const after = rows.map((r) => r.description);
    expect(before).toEqual(after);
  });
});
