// Metamorphic relations across our core engines.
//
// Metamorphic testing complements property/example tests by asserting
// RELATIONSHIPS between multiple runs of the SAME engine with TRANSFORMED
// inputs.  The relationship serves as the oracle when an absolute oracle
// (the "right" answer) isn't available.
//
// References:
//   - https://en.wikipedia.org/wiki/Metamorphic_testing
//   - docs/cc-statement-anatomy.md
//
// Relations encoded here:
//
//   M1. FIFO scale invariance — multiplying every amount in a stream by k
//       must multiply every covered/uncovered amount in the attribution by k.
//
//   M2. Filter composition associativity — filter(rows, A) then filter(_, B)
//       MUST equal filter(rows, A merged with B).
//
//   M3. Filter idempotence — filter(filter(rows, F), F) == filter(rows, F).
//
//   M4. Sort independence — sort(filter(rows, F)) == filter(sort(rows), F).

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildCardStreams,
  cardKeyString,
  computeFifoAttributions,
  unpaidBalanceAfter
} from '../../../src/lib/app/transaction-stream';
import {
  toUnifiedRows,
  applyFilter,
  sortRows,
  type TransactionFilter
} from '../../../src/lib/app/transaction-view';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';

// ── Fixture helpers ─────────────────────────────────────────────────────────

function mkTxn(
  date: string,
  cents: bigint,
  type: ParsedTransaction['transaction_type']
): ParsedTransaction {
  return {
    posted_date: date,
    description: 'm',
    raw_text: 'm',
    amount_minor: cents,
    currency: 'USD',
    transaction_type: type
  };
}

function mkImport(txns: ParsedTransaction[], last4 = '0001'): ImportSuccess {
  const stmt: ParsedStatement = {
    account_type: 'credit_card',
    account_last_4: last4,
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor: null,
    statement_balance_minor: null,
    printed_transaction_count: txns.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: '2026-12-31',
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };
  return {
    ok: true,
    adapter_name: 'meta',
    adapter_version: '0.0.0',
    bank_name: 'MetaBank',
    pdf_source_hash: `meta-${last4}`,
    statement: stmt,
    transactions: txns,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

// ── M1: FIFO scale invariance ───────────────────────────────────────────────

describe('Metamorphic M1: FIFO scale invariance', () => {
  test('multiplying every amount by k multiplies every attribution by k', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 2n, max: 100n }),
        fc.array(
          fc.tuple(
            fc.constantFrom('purchase', 'payment_to_card'),
            fc.bigInt({ min: 1n, max: 1000n })
          ),
          { minLength: 1, maxLength: 15 }
        ),
        (k, events) => {
          const txnsBase: ParsedTransaction[] = events.map(([type, amount], i) => {
            const day = String((i % 28) + 1).padStart(2, '0');
            const date = `2026-03-${day}`;
            if (type === 'purchase') return mkTxn(date, -amount, 'purchase');
            return mkTxn(date, amount, 'payment_to_card');
          });
          const txnsScaled = txnsBase.map((t) => ({
            ...t,
            amount_minor: t.amount_minor * k
          }));

          const baseStream = buildCardStreams([mkImport(txnsBase, '1111')]).get(
            cardKeyString({ bank_name: 'MetaBank', account_last_4: '1111' })
          )!;
          const scaledStream = buildCardStreams([mkImport(txnsScaled, '2222')]).get(
            cardKeyString({ bank_name: 'MetaBank', account_last_4: '2222' })
          )!;

          const baseAttrs = computeFifoAttributions(baseStream);
          const scaledAttrs = computeFifoAttributions(scaledStream);

          expect(scaledAttrs.length).toBe(baseAttrs.length);
          for (let i = 0; i < baseAttrs.length; i++) {
            const b = baseAttrs[i]!;
            const s = scaledAttrs[i]!;
            expect(s.uncovered_amount_minor).toBe(b.uncovered_amount_minor * k);
            expect(s.paid_for.length).toBe(b.paid_for.length);
            for (let j = 0; j < b.paid_for.length; j++) {
              expect(s.paid_for[j]!.covered_amount_minor).toBe(
                b.paid_for[j]!.covered_amount_minor * k
              );
            }
          }

          // Unpaid balance scales as well.
          expect(unpaidBalanceAfter(scaledStream)).toBe(unpaidBalanceAfter(baseStream) * k);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── M2: Filter composition associativity ────────────────────────────────────

describe('Metamorphic M2: filter(filter(rows, A), B) == filter(rows, A ∧ B)', () => {
  test('applying two filters sequentially equals applying them merged', () => {
    // Build a fixture that includes 2 accounts and a range of dates/amounts.
    const txns: ParsedTransaction[] = [
      mkTxn('2026-03-05', -10000n, 'purchase'),
      mkTxn('2026-03-10', -25000n, 'purchase'),
      mkTxn('2026-03-15', 50000n, 'payment_to_card'),
      mkTxn('2026-03-20', -5000n, 'fee'),
      mkTxn('2026-03-25', -75000n, 'purchase')
    ];
    const rows = toUnifiedRows([mkImport(txns)]);

    const A: TransactionFilter = { date_from: '2026-03-10' };
    const B: TransactionFilter = { amount_min: 100 };
    const merged: TransactionFilter = { date_from: '2026-03-10', amount_min: 100 };

    const sequential = applyFilter(applyFilter(rows, A), B);
    const single = applyFilter(rows, merged);

    expect(sequential.length).toBe(single.length);
    for (let i = 0; i < sequential.length; i++) {
      expect(sequential[i]!.amount_minor).toBe(single[i]!.amount_minor);
    }
  });
});

// ── M3: Filter idempotence ──────────────────────────────────────────────────

describe('Metamorphic M3: filter(filter(rows, F), F) == filter(rows, F)', () => {
  test('idempotence over a randomly-built filter', () => {
    const txns: ParsedTransaction[] = [
      mkTxn('2026-03-05', -10000n, 'purchase'),
      mkTxn('2026-03-10', 25000n, 'refund'),
      mkTxn('2026-03-15', -50000n, 'purchase'),
      mkTxn('2026-03-20', -5000n, 'fee')
    ];
    const rows = toUnifiedRows([mkImport(txns)]);

    fc.assert(
      fc.property(
        fc.record({
          date_from: fc.oneof(fc.constant<undefined>(undefined), fc.constant('2026-03-08')),
          types: fc.oneof(
            fc.constant<undefined>(undefined),
            fc.constant<('purchase' | 'fee')[]>(['purchase', 'fee'])
          )
        }),
        (rawFilter) => {
          // Strip undefineds — exactOptionalPropertyTypes requires omitted keys, not `undefined` values.
          const filter: TransactionFilter = {};
          if (rawFilter.date_from !== undefined) filter.date_from = rawFilter.date_from;
          if (rawFilter.types !== undefined) filter.types = rawFilter.types;

          const once = applyFilter(rows, filter);
          const twice = applyFilter(once, filter);
          expect(twice.length).toBe(once.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ── M4: Sort independence ───────────────────────────────────────────────────

describe('Metamorphic M4: sort(filter(rows, F)) == filter(sort(rows), F)', () => {
  test('sort and filter commute (sort is a pure permutation; filter is a pure subset selection)', () => {
    const txns: ParsedTransaction[] = [
      mkTxn('2026-03-05', -10000n, 'purchase'),
      mkTxn('2026-03-10', -25000n, 'purchase'),
      mkTxn('2026-03-15', 50000n, 'payment_to_card'),
      mkTxn('2026-03-20', -5000n, 'fee')
    ];
    const rows = toUnifiedRows([mkImport(txns)]);
    const filter: TransactionFilter = { types: ['purchase'] };

    const sortThenFilter = applyFilter(sortRows(rows, { key: 'amount', dir: 'asc' }), filter);
    const filterThenSort = sortRows(applyFilter(rows, filter), { key: 'amount', dir: 'asc' });

    expect(sortThenFilter.length).toBe(filterThenSort.length);
    for (let i = 0; i < sortThenFilter.length; i++) {
      expect(sortThenFilter[i]!.amount_minor).toBe(filterThenSort[i]!.amount_minor);
    }
  });
});
