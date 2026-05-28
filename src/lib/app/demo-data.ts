/**
 * One-click sample data so a new user (or the developer) can explore the app
 * before importing a real statement. Generates a PREVIOUS full month plus the
 * CURRENT month up to today (so the Home budget hero shows real days-left and a
 * daily pace), in the user's chosen currency. Clearly fake; "Clear all" wipes it.
 */
import { saveState, STORE_VERSION, type PersistedState } from '../db/store';
import { saveCategorization } from '../db/categorization-store';
import { getDisplayCurrency } from '../util/money';
import { today } from '../util/date';
import type { ParsedTransaction, TransactionType } from '../adapters/types';

const pad = (n: number): string => String(n).padStart(2, '0');

export async function loadDemoData(): Promise<void> {
  const currency = getDisplayCurrency();
  const inr = currency === 'INR';

  // Currency-appropriate round amounts (minor units / paise).
  const A = inr
    ? {
        salary: 5_000_000n,
        groc: 220_000n,
        gas: 180_000n,
        shop: 145_000n,
        rent: 1_500_000n,
        subs: 64_900n,
        food: 95_000n,
        coffee: 32_000n
      }
    : {
        salary: 350_000n,
        groc: 8_200n,
        gas: 4_800n,
        shop: 5_500n,
        rent: 150_000n,
        subs: 1_599n,
        food: 3_500n,
        coffee: 650n
      };

  const now = new Date();
  const dToday = now.getDate();
  const cur = { y: now.getFullYear(), m: now.getMonth() + 1 };
  const prev = now.getMonth() === 0 ? { y: cur.y - 1, m: 12 } : { y: cur.y, m: cur.m - 1 };
  const dt = (p: { y: number; m: number }, day: number): string => `${p.y}-${pad(p.m)}-${pad(day)}`;

  const tx = (
    posted_date: string,
    description: string,
    amount_minor: bigint,
    transaction_type: TransactionType
  ): ParsedTransaction => ({
    posted_date,
    description,
    raw_text: description,
    amount_minor,
    currency,
    transaction_type
  });

  // Locale-appropriate merchant strings so an INR user's sample data doesn't
  // look like an American's statement with a ₹ sprayed in front of it
  // (Bhargav round-5: "SWIGGY's the only Indian touch; everything else is
  // PAYROLL ACME / WHOLE FOODS / SHELL GAS — feels like a foreign app").
  const merchants = inr
    ? {
        salary: 'SALARY - INFOSYS',
        groc: 'BIGBASKET',
        gas: 'INDIAN OIL',
        shop: 'AMAZON.IN',
        rent: 'RENT - HSR LAYOUT',
        subs: 'NETFLIX',
        food: 'SWIGGY ORDER',
        coffee: 'CHAI POINT'
      }
    : {
        salary: 'PAYROLL - ACME CORP',
        groc: 'WHOLE FOODS',
        gas: 'SHELL GAS',
        shop: 'AMAZON MKTPL',
        rent: 'RENT - OAK APTS',
        subs: 'NETFLIX.COM',
        food: 'DOORDASH',
        coffee: 'STARBUCKS'
      };

  // Previous full month — gives the "vs last month" comparison something to show.
  const prevRows: ParsedTransaction[] = [
    tx(dt(prev, 1), merchants.salary, A.salary, 'deposit'),
    tx(dt(prev, 3), merchants.groc, -A.groc, 'purchase'),
    tx(dt(prev, 7), merchants.gas, -A.gas, 'purchase'),
    tx(dt(prev, 11), merchants.shop, -A.shop, 'purchase'),
    tx(dt(prev, 15), merchants.rent, -A.rent, 'purchase'),
    tx(dt(prev, 19), merchants.subs, -A.subs, 'purchase'),
    tx(dt(prev, 23), merchants.food, -A.food, 'purchase'),
    tx(dt(prev, 27), merchants.coffee, -A.coffee, 'purchase')
  ];

  // Current month up to today only (no future-dated spending).
  const curCandidates: Array<[number, string, bigint, TransactionType]> = [
    [1, merchants.salary, A.salary, 'deposit'],
    [2, merchants.groc, -A.groc, 'purchase'],
    [4, merchants.coffee, -A.coffee, 'purchase'],
    [6, merchants.gas, -A.gas, 'purchase'],
    [9, merchants.shop, -A.shop, 'purchase'],
    [12, merchants.food, -A.food, 'purchase'],
    [16, merchants.groc, -A.groc, 'purchase'],
    [20, merchants.rent, -A.rent, 'purchase'],
    [24, merchants.subs, -A.subs, 'purchase']
  ];
  const curRows = curCandidates
    .filter(([day]) => day <= dToday)
    .map(([day, desc, amt, type]) => tx(dt(cur, day), desc, amt, type));

  const transactions = [...prevRows, ...curRows];

  const state: PersistedState = {
    version: STORE_VERSION,
    imports: [
      {
        bank_name: 'Sample',
        adapter_name: 'demo',
        adapter_version: '0.0.0',
        pdf_source_hash: 'demo-chk',
        imported_at: new Date().toISOString(),
        statement: {
          account_type: 'checking',
          account_last_4: '0000',
          period_start: dt(prev, 1),
          period_end: today(),
          currency,
          opening_balance_minor: null,
          closing_balance_minor: null,
          total_debits_minor: null,
          total_credits_minor: null,
          previous_balance_minor: null,
          statement_balance_minor: null,
          printed_transaction_count: transactions.length,
          summary_lines: [],
          payment_due_date: null,
          statement_date: today(),
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

  // Auto-categorize by keyword so the demo shows populated categories.
  const ruleMap: Array<{ id: string; contains: string; category_id: string }> = [
    { id: 'r1', contains: 'WHOLE FOODS', category_id: 'groc' },
    { id: 'r2', contains: 'AMAZON', category_id: 'shop' },
    { id: 'r3', contains: 'SHELL', category_id: 'gas' },
    { id: 'r4', contains: 'RENT', category_id: 'rent' },
    { id: 'r5', contains: 'NETFLIX', category_id: 'subs' },
    { id: 'r6', contains: 'SWIGGY', category_id: 'food' },
    { id: 'r7', contains: 'STARBUCKS', category_id: 'food' }
  ];
  const annotations: Record<string, { category_id: string; source: 'rule'; rule_id: string }> = {};
  transactions.forEach((t, i) => {
    const r = ruleMap.find((rm) => t.description.toUpperCase().includes(rm.contains));
    if (r)
      annotations[`demo-chk#${i}`] = { category_id: r.category_id, source: 'rule', rule_id: r.id };
  });

  await saveCategorization({
    categories: [
      { id: 'groc', name: 'Groceries' },
      { id: 'shop', name: 'Shopping' },
      { id: 'gas', name: 'Gas' },
      { id: 'rent', name: 'Rent' },
      { id: 'subs', name: 'Subscriptions' },
      { id: 'food', name: 'Food & Drink' }
    ],
    rules: ruleMap.map((r) => ({ id: r.id, contains: r.contains, category_id: r.category_id })),
    annotations
  });
}
