/**
 * One-click demo data so a new user (or the developer) can explore the app
 * before importing a real statement. Writes a synthetic 3-month checking history
 * plus matching categories/rules into the local stores. Clearly fake; the
 * "Clear all" button wipes it like any other data.
 */
import { saveState, STORE_VERSION, type PersistedState } from '../db/store';
import { saveCategorization } from '../db/categorization-store';
import type { ParsedTransaction, TransactionType } from '../adapters/types';

function tx(
  posted_date: string,
  description: string,
  amount_minor: bigint,
  transaction_type: TransactionType
): ParsedTransaction {
  return {
    posted_date,
    description,
    raw_text: description,
    amount_minor,
    currency: 'USD',
    transaction_type
  };
}

export async function loadDemoData(): Promise<void> {
  const transactions: ParsedTransaction[] = [
    tx('2026-02-01', 'PAYROLL - ACME CORP', 320000n, 'deposit'),
    tx('2026-02-04', 'WHOLE FOODS AUSTIN TX', -8200n, 'purchase'),
    tx('2026-02-12', 'AMAZON MKTPL', -4500n, 'purchase'),
    tx('2026-02-25', 'PAYMENT TO BOFA CC', -80000n, 'payment_to_card'),
    tx('2026-03-01', 'PAYROLL - ACME CORP', 320000n, 'deposit'),
    tx('2026-03-06', 'WHOLE FOODS AUSTIN TX', -9100n, 'purchase'),
    tx('2026-03-09', 'SHELL GAS', -5200n, 'purchase'),
    tx('2026-03-18', 'AMAZON MKTPL', -6300n, 'purchase'),
    tx('2026-03-28', 'RENT - OAK APTS', -150000n, 'purchase'),
    tx('2026-04-01', 'PAYROLL - ACME CORP', 320000n, 'deposit'),
    tx('2026-04-07', 'WHOLE FOODS AUSTIN TX', -7700n, 'purchase'),
    tx('2026-04-15', 'SHELL GAS', -4800n, 'purchase'),
    tx('2026-04-22', 'NETFLIX.COM', -1599n, 'purchase')
  ];

  const state: PersistedState = {
    version: STORE_VERSION,
    imports: [
      {
        bank_name: 'Chase',
        adapter_name: 'demo',
        adapter_version: '0.0.0',
        pdf_source_hash: 'demo-chk',
        imported_at: new Date().toISOString(),
        statement: {
          account_type: 'checking',
          account_last_4: '9535',
          period_start: '2026-02-01',
          period_end: '2026-04-30',
          currency: 'USD',
          opening_balance_minor: null,
          closing_balance_minor: null,
          total_debits_minor: null,
          total_credits_minor: null,
          previous_balance_minor: null,
          statement_balance_minor: null,
          printed_transaction_count: transactions.length,
          summary_lines: [],
          payment_due_date: null,
          statement_date: '2026-04-30',
          minimum_payment_due_minor: null,
          parser_provides: ['A']
        },
        transactions,
        checksum_strategy_used: 'demo'
      }
    ],
    reconciliation_links: []
  };

  await saveState(state);

  const rule = (id: string, contains: string, category_id: string) => ({
    id,
    contains,
    category_id
  });
  const ann = (category_id: string, rule_id: string) => ({
    category_id,
    source: 'rule' as const,
    rule_id
  });
  await saveCategorization({
    categories: [
      { id: 'groc', name: 'Groceries' },
      { id: 'shop', name: 'Shopping' },
      { id: 'gas', name: 'Gas' },
      { id: 'rent', name: 'Rent' },
      { id: 'subs', name: 'Subscriptions' }
    ],
    rules: [
      rule('r1', 'WHOLE FOODS', 'groc'),
      rule('r2', 'AMAZON', 'shop'),
      rule('r3', 'SHELL', 'gas'),
      rule('r4', 'RENT', 'rent'),
      rule('r5', 'NETFLIX', 'subs')
    ],
    annotations: {
      'demo-chk#1': ann('groc', 'r1'),
      'demo-chk#2': ann('shop', 'r2'),
      'demo-chk#5': ann('groc', 'r1'),
      'demo-chk#6': ann('gas', 'r3'),
      'demo-chk#7': ann('shop', 'r2'),
      'demo-chk#8': ann('rent', 'r4'),
      'demo-chk#10': ann('groc', 'r1'),
      'demo-chk#11': ann('gas', 'r3'),
      'demo-chk#12': ann('subs', 'r5')
    }
  });
}
