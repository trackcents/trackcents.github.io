// Tests for the FIFO transaction-stream attribution engine.
//
// The most important test in this file is the "$351.27 Discover scenario"
// near the top — that's the exact real-world bug we are fixing.  Every other
// test is a corner case that has historically broken other people's
// attribution engines (YNAB, Mint, custom ledgers).  Keep them all.

import { describe, test, expect } from 'vitest';
import {
  buildCardStreams,
  cardKeyString,
  computeFifoAttributions,
  findAttributionForPosition,
  unpaidBalanceAfter
} from '../../../src/lib/app/transaction-stream';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedTransaction, ParsedStatement } from '../../../src/lib/adapters/types';

// ── Test fixture builders ────────────────────────────────────────────────

function purchase(date: string, amount: number, desc: string): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: BigInt(-Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: 'purchase'
  };
}

function payment(
  date: string,
  amount: number,
  desc = 'INTERNET PAYMENT - THANK YOU'
): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: BigInt(Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: 'payment_to_card'
  };
}

function refund(date: string, amount: number, desc: string): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: BigInt(Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: 'refund'
  };
}

function fee(date: string, amount: number, desc: string): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: BigInt(-Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: 'fee'
  };
}

function ccImport(
  bankName: string,
  last4: string | null,
  periodStart: string,
  periodEnd: string,
  txns: ParsedTransaction[]
): ImportSuccess {
  const statement: ParsedStatement = {
    account_type: 'credit_card',
    account_last_4: last4,
    period_start: periodStart,
    period_end: periodEnd,
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
    statement_date: periodEnd,
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name: bankName,
    pdf_source_hash: `hash-${bankName}-${last4}-${periodEnd}`,
    statement,
    transactions: txns,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

// ── Cardinal regression: the $351.27 Discover scenario ──────────────────────
//
// This reproduces what the user observed on 2026-05-23 — a $351.27 Discover
// payment that the broken statement-level drill claimed was paying for the
// March statement's 3 small charges ($15.07 total).  Reality: the $351.27
// paid off the FEBRUARY purchases that became the March statement's
// Previous Balance.

describe('FIFO attribution — the $351.27 Discover regression', () => {
  // Build TWO statements:
  //   Feb statement: $341.27 of purchases, no payments → closes owing $341.27
  //   Mar statement: $341.27 previous balance ← we don't model this as a row
  //                  $351.27 payment paid in early March (paid off Feb)
  //                  $15.07 of new small charges later in March
  //                  Closes with $15.07 owed
  const feb = ccImport('Discover', '3562', '2026-01-25', '2026-02-25', [
    purchase('2026-01-30', 200.0, 'Amazon Marketplace'),
    purchase('2026-02-05', 75.5, 'Trader Joes'),
    purchase('2026-02-15', 65.77, 'Costco Gas')
  ]);
  const mar = ccImport('Discover', '3562', '2026-02-26', '2026-03-25', [
    payment('2026-03-03', 351.27),
    purchase('2026-03-09', 3.99, 'Google YouTube'),
    purchase('2026-03-15', 9.99, 'Google IVCAM'),
    purchase('2026-03-18', 1.09, 'X Corp Paid Features')
  ]);

  test('builds one merged card stream sorted chronologically', () => {
    const streams = buildCardStreams([feb, mar]);
    expect(streams.size).toBe(1);
    const stream = streams.get(cardKeyString({ bank_name: 'Discover', account_last_4: '3562' }))!;
    expect(stream.transactions.length).toBe(7);
    // Verify chronological order
    for (let i = 1; i < stream.transactions.length; i++) {
      expect(
        stream.transactions[i]!.txn.posted_date >= stream.transactions[i - 1]!.txn.posted_date
      ).toBe(true);
    }
  });

  test('the $351.27 payment attributes to the THREE Feb purchases, NOT the Mar ones', () => {
    const streams = buildCardStreams([feb, mar]);
    const stream = streams.get(cardKeyString({ bank_name: 'Discover', account_last_4: '3562' }))!;
    const attributions = computeFifoAttributions(stream);

    // Stream order (chronological):
    //   0: 01/30 Amazon $200.00       (purchase)
    //   1: 02/05 Trader Joes $75.50   (purchase)
    //   2: 02/15 Costco $65.77        (purchase)
    //   3: 03/03 payment $351.27
    //   4: 03/09 YouTube $3.99
    //   5: 03/15 IVCAM $9.99
    //   6: 03/18 X Corp $1.09

    // Only the payment produces an attribution
    expect(attributions.length).toBe(1);
    const a = attributions[0]!;
    expect(a.payment_position).toBe(3);

    // Should consume positions 0, 1, 2 fully (sum = $341.27).
    expect(a.paid_for.length).toBe(3);
    expect(a.paid_for[0]!.purchase_position).toBe(0);
    expect(a.paid_for[0]!.covered_amount_minor).toBe(20000n);
    expect(a.paid_for[1]!.purchase_position).toBe(1);
    expect(a.paid_for[1]!.covered_amount_minor).toBe(7550n);
    expect(a.paid_for[2]!.purchase_position).toBe(2);
    expect(a.paid_for[2]!.covered_amount_minor).toBe(6577n);

    // $351.27 - $341.27 = $10.00 of payment had no purchase to cover yet —
    // that's the "credit balance" portion.  In our model we record it as
    // uncovered (which the UI explains as "paid pre-tracking history").
    expect(a.uncovered_amount_minor).toBe(1000n);
  });

  test('the March small purchases are still unpaid at end of stream', () => {
    const streams = buildCardStreams([feb, mar]);
    const stream = streams.get(cardKeyString({ bank_name: 'Discover', account_last_4: '3562' }))!;
    // $3.99 + $9.99 + $1.09 = $15.07 unpaid at end (matches March's $15.07 closing)
    expect(unpaidBalanceAfter(stream)).toBe(1507n);
  });
});

// ── Cold-start cases ────────────────────────────────────────────────────────

describe('cold-start: payments larger than available purchases', () => {
  test('payment with zero prior purchases → fully uncovered', () => {
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', [
      payment('2026-03-03', 351.27)
    ]);
    const streams = buildCardStreams([imp]);
    const stream = streams.get(cardKeyString({ bank_name: 'Discover', account_last_4: '3562' }))!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions.length).toBe(1);
    expect(attributions[0]!.paid_for.length).toBe(0);
    expect(attributions[0]!.uncovered_amount_minor).toBe(35127n);
  });

  test('payment partially uncovered (queue exhausts mid-payment)', () => {
    // Only $50 of purchases recorded; payment is $200.  $150 uncovered.
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', [
      purchase('2026-03-02', 50.0, 'Coffee'),
      payment('2026-03-15', 200.0)
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions[0]!.paid_for.length).toBe(1);
    expect(attributions[0]!.paid_for[0]!.covered_amount_minor).toBe(5000n);
    expect(attributions[0]!.uncovered_amount_minor).toBe(15000n);
  });
});

// ── Partial coverage cases ──────────────────────────────────────────────────

describe('partial purchase coverage', () => {
  test('payment smaller than oldest purchase → partial pay-down', () => {
    // $500 purchase, then $200 payment.  Should partially cover the purchase.
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', [
      purchase('2026-03-02', 500.0, 'Flight'),
      payment('2026-03-15', 200.0)
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions.length).toBe(1);
    expect(attributions[0]!.paid_for.length).toBe(1);
    expect(attributions[0]!.paid_for[0]!.purchase_position).toBe(0);
    expect(attributions[0]!.paid_for[0]!.covered_amount_minor).toBe(20000n);
    expect(attributions[0]!.uncovered_amount_minor).toBe(0n);
    // $300 still owed
    expect(unpaidBalanceAfter(stream)).toBe(30000n);
  });

  test('subsequent payment finishes off the partially-paid purchase', () => {
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-04-30', [
      purchase('2026-03-02', 500.0, 'Flight'),
      payment('2026-03-15', 200.0),
      payment('2026-04-05', 300.0)
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions.length).toBe(2);
    expect(attributions[1]!.paid_for.length).toBe(1);
    expect(attributions[1]!.paid_for[0]!.purchase_position).toBe(0);
    expect(attributions[1]!.paid_for[0]!.covered_amount_minor).toBe(30000n);
    expect(unpaidBalanceAfter(stream)).toBe(0n);
  });

  test('purchase split across MULTIPLE payments — both reference position 0', () => {
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-04-30', [
      purchase('2026-03-02', 1000.0, 'Big purchase'),
      payment('2026-03-15', 300.0),
      payment('2026-03-29', 400.0),
      payment('2026-04-12', 300.0)
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions.length).toBe(3);
    for (const a of attributions) {
      expect(a.paid_for.length).toBe(1);
      expect(a.paid_for[0]!.purchase_position).toBe(0);
    }
    expect(attributions[0]!.paid_for[0]!.covered_amount_minor).toBe(30000n);
    expect(attributions[1]!.paid_for[0]!.covered_amount_minor).toBe(40000n);
    expect(attributions[2]!.paid_for[0]!.covered_amount_minor).toBe(30000n);
    expect(unpaidBalanceAfter(stream)).toBe(0n);
  });
});

// ── Refund handling ─────────────────────────────────────────────────────────

describe('refunds', () => {
  test('refund consumes oldest unpaid purchase (FIFO, same as payment)', () => {
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', [
      purchase('2026-03-02', 100.0, 'Bad item'),
      purchase('2026-03-05', 50.0, 'Other item'),
      refund('2026-03-10', 100.0, 'Returned bad item')
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions.length).toBe(1);
    // Refund FIFO-consumed the $100 purchase at position 0 — not the $50 at position 1.
    // (Ideal behavior is to match refund to its specific purchase, but FIFO
    // is the v1 simplification; manual override is the user's escape hatch.)
    expect(attributions[0]!.paid_for[0]!.purchase_position).toBe(0);
    expect(attributions[0]!.paid_for[0]!.covered_amount_minor).toBe(10000n);
    expect(unpaidBalanceAfter(stream)).toBe(5000n);
  });
});

// ── Fees and interest ───────────────────────────────────────────────────────

describe('fees and interest are queued like purchases', () => {
  test('fees become part of the unpaid queue', () => {
    const imp = ccImport('Robinhood', '9024', '2026-03-01', '2026-03-31', [
      purchase('2026-03-02', 50.0, 'Coffee'),
      fee('2026-03-10', 35.0, 'Late fee'),
      payment('2026-03-20', 100.0)
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Robinhood', account_last_4: '9024' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(attributions.length).toBe(1);
    expect(attributions[0]!.paid_for.length).toBe(2);
    expect(attributions[0]!.paid_for[0]!.purchase_position).toBe(0);
    expect(attributions[0]!.paid_for[1]!.purchase_position).toBe(1);
    expect(attributions[0]!.uncovered_amount_minor).toBe(1500n); // $100 - $50 - $35 = $15
  });
});

// ── Multiple cards don't bleed into each other ──────────────────────────────

describe('multiple cards are isolated', () => {
  test('Discover purchases do not get paid by a BofA payment', () => {
    const disc = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', [
      purchase('2026-03-05', 100.0, 'Discover purchase')
    ]);
    const bofa = ccImport('Bank of America', '2050', '2026-03-01', '2026-03-31', [
      payment('2026-03-20', 100.0, 'BofA payment')
    ]);
    const streams = buildCardStreams([disc, bofa]);
    expect(streams.size).toBe(2);
    const discStream = streams.get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const bofaStream = streams.get(
      cardKeyString({ bank_name: 'Bank of America', account_last_4: '2050' })
    )!;
    // Discover still owes $100 (no payment from BofA bled over)
    expect(unpaidBalanceAfter(discStream)).toBe(10000n);
    // BofA payment is fully uncovered (no Bofa purchases recorded)
    const bofaAttr = computeFifoAttributions(bofaStream);
    expect(bofaAttr.length).toBe(1);
    expect(bofaAttr[0]!.uncovered_amount_minor).toBe(10000n);
  });

  test('two cards from same bank with different last4 are separate streams', () => {
    const card1 = ccImport('Chase', '1797', '2026-03-01', '2026-03-31', [
      purchase('2026-03-05', 100.0, 'Card 1 purchase')
    ]);
    const card2 = ccImport('Chase', '7137', '2026-03-01', '2026-03-31', [
      purchase('2026-03-05', 200.0, 'Card 2 purchase')
    ]);
    const streams = buildCardStreams([card1, card2]);
    expect(streams.size).toBe(2);
  });
});

// ── Non-CC accounts excluded ────────────────────────────────────────────────

describe('only credit_card and loan accounts produce streams', () => {
  test('checking accounts are excluded from card streams', () => {
    const checking: ImportSuccess = {
      ok: true,
      adapter_name: 'test',
      adapter_version: '0.0.0',
      bank_name: 'Chase',
      pdf_source_hash: 'hash-chk',
      statement: {
        account_type: 'checking',
        account_last_4: '9535',
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
        parser_provides: ['A']
      },
      transactions: [purchase('2026-03-05', 100.0, 'Random')],
      checksum: { ok: true, strategy_used: 'A', level_results: [] }
    };
    expect(buildCardStreams([checking]).size).toBe(0);
  });

  test('statements with null account_last_4 are skipped', () => {
    const noLast4 = ccImport('Mystery', null, '2026-03-01', '2026-03-31', [
      purchase('2026-03-05', 100.0, 'Mystery purchase')
    ]);
    expect(buildCardStreams([noLast4]).size).toBe(0);
  });
});

// ── Find by position helper ─────────────────────────────────────────────────

describe('findAttributionForPosition', () => {
  test('returns null for unknown positions', () => {
    expect(findAttributionForPosition([], 5)).toBeNull();
  });

  test('returns the attribution at the right payment position', () => {
    const imp = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', [
      purchase('2026-03-02', 50.0, 'p1'),
      payment('2026-03-10', 30.0),
      purchase('2026-03-15', 25.0, 'p2'),
      payment('2026-03-20', 25.0)
    ]);
    const stream = buildCardStreams([imp]).get(
      cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
    )!;
    const attributions = computeFifoAttributions(stream);
    expect(findAttributionForPosition(attributions, 1)).not.toBeNull();
    expect(findAttributionForPosition(attributions, 3)).not.toBeNull();
    expect(findAttributionForPosition(attributions, 0)).toBeNull(); // purchase, not a payment
    expect(findAttributionForPosition(attributions, 2)).toBeNull(); // purchase, not a payment
  });
});

// ── Same-day ordering: deterministic, import-order-INDEPENDENT (IV&V D19) ─────

describe('same-day transactions order deterministically (debit before credit)', () => {
  // The fix (D19, same principle as merchant-trends D13): within a single
  // posted_date a payment is ordered AFTER that day's charges, so it pays them
  // off — regardless of which order the PDF/parser emitted the rows. Order must
  // NOT matter; the result is identical either way.
  for (const order of ['purchase-then-payment', 'payment-then-purchase'] as const) {
    test(`a same-day purchase + payment → payment covers the purchase (${order})`, () => {
      const rows =
        order === 'purchase-then-payment'
          ? [purchase('2026-03-15', 50.0, 'p1'), payment('2026-03-15', 50.0)]
          : [payment('2026-03-15', 50.0), purchase('2026-03-15', 50.0, 'p1')];
      const imp = ccImport('Discover', '3562', '2026-03-01', '2026-03-31', rows);
      const stream = buildCardStreams([imp]).get(
        cardKeyString({ bank_name: 'Discover', account_last_4: '3562' })
      )!;
      const attributions = computeFifoAttributions(stream);
      expect(attributions.length).toBe(1);
      // The purchase always sorts to position 0 (debit before credit), the
      // payment to position 1 — independent of the input order above.
      expect(attributions[0]!.payment_position).toBe(1);
      expect(attributions[0]!.paid_for.length).toBe(1);
      expect(attributions[0]!.paid_for[0]!.purchase_position).toBe(0);
      expect(attributions[0]!.paid_for[0]!.covered_amount_minor).toBe(5000n);
      expect(attributions[0]!.uncovered_amount_minor).toBe(0n);
      expect(unpaidBalanceAfter(stream)).toBe(0n);
    });
  }
});
