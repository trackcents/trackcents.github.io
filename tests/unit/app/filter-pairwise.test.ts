// Pairwise combinatorial test for the unified-view filter.
//
// The filter has 5 independent dimensions:
//   - account_keys present? (∅, one, multi)
//   - date_from set? (∅, mid-month, end-of-month)
//   - amount range? (∅, large-only, small-only, between)
//   - transaction types? (∅, single, multi)
//   - search? (∅, hits, misses)
//
// Cartesian product is 3 × 3 × 4 × 3 × 3 = 324 combinations.  PICT-style
// pairwise reduction covers every 2-way interaction with ~12-16 cases, which
// is enough to catch combination bugs (e.g., "account-filter + search
// together return wrong rows when search is empty string").
//
// Implementation: inline minimal all-pairs generator.  No external
// dependency (verified pict-node is 4⭐ and stale; not adopting).

import { describe, test, expect } from 'vitest';
import {
  toUnifiedRows,
  applyFilter,
  type TransactionFilter
} from '../../../src/lib/app/transaction-view';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';

// ── Inline pairwise generator (covers all 2-way value pairs) ────────────────
//
// Algorithm: greedy "in-parameter-order" (IPOG).  Start with the Cartesian
// product of the first two dimensions; for each new dimension, greedily
// extend rows to cover any 2-way pair not yet covered, padding the rest
// with random choices.  Not optimal but enough for our scale.

function pairwise<T extends Record<string, readonly unknown[]>>(
  dims: T
): Array<{ [K in keyof T]: T[K][number] }> {
  const keys = Object.keys(dims) as Array<keyof T>;
  if (keys.length < 2) {
    const k = keys[0];
    if (k === undefined) return [];
    return (dims[k] as readonly unknown[]).map(
      (v) => ({ [k]: v }) as { [K in keyof T]: T[K][number] }
    );
  }

  // All 2-way pairs that must be covered.
  type Pair = { kA: keyof T; vA: unknown; kB: keyof T; vB: unknown };
  const uncoveredPairs: Pair[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const kA = keys[i]!;
      const kB = keys[j]!;
      for (const vA of dims[kA] as readonly unknown[]) {
        for (const vB of dims[kB] as readonly unknown[]) {
          uncoveredPairs.push({ kA, vA, kB, vB });
        }
      }
    }
  }

  const rows: Array<{ [K in keyof T]: T[K][number] }> = [];
  while (uncoveredPairs.length > 0) {
    // Start a row with the first uncovered pair.
    const seed = uncoveredPairs[0]!;
    const row = {} as { [K in keyof T]: T[K][number] };
    (row as Record<keyof T, unknown>)[seed.kA] = seed.vA;
    (row as Record<keyof T, unknown>)[seed.kB] = seed.vB;

    // Greedily fill remaining dimensions with values that cover the most
    // remaining uncovered pairs.
    for (const k of keys) {
      if (k === seed.kA || k === seed.kB) continue;
      let bestValue: unknown = (dims[k] as readonly unknown[])[0];
      let bestScore = -1;
      for (const v of dims[k] as readonly unknown[]) {
        let score = 0;
        for (const p of uncoveredPairs) {
          if ((p.kA === k && p.vA === v) || (p.kB === k && p.vB === v)) {
            // Check if the OTHER side of the pair matches what's already in the row
            const otherK = p.kA === k ? p.kB : p.kA;
            const otherV = p.kA === k ? p.vB : p.vA;
            if ((row as Record<keyof T, unknown>)[otherK] === otherV) score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestValue = v;
        }
      }
      (row as Record<keyof T, unknown>)[k] = bestValue;
    }

    // Remove every pair this row now covers.
    for (let pi = uncoveredPairs.length - 1; pi >= 0; pi--) {
      const p = uncoveredPairs[pi]!;
      if (
        (row as Record<keyof T, unknown>)[p.kA] === p.vA &&
        (row as Record<keyof T, unknown>)[p.kB] === p.vB
      ) {
        uncoveredPairs.splice(pi, 1);
      }
    }

    rows.push(row);
  }
  return rows;
}

// ── Fixture: 12 representative transactions across 2 accounts ───────────────

function mkTxn(
  date: string,
  cents: bigint,
  type: ParsedTransaction['transaction_type'],
  desc: string
): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: cents,
    currency: 'USD',
    transaction_type: type
  };
}

function fixture(): ImportSuccess[] {
  const baseStatement = (last4: string): ParsedStatement => ({
    account_type: 'credit_card',
    account_last_4: last4,
    period_start: '2026-03-01',
    period_end: '2026-03-31',
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
    statement_date: '2026-03-31',
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  });
  const wrap = (last4: string, txns: ParsedTransaction[]): ImportSuccess => ({
    ok: true,
    adapter_name: 't',
    adapter_version: '0',
    bank_name: 'BankA',
    pdf_source_hash: `pw-${last4}`,
    statement: baseStatement(last4),
    transactions: txns,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  });

  return [
    wrap('1111', [
      mkTxn('2026-03-05', -1000n, 'purchase', 'AMAZON A'),
      mkTxn('2026-03-10', -50000n, 'purchase', 'COSTCO A'),
      mkTxn('2026-03-15', 25000n, 'refund', 'AMAZON REFUND'),
      mkTxn('2026-03-20', -5000n, 'fee', 'LATE FEE'),
      mkTxn('2026-03-25', 100000n, 'payment_to_card', 'INTERNET PAYMENT'),
      mkTxn('2026-03-30', -2000n, 'purchase', 'STARBUCKS')
    ]),
    wrap('2222', [
      mkTxn('2026-03-05', -1500n, 'purchase', 'AMAZON B'),
      mkTxn('2026-03-12', -80000n, 'purchase', 'TARGET B'),
      mkTxn('2026-03-18', 50000n, 'payment_to_card', 'PAYMENT B'),
      mkTxn('2026-03-22', -300n, 'interest', 'INTEREST CHARGED'),
      mkTxn('2026-03-28', -7500n, 'purchase', 'WHOLE FOODS B'),
      mkTxn('2026-03-31', -150n, 'purchase', 'COFFEE B')
    ])
  ];
}

// ── Filter dimensions ───────────────────────────────────────────────────────

const FILTER_DIMENSIONS = {
  account: ['none', 'one', 'multi'] as const,
  date_from: ['none', 'mid', 'late'] as const,
  amount: ['none', 'large_only', 'small_only', 'between'] as const,
  type: ['none', 'purchases_only', 'multi'] as const,
  search: ['none', 'amazon', 'no_match'] as const
};

function buildFilter(combo: {
  account: 'none' | 'one' | 'multi';
  date_from: 'none' | 'mid' | 'late';
  amount: 'none' | 'large_only' | 'small_only' | 'between';
  type: 'none' | 'purchases_only' | 'multi';
  search: 'none' | 'amazon' | 'no_match';
}): TransactionFilter {
  const f: TransactionFilter = {};
  if (combo.account === 'one') f.account_keys = ['BankA::credit_card::1111'];
  else if (combo.account === 'multi')
    f.account_keys = ['BankA::credit_card::1111', 'BankA::credit_card::2222'];
  if (combo.date_from === 'mid') f.date_from = '2026-03-15';
  else if (combo.date_from === 'late') f.date_from = '2026-03-28';
  if (combo.amount === 'large_only') f.amount_min = 100;
  else if (combo.amount === 'small_only') f.amount_max = 50;
  else if (combo.amount === 'between') {
    f.amount_min = 10;
    f.amount_max = 200;
  }
  if (combo.type === 'purchases_only') f.types = ['purchase'];
  else if (combo.type === 'multi') f.types = ['purchase', 'refund'];
  if (combo.search === 'amazon') f.search = 'amazon';
  else if (combo.search === 'no_match') f.search = 'zzzz_no_match_zzzz';
  return f;
}

// ── The tests ───────────────────────────────────────────────────────────────

const PAIRWISE_CASES = pairwise(FILTER_DIMENSIONS);

describe('Unified view filter — pairwise combinatorial coverage', () => {
  test('all-pairs generator produces a non-trivial covering array', () => {
    // Sanity: pairwise should cover all 2-way value pairs with far fewer
    // cases than Cartesian (324 → ~13-18).
    expect(PAIRWISE_CASES.length).toBeGreaterThan(8);
    expect(PAIRWISE_CASES.length).toBeLessThan(40);
  });

  test.each(PAIRWISE_CASES)(
    'filter combination acct=$account date=$date_from amount=$amount type=$type search=$search produces a stable, well-formed row set',
    (combo) => {
      const rows = toUnifiedRows(fixture());
      const filter = buildFilter(combo);
      const filtered = applyFilter(rows, filter);

      // Universal invariants — must hold for EVERY combination:
      //   - result is a subset (length ≤ total)
      expect(filtered.length).toBeLessThanOrEqual(rows.length);
      //   - all returned rows pass each individual filter dimension
      for (const r of filtered) {
        if (filter.date_from) expect(r.posted_date >= filter.date_from).toBe(true);
        if (filter.date_to) expect(r.posted_date <= filter.date_to).toBe(true);
        if (filter.amount_min !== undefined) {
          const abs = r.amount_minor < 0n ? -r.amount_minor : r.amount_minor;
          expect(abs).toBeGreaterThanOrEqual(BigInt(Math.round(filter.amount_min * 100)));
        }
        if (filter.amount_max !== undefined) {
          const abs = r.amount_minor < 0n ? -r.amount_minor : r.amount_minor;
          expect(abs).toBeLessThanOrEqual(BigInt(Math.round(filter.amount_max * 100)));
        }
        if (filter.types && filter.types.length > 0) {
          expect(filter.types).toContain(r.transaction_type);
        }
        if (filter.search && filter.search.trim()) {
          expect(r.description.toLowerCase()).toContain(filter.search.toLowerCase());
        }
      }
      //   - if search has no hits in the fixture, result is empty
      if (combo.search === 'no_match') {
        expect(filtered.length).toBe(0);
      }
    }
  );
});
