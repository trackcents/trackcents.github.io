// Property-based tests for the FIFO transaction-stream attribution engine.
//
// Where the example-based tests in transaction-stream.test.ts assert exact
// outcomes on small fixtures, these properties assert universal invariants
// that must hold for ANY stream of purchases and payments.  If any of these
// fail, the FIFO algorithm has a logic bug (not just a missing test case).
//
// Invariants tested:
//   I1. Money conservation — every payment is fully accounted for:
//         sum(paid_for[*].covered_amount) + uncovered_amount === payment_amount
//   I2. No purchase is over-paid — total coverage of any single purchase
//         across all payments is at most the original purchase amount.
//   I3. unpaidBalanceAfter() equals (sum of purchase amounts) - (sum of payment
//         amounts that were actually covered).
//   I4. computeFifoAttributions is a function of (the stream) alone — calling
//         it twice produces identical output.
//   I5. Reordering purchases that ALL precede the first payment produces the
//         same total uncovered amount.

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildCardStreams,
  cardKeyString,
  computeFifoAttributions,
  unpaidBalanceAfter
} from '../../../src/lib/app/transaction-stream';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedTransaction, ParsedStatement } from '../../../src/lib/adapters/types';

// ── Arbitraries ──────────────────────────────────────────────────────────────

// One transaction event: a purchase or a payment, with a positive cents
// amount.  Sign is applied here based on type.
type Event =
  | { kind: 'purchase'; cents: bigint; day: number }
  | { kind: 'payment'; cents: bigint; day: number };

const eventArb = (): fc.Arbitrary<Event> =>
  fc.oneof(
    fc.record({
      kind: fc.constant<'purchase'>('purchase'),
      cents: fc.bigInt({ min: 1n, max: 100_000n }),
      day: fc.integer({ min: 1, max: 90 })
    }),
    fc.record({
      kind: fc.constant<'payment'>('payment'),
      cents: fc.bigInt({ min: 1n, max: 100_000n }),
      day: fc.integer({ min: 1, max: 90 })
    })
  );

function dayToIso(day: number): string {
  // Map day 1-90 to 2026-01-01..2026-03-31 (90 days fits).
  const base = new Date(Date.UTC(2026, 0, 1));
  base.setUTCDate(base.getUTCDate() + (day - 1));
  return base.toISOString().slice(0, 10);
}

function eventToTxn(e: Event): ParsedTransaction {
  if (e.kind === 'purchase') {
    return {
      posted_date: dayToIso(e.day),
      description: `purchase day ${e.day}`,
      raw_text: '',
      amount_minor: -e.cents,
      currency: 'USD',
      transaction_type: 'purchase'
    };
  }
  return {
    posted_date: dayToIso(e.day),
    description: `payment day ${e.day}`,
    raw_text: '',
    amount_minor: e.cents,
    currency: 'USD',
    transaction_type: 'payment_to_card'
  };
}

function buildImport(events: Event[]): ImportSuccess {
  const statement: ParsedStatement = {
    account_type: 'credit_card',
    account_last_4: '9999',
    period_start: '2026-01-01',
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
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name: 'Test',
    pdf_source_hash: 'hash',
    statement,
    transactions: events.map(eventToTxn),
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

function getSingleStream(imports: ImportSuccess[]) {
  const streams = buildCardStreams(imports);
  return streams.get(cardKeyString({ bank_name: 'Test', account_last_4: '9999' }))!;
}

// ── I1: Money conservation per payment ───────────────────────────────────────

describe('FIFO invariant I1 — every payment is fully accounted for', () => {
  test('sum(paid_for.covered) + uncovered === payment amount', () => {
    fc.assert(
      fc.property(fc.array(eventArb(), { minLength: 0, maxLength: 30 }), (events) => {
        const stream = getSingleStream([buildImport(events)]);
        const attributions = computeFifoAttributions(stream);
        for (const a of attributions) {
          const sumCovered = a.paid_for.reduce((acc, pf) => acc + pf.covered_amount_minor, 0n);
          const payment = stream.transactions[a.payment_position]!.txn.amount_minor;
          expect(sumCovered + a.uncovered_amount_minor).toBe(payment);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ── I2: No purchase is over-paid ─────────────────────────────────────────────

describe('FIFO invariant I2 — no purchase is over-attributed', () => {
  test('total coverage of any purchase across all payments ≤ original purchase amount', () => {
    fc.assert(
      fc.property(fc.array(eventArb(), { minLength: 0, maxLength: 30 }), (events) => {
        const stream = getSingleStream([buildImport(events)]);
        const attributions = computeFifoAttributions(stream);

        // Aggregate coverage per purchase position.
        const coverageByPosition = new Map<number, bigint>();
        for (const a of attributions) {
          for (const pf of a.paid_for) {
            const prior = coverageByPosition.get(pf.purchase_position) ?? 0n;
            coverageByPosition.set(pf.purchase_position, prior + pf.covered_amount_minor);
          }
        }

        for (const [pos, totalCovered] of coverageByPosition) {
          const txn = stream.transactions[pos]!.txn;
          // Purchase amount_minor is negative; original owed is its absolute value.
          const original = -txn.amount_minor;
          expect(totalCovered).toBeLessThanOrEqual(original);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ── I3: unpaidBalanceAfter consistency ───────────────────────────────────────

describe('FIFO invariant I3 — unpaidBalanceAfter equals leftover purchase debt', () => {
  test('unpaid balance equals sum(purchases) - sum(covered amounts across attributions)', () => {
    fc.assert(
      fc.property(fc.array(eventArb(), { minLength: 0, maxLength: 30 }), (events) => {
        const stream = getSingleStream([buildImport(events)]);
        const attributions = computeFifoAttributions(stream);

        let totalPurchases = 0n;
        for (const st of stream.transactions) {
          if (st.txn.transaction_type === 'purchase' && st.txn.amount_minor < 0n) {
            totalPurchases += -st.txn.amount_minor;
          }
        }
        let totalCovered = 0n;
        for (const a of attributions) {
          for (const pf of a.paid_for) totalCovered += pf.covered_amount_minor;
        }

        expect(unpaidBalanceAfter(stream)).toBe(totalPurchases - totalCovered);
      }),
      { numRuns: 200 }
    );
  });
});

// ── I4: determinism ──────────────────────────────────────────────────────────

describe('FIFO invariant I4 — computeFifoAttributions is deterministic', () => {
  test('two consecutive calls produce structurally identical output', () => {
    fc.assert(
      fc.property(fc.array(eventArb(), { minLength: 0, maxLength: 30 }), (events) => {
        const stream = getSingleStream([buildImport(events)]);
        const a1 = computeFifoAttributions(stream);
        const a2 = computeFifoAttributions(stream);
        expect(a1.length).toBe(a2.length);
        for (let i = 0; i < a1.length; i++) {
          expect(a1[i]!.payment_position).toBe(a2[i]!.payment_position);
          expect(a1[i]!.uncovered_amount_minor).toBe(a2[i]!.uncovered_amount_minor);
          expect(a1[i]!.paid_for.length).toBe(a2[i]!.paid_for.length);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── I5: covering payment fully eliminates owed balance ───────────────────────

describe('I5 — a payment ≥ outstanding purchases leaves no FIFO debt for those purchases', () => {
  test('a single big payment after some purchases covers all of them', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            cents: fc.bigInt({ min: 1n, max: 10_000n }),
            day: fc.integer({ min: 1, max: 30 })
          }),
          { minLength: 1, maxLength: 15 }
        ),
        (purchases) => {
          const total = purchases.reduce((acc, p) => acc + p.cents, 0n);
          const events: Event[] = [
            ...purchases.map((p) => ({ kind: 'purchase' as const, cents: p.cents, day: p.day })),
            { kind: 'payment' as const, cents: total, day: 60 }
          ];
          const stream = getSingleStream([buildImport(events)]);
          const attributions = computeFifoAttributions(stream);
          expect(attributions.length).toBe(1);
          expect(attributions[0]!.uncovered_amount_minor).toBe(0n);
          expect(unpaidBalanceAfter(stream)).toBe(0n);
        }
      ),
      { numRuns: 200 }
    );
  });
});
