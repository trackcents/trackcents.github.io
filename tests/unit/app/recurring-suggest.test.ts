/**
 * Recurring suggestion (spec §7.5, §7.8) — detect bills + subscriptions by NAME +
 * repetition across months, never by amount.
 */
import { describe, expect, test } from 'vitest';
import { suggestRecurring } from '../../../src/lib/app/recurring-suggest';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { ParsedTransaction } from '../../../src/lib/adapters/types';

function txn(date: string, desc: string, cents: bigint): ParsedTransaction {
  return {
    posted_date: date,
    description: desc,
    raw_text: desc,
    amount_minor: cents,
    currency: 'USD',
    transaction_type: cents < 0n ? 'purchase' : 'deposit'
  };
}

function imp(
  hash: string,
  type: 'checking' | 'credit_card',
  txns: ParsedTransaction[]
): ImportRecord {
  return {
    bank_name: 'Chase',
    adapter_name: 'x',
    adapter_version: '0',
    pdf_source_hash: hash,
    imported_at: '2026-05-28T00:00:00Z',
    statement: {
      account_type: type,
      account_last_4: '0000',
      period_start: '2026-03-01',
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

const TODAY = '2026-06-01';

describe('suggestRecurring', () => {
  const bank = imp('bank', 'checking', [
    txn('2026-03-09', 'Pennymac Cash 8212879623-0010 Web ID: 1', -2100_00n),
    txn('2026-04-09', 'Pennymac Cash 8212879623-0011 Web ID: 1', -2741_56n), // mortgage, 2 months
    txn('2026-03-15', 'Vw Credit, Tel. Web Debit Pwbs1', -552_00n),
    txn('2026-04-15', 'Vw Credit, Tel. Web Debit Pwbs2', -552_00n), // car loan, 2 months
    txn('2026-03-22', 'T-Mobile Pcs Svc 9398708', -179_92n),
    txn('2026-04-22', 'T-Mobile Pcs Svc 9398709', -179_92n), // phone, 2 months
    txn('2026-03-20', 'COSTCO WHSE #1385', -108_15n),
    txn('2026-04-20', 'COSTCO WHSE #1385', -95_00n), // groceries — NOT a recurring bill pattern
    txn('2026-04-01', 'American Gen Lif Ins_Paymt', -52_14n) // insurance, ONLY ONE month
  ]);
  const card = imp('card', 'credit_card', [
    txn('2026-03-05', 'NETFLIX.COM 866-579-7172 CA', -15_49n),
    txn('2026-04-05', 'NETFLIX.COM 866-579-7172 CA', -15_49n) // subscription, 2 months
  ]);

  const sug = suggestRecurring([bank, card], {}, TODAY);
  const byName = (n: string) => sug.find((s) => s.name.toLowerCase().includes(n));

  test('detects the recurring bills + subscription by name', () => {
    expect(byName('pennymac')?.kind).toBe('bill');
    expect(byName('vw')?.kind).toBe('bill');
    expect(byName('mobile')?.kind).toBe('bill');
    expect(byName('netflix')?.kind).toBe('subscription');
  });

  test('uses the most recent amount', () => {
    expect(byName('pennymac')?.amount_minor).toBe(2741_56n); // April amount, not March
    expect(byName('netflix')?.amount_minor).toBe(15_49n);
  });

  test('does NOT suggest groceries (no recurring-bill pattern)', () => {
    expect(byName('costco')).toBeUndefined();
  });

  test('does NOT suggest a one-off (insurance seen only once)', () => {
    expect(byName('american')).toBeUndefined();
  });

  test('next due date is in the future', () => {
    for (const s of sug) expect(s.due_date >= TODAY).toBe(true);
  });

  test('an ignored charge is not counted', () => {
    const ann = { 'card#0': { category_id: null, source: 'manual' as const, ignored: true } };
    const s2 = suggestRecurring([bank, card], ann, TODAY);
    // Netflix now has only 1 (April) occurrence → drops below the 2-month threshold.
    expect(s2.find((s) => s.name.toLowerCase().includes('netflix'))).toBeUndefined();
  });
});
