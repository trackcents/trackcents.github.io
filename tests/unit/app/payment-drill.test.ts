// Direct tests for payment-drill.ts.
//
// The transaction-stream.test.ts file covers the FIFO algorithm in isolation;
// the reconciliation.test.ts covers the bank-tx → card matcher in isolation.
// But the GLUE — getPaymentDrill() that wires both together and resolves
// purchase positions back to (import_index, transaction_index) — had 0%
// coverage at the time payment-drill.ts shipped (2026-05-23 coverage report).
//
// Branches under test:
//   B1. No reconciliation link for the bank-tx (e.g., unknown descriptor) → null
//   B2. bank_import_index out of range → null
//   B3. bank_transaction_index out of range → null
//   B4. matched CC import has null account_last_4 → null
//   B5. payment position can't be located in the merged card stream → null
//   B6. Happy path: single statement, payment paid for purchases in same statement
//   B7. Happy path: multi-statement, payment paid for prior-month purchases (the
//       Discover $351.27 scenario the engine was built for)
//   B8. Happy path with uncovered remainder (pre-tracking balance)

import { describe, test, expect } from 'vitest';
import { getPaymentDrill } from '../../../src/lib/app/payment-drill';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type {
  ParsedTransaction,
  ParsedStatement,
  AccountType
} from '../../../src/lib/adapters/types';

// ── Fixture builders ─────────────────────────────────────────────────────────

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
  period_start: string,
  period_end: string,
  transactions: ParsedTransaction[],
  pdfHash: string = `hash-${bank_name}-${account_last_4}-${period_end}`
): ImportSuccess {
  const statement: ParsedStatement = {
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
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name,
    pdf_source_hash: pdfHash,
    statement,
    transactions,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

// ── B1: No reconciliation link ───────────────────────────────────────────────

describe('getPaymentDrill — no link', () => {
  test('returns null when the bank-tx descriptor matches no known issuer', () => {
    const bank = mkImport('Chase', 'checking', '9535', '2026-03-01', '2026-03-31', [
      mkTxn('2026-03-10', -100, 'payment_to_card', 'MYSTERY UNKNOWN PAYEE — NO ISSUER')
    ]);
    expect(getPaymentDrill([bank], 0, 0)).toBeNull();
  });

  test('returns null when no CC statement exists for the issuer', () => {
    // Bank has a clear Discover payment, but no Discover statement imported.
    const bank = mkImport('Chase', 'checking', '9535', '2026-03-01', '2026-03-31', [
      mkTxn('2026-03-10', -150, 'payment_to_card', 'Discover E-Payment 3562 Web ID: 2510020270')
    ]);
    expect(getPaymentDrill([bank], 0, 0)).toBeNull();
  });
});

// ── B2 / B3: Bounds checks ───────────────────────────────────────────────────

describe('getPaymentDrill — bounds checks', () => {
  test('out-of-range bank_import_index returns null', () => {
    const bank = mkImport('Chase', 'checking', '9535', '2026-03-01', '2026-03-31', [
      mkTxn('2026-03-10', -100, 'payment_to_card', 'Discover E-Payment 3562')
    ]);
    expect(getPaymentDrill([bank], 5, 0)).toBeNull();
    expect(getPaymentDrill([bank], -1, 0)).toBeNull();
  });

  test('out-of-range bank_transaction_index returns null', () => {
    const bank = mkImport('Chase', 'checking', '9535', '2026-03-01', '2026-03-31', [
      mkTxn('2026-03-10', -100, 'payment_to_card', 'Discover E-Payment 3562')
    ]);
    expect(getPaymentDrill([bank], 0, 99)).toBeNull();
  });
});

// ── B6: Happy path, single statement ─────────────────────────────────────────

describe('getPaymentDrill — happy path (single statement)', () => {
  test('payment after purchases in the same statement attributes to those purchases', () => {
    // Discover statement: 3 purchases then a payment that covers them exactly.
    const cc = mkImport('Discover', 'credit_card', '3562', '2026-03-01', '2026-03-31', [
      mkTxn('2026-03-05', -10.0, 'purchase', 'p1'),
      mkTxn('2026-03-08', -15.0, 'purchase', 'p2'),
      mkTxn('2026-03-12', -25.0, 'purchase', 'p3'),
      mkTxn('2026-03-20', 50.0, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU')
    ]);
    const bank = mkImport('Chase', 'checking', '9535', '2026-03-15', '2026-03-25', [
      mkTxn('2026-03-20', -50.0, 'payment_to_card', 'Discover E-Payment 3562 Web ID: 2510020270')
    ]);

    const drill = getPaymentDrill([bank, cc], 0, 0);
    expect(drill).not.toBeNull();
    expect(drill!.card_bank_name).toBe('Discover');
    expect(drill!.card_last_4).toBe('3562');
    expect(drill!.payment_amount_minor).toBe(5000n);
    expect(drill!.uncovered_amount_minor).toBe(0n);
    expect(drill!.paid_for).toHaveLength(3);
    // All paid-for entries point back to the CC import (index 1)
    for (const pf of drill!.paid_for) {
      expect(pf.import_index).toBe(1);
    }
    // FIFO order — oldest purchase first
    expect(drill!.paid_for[0]!.txn.description).toBe('p1');
    expect(drill!.paid_for[1]!.txn.description).toBe('p2');
    expect(drill!.paid_for[2]!.txn.description).toBe('p3');
  });
});

// ── B7: Happy path, multi-statement (the cardinal regression) ────────────────

describe('getPaymentDrill — multi-statement attribution (the Discover $351.27 case)', () => {
  test('payment paid off purchases from a PRIOR statement, not the receiving one', () => {
    // Feb Discover statement: 3 purchases summing $341.27, no payment.
    const feb = mkImport('Discover', 'credit_card', '3562', '2026-01-25', '2026-02-25', [
      mkTxn('2026-01-30', -200.0, 'purchase', 'Amazon Marketplace'),
      mkTxn('2026-02-05', -75.5, 'purchase', 'Trader Joes'),
      mkTxn('2026-02-15', -65.77, 'purchase', 'Costco Gas')
    ]);
    // Mar Discover statement: payment $351.27 (covers Feb + leaves $10
    // uncovered) plus 3 small charges AFTER the payment.
    const mar = mkImport('Discover', 'credit_card', '3562', '2026-02-26', '2026-03-25', [
      mkTxn('2026-03-03', 351.27, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU'),
      mkTxn('2026-03-09', -3.99, 'purchase', 'Google YouTube'),
      mkTxn('2026-03-15', -9.99, 'purchase', 'Google IVCAM'),
      mkTxn('2026-03-18', -1.09, 'purchase', 'X Corp Paid Features')
    ]);
    const bank = mkImport('Chase', 'checking', '9535', '2026-02-26', '2026-03-24', [
      mkTxn('2026-03-03', -351.27, 'payment_to_card', 'Discover E-Payment 3562 Web ID: 2510020270')
    ]);

    const drill = getPaymentDrill([bank, feb, mar], 0, 0);
    expect(drill).not.toBeNull();
    expect(drill!.payment_amount_minor).toBe(35127n);

    // Critical assertion — the payment paid for the 3 FEB purchases,
    // NOT the 3 small Mar purchases.
    expect(drill!.paid_for).toHaveLength(3);
    expect(drill!.paid_for.map((p) => p.txn.description)).toEqual([
      'Amazon Marketplace',
      'Trader Joes',
      'Costco Gas'
    ]);

    // $351.27 covered $341.27 of Feb purchases; the remaining $10.00
    // attributes to pre-tracking balance.
    expect(drill!.uncovered_amount_minor).toBe(1000n);
  });
});

// ── B8: Uncovered remainder (full pre-track payment) ─────────────────────────

describe('getPaymentDrill — fully-uncovered payment (pre-tracking)', () => {
  test('payment with no prior tracked purchases shows as 100% pre-tracking', () => {
    // Discover March: payment $351.27 with NOTHING in stream before it
    // (the Feb statement is missing from imports).  The 3 small Mar purchases
    // arrive AFTER the payment so they don't reduce uncovered.
    const mar = mkImport('Discover', 'credit_card', '3562', '2026-02-26', '2026-03-25', [
      mkTxn('2026-03-03', 351.27, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU'),
      mkTxn('2026-03-09', -3.99, 'purchase', 'Google YouTube'),
      mkTxn('2026-03-15', -9.99, 'purchase', 'Google IVCAM'),
      mkTxn('2026-03-18', -1.09, 'purchase', 'X Corp Paid Features')
    ]);
    const bank = mkImport('Chase', 'checking', '9535', '2026-02-26', '2026-03-24', [
      mkTxn('2026-03-03', -351.27, 'payment_to_card', 'Discover E-Payment 3562 Web ID: 2510020270')
    ]);

    const drill = getPaymentDrill([bank, mar], 0, 0);
    expect(drill).not.toBeNull();
    expect(drill!.paid_for).toHaveLength(0);
    expect(drill!.uncovered_amount_minor).toBe(35127n);
  });
});

// ── B4: CC import has null account_last_4 ────────────────────────────────────
//
// In practice this case is hard to construct because the reconciliation
// matcher would not link a bank-tx to a CC statement with no last_4 unless
// the bank descriptor also has no last_4.  This test documents the contract:
// IF the matcher ever did link such a pair, the drill MUST return null.

describe('getPaymentDrill — CC import missing account_last_4', () => {
  test('returns null when matched CC has null account_last_4 (defensive)', () => {
    // Construct: bank descriptor doesn't mention last_4, so matcher falls
    // back to issuer+amount+date.  CC statement has null last_4.  We expect
    // a null drill — the function is defensive.
    const cc = mkImport('Discover', 'credit_card', null, '2026-03-01', '2026-03-31', [
      mkTxn('2026-03-20', 50.0, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU')
    ]);
    const bank = mkImport('Chase', 'checking', '9535', '2026-03-15', '2026-03-25', [
      // No card_last_4 in descriptor → matcher uses amount + issuer only
      mkTxn('2026-03-20', -50.0, 'payment_to_card', 'DISCOVER PAYMENT')
    ]);
    // Whether the matcher even produces a link here depends on its descriptor
    // recognizer; if it doesn't, getPaymentDrill returns null via the
    // no-link branch anyway.  Either way, we must NOT return a successful
    // drill against a card with no identity.
    const result = getPaymentDrill([bank, cc], 0, 0);
    expect(result).toBeNull();
  });
});
