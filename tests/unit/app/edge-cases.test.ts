// Runs every synthetic edge-case fixture through the FIFO drill engine,
// the reconciliation matcher, the unified-view filter/sort, and reports
// real or expected behaviour.  Where a test FAILS, that's a latent bug
// (or a documentation gap if the behaviour is intentional).
//
// This is the "find latent bugs by running existing code against
// deliberate edge cases" test.

import { describe, test, expect } from 'vitest';
import {
  partialRefund,
  fullRefund,
  refundAfterPayment,
  yearBoundary,
  leapYear,
  creditBalance,
  multipleInterestRates,
  cashAdvance,
  balanceTransfer,
  disputedTransaction,
  zeroActivity,
  ALL_EDGE_CASES
} from '../../fixtures/synthetic/cc-edge-cases';
import {
  generateRealisticStatement,
  generateMultiAccountVolume
} from '../../fixtures/synthetic/volume-generator';
import {
  buildCardStreams,
  cardKeyString,
  computeFifoAttributions,
  unpaidBalanceAfter
} from '../../../src/lib/app/transaction-stream';
import {
  toUnifiedRows,
  listAccounts,
  applyFilter,
  sortRows
} from '../../../src/lib/app/transaction-view';

// ── FIFO behaviour on edge cases ─────────────────────────────────────────────

describe('FIFO attribution — refund edge cases', () => {
  test('partial refund: refund consumes part of the original purchase (FIFO simplification)', () => {
    const imp = partialRefund();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '0001' })
    )!;
    const attributions = computeFifoAttributions(stream);
    // Refund is treated as a payment in FIFO; consumes the oldest purchase.
    expect(attributions).toHaveLength(1);
    expect(attributions[0]!.paid_for[0]!.covered_amount_minor).toBe(3000n);
    expect(attributions[0]!.uncovered_amount_minor).toBe(0n);
    // $70 still owed after the partial refund consumes $30 of the $100.
    expect(unpaidBalanceAfter(stream)).toBe(7000n);
  });

  test('full refund: refund consumes the original purchase entirely', () => {
    const imp = fullRefund();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '0002' })
    )!;
    expect(unpaidBalanceAfter(stream)).toBe(0n);
  });

  test('refund AFTER payment: refund attributes to "uncovered" because queue is empty', () => {
    // KNOWN LIMITATION (documented in cc-statement-anatomy.md):
    // A refund issued after the original purchase was already paid down
    // should create a credit balance.  Our FIFO model attributes the
    // refund's "covered" portion to the empty queue → uncovered_amount.
    // The user-facing UI should explain this as "credit balance accrued
    // — will be applied to future purchases."
    const imp = refundAfterPayment();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '0003' })
    )!;
    const attributions = computeFifoAttributions(stream);
    // 2 attributions: the payment (covers original purchase), the refund (uncovered).
    expect(attributions).toHaveLength(2);
    const payment = attributions.find((a) => a.paid_for.length > 0)!;
    const refund = attributions.find((a) => a.paid_for.length === 0)!;
    expect(payment.uncovered_amount_minor).toBe(0n);
    expect(refund.uncovered_amount_minor).toBe(5000n);
    // unpaidBalanceAfter is 0 (no unpaid purchases) — the refund credit isn't represented.
    expect(unpaidBalanceAfter(stream)).toBe(0n);
  });
});

// ── FIFO behaviour on cash advance + balance transfer (both queued as debt) ──

describe('FIFO attribution — cash advance and balance transfer act like purchases', () => {
  test('cash advance and its fee both get queued as unpaid debt', () => {
    const imp = cashAdvance();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Chase', account_last_4: '0010' })
    )!;
    expect(unpaidBalanceAfter(stream)).toBe(21000n); // $200 advance + $10 fee
  });

  test('balance transfer + fee both get queued', () => {
    const imp = balanceTransfer();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Chase', account_last_4: '0011' })
    )!;
    // Balance transfer is type='transfer' — current FIFO IGNORES transfers
    // (treats them as neither purchase nor payment).  Only the fee gets
    // queued.  This is a KNOWN LIMITATION worth documenting.
    expect(unpaidBalanceAfter(stream)).toBe(9000n); // only the $90 fee
  });
});

// ── Interest charges DO accrue debt under FIFO ───────────────────────────────

describe('FIFO attribution — interest behaves like a purchase (adds to debt)', () => {
  test('multiple interest rows all add to the queue', () => {
    const imp = multipleInterestRates();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Chase', account_last_4: '0009' })
    )!;
    // $50 purchase + $5 + $3.50 + $1.50 = $60 unpaid (no payment in this statement)
    expect(unpaidBalanceAfter(stream)).toBe(6000n);
  });
});

// ── Unified-view filter on edge cases ────────────────────────────────────────

describe('Unified view — filter handles edge cases without crashing', () => {
  test('searches across all 20 edge cases with various tokens', () => {
    const all = Object.values(ALL_EDGE_CASES).map((f) => f());
    const rows = toUnifiedRows(all);
    expect(rows.length).toBeGreaterThan(0);
    // Spot checks
    expect(applyFilter(rows, { search: 'amazon' }).length).toBeGreaterThan(0);
    expect(applyFilter(rows, { search: 'CAFÉ' }).length).toBeGreaterThan(0); // unicode
    expect(applyFilter(rows, { search: "trader joe's" }).length).toBe(1); // apostrophe
    expect(applyFilter(rows, { search: 'NETFLIX' }).length).toBe(0); // not in edge cases
  });

  test('amount filter handles extreme values ($0.01 to $9,999.99)', () => {
    const all = Object.values(ALL_EDGE_CASES).map((f) => f());
    const rows = toUnifiedRows(all);
    expect(applyFilter(rows, { amount_min: 5000 }).length).toBeGreaterThan(0); // very large
    expect(applyFilter(rows, { amount_max: 0.5 }).length).toBeGreaterThan(0); // very small
  });

  test('date filter handles year-boundary statement', () => {
    const rows = toUnifiedRows([yearBoundary()]);
    expect(applyFilter(rows, { date_from: '2025-12-01', date_to: '2025-12-31' }).length).toBe(1);
    expect(applyFilter(rows, { date_from: '2026-01-01', date_to: '2026-01-31' }).length).toBe(3);
  });

  test('date filter handles leap year (Feb 29)', () => {
    const rows = toUnifiedRows([leapYear()]);
    expect(applyFilter(rows, { date_from: '2024-02-29', date_to: '2024-02-29' }).length).toBe(1);
  });

  test('sort by amount handles credit balance (negative amounts) correctly', () => {
    const rows = toUnifiedRows([creditBalance()]);
    const desc = sortRows(rows, { key: 'amount', dir: 'desc' });
    // The payment is +$75 (positive — credit to card).  Highest by amount.
    expect(desc[0]!.amount_minor).toBe(7500n);
  });
});

// ── Account enumeration with many edge cases ───────────────────────────────

describe('Unified view — account enumeration covers every synthetic card', () => {
  test('listAccounts returns one entry per unique edge case', () => {
    const all = Object.values(ALL_EDGE_CASES).map((f) => f());
    const rows = toUnifiedRows(all);
    const accts = listAccounts(rows);
    // Each edge case has a unique account_last_4, but zeroActivity has no
    // transactions so no rows → its account is NOT in listAccounts output.
    // 20 edge cases - 1 zero-activity = 19 distinct accounts represented.
    expect(accts.length).toBe(19);
  });
});

// ── Volume generator — stress + determinism ─────────────────────────────────

describe('Volume generator', () => {
  test('produces the requested transaction count (give or take rounding)', () => {
    const imp = generateRealisticStatement({
      seed: 42,
      bank_name: 'Chase',
      account_last_4: '9999',
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      transaction_count: 100
    });
    expect(imp.transactions.length).toBeGreaterThanOrEqual(98);
    expect(imp.transactions.length).toBeLessThanOrEqual(102);
  });

  test('determinism — same seed produces same output', () => {
    const opts = {
      seed: 7,
      bank_name: 'Chase',
      account_last_4: '8888',
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      transaction_count: 50
    };
    const a = generateRealisticStatement(opts);
    const b = generateRealisticStatement(opts);
    expect(a.transactions.length).toBe(b.transactions.length);
    for (let i = 0; i < a.transactions.length; i++) {
      expect(a.transactions[i]!.amount_minor).toBe(b.transactions[i]!.amount_minor);
      expect(a.transactions[i]!.description).toBe(b.transactions[i]!.description);
    }
  });

  test('stress: 5000-transaction multi-account run filters and sorts in <1s', () => {
    // 10 accounts × 12 months × ~42 transactions/month = ~5040 total.
    const imports = generateMultiAccountVolume({
      seed: 1,
      monthlyTransactionsPerAccount: 42,
      accountCount: 10,
      monthCount: 12
    });
    const rows = toUnifiedRows(imports);
    expect(rows.length).toBeGreaterThan(4500);
    expect(rows.length).toBeLessThan(5500);

    // Time bound: search + sort across 5k rows must be sub-second.
    const t0 = performance.now();
    const filtered = applyFilter(rows, { search: 'STARBUCKS' });
    const sorted = sortRows(filtered, { key: 'amount', dir: 'desc' });
    const elapsed = performance.now() - t0;
    expect(sorted.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000); // 1 second is the soft ceiling
  });

  test('volume generator across all unique bank/account combos enumerates accounts', () => {
    const imports = generateMultiAccountVolume({
      seed: 1,
      monthlyTransactionsPerAccount: 10,
      accountCount: 5,
      monthCount: 3
    });
    const accts = listAccounts(toUnifiedRows(imports));
    expect(accts.length).toBe(5);
  });
});

// ── Zero-activity statement ──────────────────────────────────────────────────

describe('Zero-activity statement', () => {
  test('toUnifiedRows produces zero rows', () => {
    const rows = toUnifiedRows([zeroActivity()]);
    expect(rows).toEqual([]);
  });

  test('FIFO over an empty stream returns no attributions', () => {
    const streams = buildCardStreams([zeroActivity()]);
    const stream = streams.get(cardKeyString({ bank_name: 'Chase', account_last_4: '0020' }))!;
    expect(stream.transactions).toEqual([]);
    expect(computeFifoAttributions(stream)).toEqual([]);
    expect(unpaidBalanceAfter(stream)).toBe(0n);
  });
});

// ── Disputed transaction round-trip ─────────────────────────────────────────

describe('Disputed transaction', () => {
  test('original + reversal nets to zero in FIFO (refund consumes the original)', () => {
    const imp = disputedTransaction();
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Chase', account_last_4: '0017' })
    )!;
    expect(unpaidBalanceAfter(stream)).toBe(0n);
  });
});
