/**
 * Integration test for spendableFlowByMonth (REQ-B0.1).
 *
 * The exemplar: a synthetic month containing one real spend ($100 Costco), one
 * CC payment ($1000 to Robinhood card), one investment transfer ($5000 to
 * Robinhood Securities), one inter-account transfer ($200 to savings), one
 * salary ($3000) and one refund ($25 Costco return).
 *
 * Expected after spendableFlowByMonth:
 *   - outflow_minor = $100 − $25 = $75 (only the Costco purchase, refund nets)
 *   - inflow_minor  = $3000 (salary only — gift_in / cc_payment / transfer / investment excluded)
 *   - net_minor     = $3000 − $75 = $2925
 */
import { describe, expect, test } from 'vitest';
import { spendableFlowByMonth } from '../../../src/lib/app/categorization-glue';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { ParsedTransaction } from '../../../src/lib/adapters/types';

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

const checkingImport: ImportRecord = {
  bank_name: 'Chase',
  adapter_name: 'layout-chase-checking',
  adapter_version: '0.2.0',
  pdf_source_hash: 'hash-chase-may',
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
    txn('2026-05-08', 'Altera Corporati Payroll', 3000_00n, 'deposit'),
    txn('2026-05-10', 'Robinhood Card Payment', -1000_00n, 'payment_to_card'),
    txn(
      '2026-05-12',
      '05/10 Online Realtime Payment To Robinhood Securities',
      -5000_00n,
      'transfer'
    ),
    txn('2026-05-14', 'Kitsap CU Transfer 630515', -200_00n, 'transfer'),
    txn('2026-05-20', 'COSTCO WHSE #1385 GEORGETOWN TX', -100_00n, 'withdrawal'),
    txn('2026-05-25', 'CARD PURCHASE RETURN COSTCO', 25_00n, 'refund')
  ]
};

describe('spendableFlowByMonth — synthetic month with mixed intents', () => {
  test('Headline May spend is $75 (Costco − refund), not $6,300 (everything-out)', () => {
    const flow = spendableFlowByMonth([checkingImport], {});
    const may = flow.get('2026-05');
    expect(may).toBeDefined();
    expect(may!.outflow_minor).toBe(75_00n);
  });

  test('Headline May income is $3,000 (salary only), not $3,025 (incl. refund)', () => {
    const flow = spendableFlowByMonth([checkingImport], {});
    const may = flow.get('2026-05');
    expect(may!.inflow_minor).toBe(3000_00n);
  });

  test('Net is surplus, not the lying $5,425 deficit the old math produced', () => {
    const flow = spendableFlowByMonth([checkingImport], {});
    const may = flow.get('2026-05');
    expect(may!.net_minor).toBe(2925_00n);
    expect(may!.net_minor > 0n).toBe(true);
  });

  test('CC payments + investment + transfer are NOT in outflow_minor', () => {
    // Boundary: if I add the CC payment + investment + transfer ($6,200), the
    // outflow should NOT include any of them.
    const flow = spendableFlowByMonth([checkingImport], {});
    const may = flow.get('2026-05');
    // outflow_minor includes only the $100 purchase netted with $25 refund.
    expect(may!.outflow_minor).toBeLessThan(200_00n);
  });
});
