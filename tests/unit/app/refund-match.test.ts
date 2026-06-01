/**
 * Refund ↔ purchase matching (spec 002-income-pockets §7.6 — returns).
 * Order-number + merchant matching, partial returns, multiple-vendor support.
 */
import { describe, expect, test } from 'vitest';
import {
  extractOrderRef,
  returnedByPurchase,
  suggestRefundLinks
} from '../../../src/lib/app/refund-match';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { ParsedTransaction } from '../../../src/lib/adapters/types';
import type { TransactionAnnotation } from '../../../src/lib/app/categorization';

function txn(date: string, desc: string, cents: bigint): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: cents,
    currency: 'USD',
    transaction_type: cents < 0n ? 'purchase' : 'refund'
  };
}

function cc(hash: string, txns: ParsedTransaction[]): ImportRecord {
  return {
    bank_name: 'Chase',
    adapter_name: 'layout-chase-credit-card',
    adapter_version: '0.2.0',
    pdf_source_hash: hash,
    imported_at: '2026-05-28T00:00:00Z',
    statement: {
      account_type: 'credit_card',
      account_last_4: '1797',
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
    transactions: txns
  };
}

describe('extractOrderRef', () => {
  test('Amazon order number', () => {
    expect(
      extractOrderRef('AMAZON MKTPLACE PMTS Amzn.com/bill WA (Order Number 114-2788003-1)')
    ).toBe('114-2788003-1');
  });
  test('CONF# reference', () => {
    expect(extractOrderRef('05/11 ONLINE/MOBILE PAYMENT CONF#25ri1myrc 4980')).toBe('25RI1MYRC');
  });
  test('no reference → null', () => {
    expect(extractOrderRef('ROSS STORES #1487 GEORGETOWN TX')).toBeNull();
  });
});

describe('suggestRefundLinks', () => {
  test('order-number match → high confidence (Amazon partial $120 of $300)', () => {
    const imp = cc('a', [
      txn('2026-05-02', 'AMAZON MKTPLACE PMTS WA (Order Number 114-2788003-1)', -300_00n), // #0 purchase
      txn('2026-05-20', 'AMAZON MKTPLACE PMTS WA (Order Number 114-2788003-1)', 120_00n) // #1 refund
    ]);
    const links = suggestRefundLinks([imp], {});
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      refundKey: 'a#1',
      purchaseKey: 'a#0',
      confidence: 'high',
      refundAmount: 120_00n,
      purchaseAmount: 300_00n
    });
  });

  test('same-merchant, no order ref → medium confidence (Ross full return)', () => {
    const imp = cc('r', [
      txn('2026-05-03', 'ROSS STORES #1487 GEORGETOWN TX', -84_37n),
      txn('2026-05-18', 'ROSS STORES #1487 GEORGETOWN TX', 84_37n)
    ]);
    const links = suggestRefundLinks([imp], {});
    expect(links).toHaveLength(1);
    expect(links[0]?.confidence).toBe('medium');
    expect(links[0]?.purchaseKey).toBe('r#0');
  });

  test('a refund larger than any purchase is not matched', () => {
    const imp = cc('x', [
      txn('2026-05-03', 'AMAZON MKTPLACE PMTS', -50_00n),
      txn('2026-05-18', 'AMAZON MKTPLACE PMTS', 200_00n) // bigger than the $50 buy
    ]);
    expect(suggestRefundLinks([imp], {})).toHaveLength(0);
  });

  test('a refund DATED BEFORE the purchase is not matched', () => {
    const imp = cc('y', [
      txn('2026-05-20', 'AMAZON MKTPLACE PMTS', -100_00n),
      txn('2026-05-03', 'AMAZON MKTPLACE PMTS', 40_00n) // refund before the buy
    ]);
    expect(suggestRefundLinks([imp], {})).toHaveLength(0);
  });

  test('different merchants do not match', () => {
    const imp = cc('z', [
      txn('2026-05-03', 'WALMART SUPERCENTER', -100_00n),
      txn('2026-05-18', 'TARGET STORE', 40_00n)
    ]);
    expect(suggestRefundLinks([imp], {})).toHaveLength(0);
  });

  test('an already-linked refund is not re-suggested', () => {
    const imp = cc('a', [
      txn('2026-05-02', 'AMAZON MKTPLACE PMTS (Order Number 114-2788003-1)', -300_00n),
      txn('2026-05-20', 'AMAZON MKTPLACE PMTS (Order Number 114-2788003-1)', 120_00n)
    ]);
    const ann: Record<string, TransactionAnnotation> = {
      'a#1': { category_id: null, source: 'manual', refund_of: 'a#0' }
    };
    expect(suggestRefundLinks([imp], ann)).toHaveLength(0);
  });

  test('picks the closest-amount purchase among several same-merchant buys', () => {
    const imp = cc('m', [
      txn('2026-05-01', 'AMAZON MKTPLACE PMTS', -300_00n), // #0
      txn('2026-05-02', 'AMAZON MKTPLACE PMTS', -130_00n), // #1 — closest to the $120 refund
      txn('2026-05-20', 'AMAZON MKTPLACE PMTS', 120_00n) // #2 refund
    ]);
    const links = suggestRefundLinks([imp], {});
    expect(links[0]?.purchaseKey).toBe('m#1');
  });
});

describe('returnedByPurchase — partials stack', () => {
  test('two linked partial refunds sum on the one purchase', () => {
    const imp = cc('p', [
      txn('2026-05-01', 'AMAZON MKTPLACE PMTS', -300_00n), // #0
      txn('2026-05-10', 'AMAZON MKTPLACE PMTS', 120_00n), // #1
      txn('2026-05-20', 'AMAZON MKTPLACE PMTS', 80_00n) // #2
    ]);
    const ann: Record<string, TransactionAnnotation> = {
      'p#1': { category_id: null, source: 'manual', refund_of: 'p#0' },
      'p#2': { category_id: null, source: 'manual', refund_of: 'p#0' }
    };
    const map = returnedByPurchase([imp], ann);
    expect(map.get('p#0')).toBe(200_00n); // $120 + $80 returned of the $300 buy
  });
});
