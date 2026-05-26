// Bug: Drill-through on $351.27 Discover payment showed wrong purchases.
//
// Discovered: 2026-05-23
// Reported by: user clicking "See what this paid for" on a Chase Checking
//      March 3 payment to Discover.  The drill page listed the 3 small
//      Discover purchases from MARCH ($3.99 YouTube, $9.99 IVCAM, $1.09 X
//      Corp) — but those happened AFTER the payment.  The $351.27 paid off
//      FEBRUARY's purchases (which became March's "Previous Balance").
//
// Root cause: The drill matched bank-payment → CC statement (single
//      receiving statement) and showed THAT STATEMENT's transactions.
//      That's a category error — CC payments pay down a rolling balance
//      across multiple statements, not the receiving statement's own
//      transactions.
//
// Fix:
//   - New src/lib/app/transaction-stream.ts merges per-card transactions
//     into one chronological stream + computes FIFO attribution.
//   - New src/lib/app/payment-drill.ts ties bank payment → card stream →
//     FIFO result with explicit "uncovered" (pre-tracking-era) handling.
//   - Drill route /payments/[bank_hash]/[txn_idx] replaces the broken
//     /statements/[hash]?from=... drill.
//
// This regression test asserts the FIFO drill correctly attributes a
// payment to the prior-month purchases.

import { describe, test, expect } from 'vitest';
import { getPaymentDrill } from '../../../src/lib/app/payment-drill';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';

function mkTxn(
  date: string,
  amount: number,
  type: ParsedTransaction['transaction_type'],
  description: string
): ParsedTransaction {
  return {
    posted_date: date,
    description,
    raw_text: description,
    amount_minor: BigInt(Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: type
  };
}

function mkImport(
  bank_name: string,
  account_type: ParsedStatement['account_type'],
  account_last_4: string | null,
  period_start: string,
  period_end: string,
  transactions: ParsedTransaction[],
  pdfHash: string
): ImportSuccess {
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name,
    pdf_source_hash: pdfHash,
    statement: {
      account_type,
      account_last_4,
      period_start,
      period_end,
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
      statement_date: period_end,
      minimum_payment_due_minor: null,
      parser_provides: ['C']
    },
    transactions,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

describe('regression bug-2026-05-23: $351.27 Discover payment attributes to PRIOR-month purchases', () => {
  test('three Feb purchases summing $341.27 + $10 uncovered — NOT the three small March purchases', () => {
    const feb = mkImport(
      'Discover',
      'credit_card',
      '3562',
      '2026-01-25',
      '2026-02-25',
      [
        mkTxn('2026-01-30', -200.0, 'purchase', 'AMAZON MKTPL'),
        mkTxn('2026-02-05', -75.5, 'purchase', 'TRADER JOES'),
        mkTxn('2026-02-15', -65.77, 'purchase', 'COSTCO GAS')
      ],
      'h-disc-feb'
    );

    const mar = mkImport(
      'Discover',
      'credit_card',
      '3562',
      '2026-02-26',
      '2026-03-25',
      [
        mkTxn('2026-03-03', 351.27, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU'),
        mkTxn('2026-03-09', -3.99, 'purchase', 'GOOGLE *YOUTUBE'),
        mkTxn('2026-03-15', -9.99, 'purchase', 'GOOGLE *IVCAM'),
        mkTxn('2026-03-18', -1.09, 'purchase', 'X CORP. PAID FEATURES')
      ],
      'h-disc-mar'
    );

    const bank = mkImport(
      'Chase',
      'checking',
      '9535',
      '2026-02-26',
      '2026-03-24',
      [
        mkTxn(
          '2026-03-03',
          -351.27,
          'payment_to_card',
          'Discover E-Payment 3562 Web ID: 2510020270'
        )
      ],
      'h-chk-mar'
    );

    const drill = getPaymentDrill([bank, feb, mar], 0, 0);
    expect(drill).not.toBeNull();
    expect(drill!.payment_amount_minor).toBe(35127n);

    // THE CARDINAL ASSERTION: paid_for descriptions are the FEB merchants,
    // NOT the small March charges that came AFTER the payment.
    expect(drill!.paid_for.map((p) => p.txn.description)).toEqual([
      'AMAZON MKTPL',
      'TRADER JOES',
      'COSTCO GAS'
    ]);

    // Remainder $10 is "pre-tracking" — the Feb statement had a prior
    // balance we don't have records for.
    expect(drill!.uncovered_amount_minor).toBe(1000n);
  });

  test('without the Feb statement, the same payment shows as 100% pre-tracking (honest)', () => {
    // The user might only have the receiving statement (Mar).  In that
    // case the drill must NOT pretend to know what the payment paid for;
    // it must say "we don't have records of those earlier purchases."
    const mar = mkImport(
      'Discover',
      'credit_card',
      '3562',
      '2026-02-26',
      '2026-03-25',
      [
        mkTxn('2026-03-03', 351.27, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU'),
        mkTxn('2026-03-09', -3.99, 'purchase', 'GOOGLE *YOUTUBE'),
        mkTxn('2026-03-15', -9.99, 'purchase', 'GOOGLE *IVCAM'),
        mkTxn('2026-03-18', -1.09, 'purchase', 'X CORP. PAID FEATURES')
      ],
      'h-disc-mar-2'
    );

    const bank = mkImport(
      'Chase',
      'checking',
      '9535',
      '2026-02-26',
      '2026-03-24',
      [
        mkTxn(
          '2026-03-03',
          -351.27,
          'payment_to_card',
          'Discover E-Payment 3562 Web ID: 2510020270'
        )
      ],
      'h-chk-mar-2'
    );

    const drill = getPaymentDrill([bank, mar], 0, 0);
    expect(drill).not.toBeNull();
    expect(drill!.paid_for).toEqual([]);
    expect(drill!.uncovered_amount_minor).toBe(35127n);
  });
});
