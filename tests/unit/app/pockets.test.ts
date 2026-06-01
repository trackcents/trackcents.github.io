/**
 * Income Pockets — per-pocket month math with carry-forward (spec
 * 002-income-pockets §2, §7.11, §7.12 slice 1-2).
 *
 * The math under test (signed, cumulative):
 *   carryIn(P,M)   = remaining(P, M-1)
 *   total(P,M)     = carryIn + newIncome(P,M)
 *   remaining(P,M) = total − used(P,M)
 *
 * Oracle independence: amounts are hand-computed in the test names, and a
 * conservation block cross-checks pockets against spendableFlowByMonth (a
 * separately-derived income/spend view) so the two cannot drift silently.
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_POCKETS,
  pocketIdForIntent,
  pocketSummariesForMonth,
  type PocketSummary
} from '../../../src/lib/app/pockets';
import { spendableFlowByMonth } from '../../../src/lib/app/categorization-glue';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { ParsedTransaction } from '../../../src/lib/adapters/types';
import type { TransactionAnnotation } from '../../../src/lib/app/categorization';

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

/** A minimal checking-account import for `hash` over `[start,end]` with `txns`. */
function checking(
  hash: string,
  start: string,
  end: string,
  txns: ParsedTransaction[]
): ImportRecord {
  return {
    bank_name: 'Chase',
    adapter_name: 'layout-chase-checking',
    adapter_version: '0.2.0',
    pdf_source_hash: hash,
    imported_at: `${end}T00:00:00Z`,
    statement: {
      account_type: 'checking',
      account_last_4: '9535',
      period_start: start,
      period_end: end,
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

/** Pull one pocket's summary out of the result array by id. */
function pocket(summaries: PocketSummary[], id: string): PocketSummary {
  const s = summaries.find((p) => p.pocket.id === id);
  if (s === undefined) throw new Error(`no pocket ${id}`);
  return s;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// May: salary $3,000 → Paychecks; a $100 Costco purchase − $25 refund (default
// Paychecks); a $500 Zelle gift → Extra.
const may = checking('may', '2026-05-01', '2026-05-31', [
  txn('2026-05-08', 'Altera Corporati Payroll', 3000_00n, 'deposit'),
  txn('2026-05-20', 'COSTCO WHSE #1385 GEORGETOWN TX', -100_00n, 'withdrawal'),
  txn('2026-05-25', 'CARD PURCHASE RETURN COSTCO', 25_00n, 'refund'),
  txn('2026-05-15', 'Zelle Payment From Friend', 500_00n, 'deposit')
]);

// June: salary $3,000 → Paychecks; a $500 purchase (default Paychecks); a $300
// "India" payment marked paid_from = Extra.
const jun = checking('jun', '2026-06-01', '2026-06-30', [
  txn('2026-06-08', 'Altera Corporati Payroll', 3000_00n, 'deposit'),
  txn('2026-06-12', 'COSTCO WHSE #1385', -500_00n, 'withdrawal'),
  txn('2026-06-20', 'Wire To India', -300_00n, 'withdrawal')
]);

const junIndiaFromExtra: Record<string, TransactionAnnotation> = {
  'jun#2': { category_id: null, source: 'manual', paid_from: 'extra' }
};

describe('pocketIdForIntent — income routes by intent, never amount', () => {
  test('salary → Paychecks', () => {
    expect(pocketIdForIntent('salary')).toBe('paychecks');
  });
  test('gift_in / interest_earned / cash_in → Extra', () => {
    expect(pocketIdForIntent('gift_in')).toBe('extra');
    expect(pocketIdForIntent('interest_earned')).toBe('extra');
    expect(pocketIdForIntent('cash_in')).toBe('extra');
  });
  test('non-income intents fill no pocket', () => {
    expect(pocketIdForIntent('purchase')).toBeNull();
    expect(pocketIdForIntent('cc_payment')).toBeNull();
    expect(pocketIdForIntent('transfer_self')).toBeNull();
  });
});

describe('DEFAULT_POCKETS', () => {
  test('ships 💵 Paychecks, 🎁 Extra, 💰 Savings', () => {
    expect(DEFAULT_POCKETS.map((p) => p.id)).toEqual(['paychecks', 'extra', 'savings']);
    expect(DEFAULT_POCKETS[0]!.logo).toBe('💵');
    expect(DEFAULT_POCKETS[1]!.logo).toBe('🎁');
    expect(DEFAULT_POCKETS[2]!.logo).toBe('💰');
  });
  test('Savings is never auto-filled by a flow-intent', () => {
    // income only reaches Savings when the user moves it there.
    expect(pocketIdForIntent('salary')).not.toBe('savings');
    expect(pocketIdForIntent('gift_in')).not.toBe('savings');
  });
});

describe('single month — no carry-in', () => {
  const sums = pocketSummariesForMonth([may], {}, '2026-05', DEFAULT_POCKETS);

  test('Paychecks: income $3,000, used $75 (100−25 refund), remaining $2,925', () => {
    const p = pocket(sums, 'paychecks');
    expect(p.carryIn).toBe(0n);
    expect(p.newIncome).toBe(3000_00n);
    expect(p.total).toBe(3000_00n);
    expect(p.used).toBe(75_00n);
    expect(p.remaining).toBe(2925_00n);
  });

  test('Extra: the $500 Zelle gift lands here, nothing used yet', () => {
    const p = pocket(sums, 'extra');
    expect(p.newIncome).toBe(500_00n);
    expect(p.used).toBe(0n);
    expect(p.remaining).toBe(500_00n);
  });

  test('pctUsed reflects used/total (50% on a clean 1000/500 pocket)', () => {
    const half = checking('h', '2026-05-01', '2026-05-31', [
      txn('2026-05-01', 'Altera Corporati Payroll', 1000_00n, 'deposit'),
      txn('2026-05-10', 'COSTCO', -500_00n, 'withdrawal')
    ]);
    const p = pocket(pocketSummariesForMonth([half], {}, '2026-05', DEFAULT_POCKETS), 'paychecks');
    expect(p.pctUsed).toBe(50);
  });
});

describe('carry-forward (+) — remaining rolls into the SAME pocket next month', () => {
  const sums = pocketSummariesForMonth([may, jun], {}, '2026-06', DEFAULT_POCKETS);

  test('Paychecks June: carryIn $2,925, +new $3,000, used $800, remaining $5,125', () => {
    const p = pocket(sums, 'paychecks');
    expect(p.carryIn).toBe(2925_00n); // May remaining (3000 − 75)
    expect(p.newIncome).toBe(3000_00n);
    expect(p.total).toBe(5925_00n);
    // Both June draws default to Paychecks ($500 Costco + $300 India) = $800.
    expect(p.used).toBe(800_00n);
    expect(p.remaining).toBe(5125_00n);
  });

  test('Extra June: carryIn $500 (May gift), no new income, used $0 → unchanged', () => {
    const p = pocket(sums, 'extra');
    expect(p.carryIn).toBe(500_00n);
    expect(p.newIncome).toBe(0n);
    expect(p.used).toBe(0n);
    expect(p.remaining).toBe(500_00n);
  });

  test('paid_from = Extra routes the $300 India draw to Extra, not Paychecks', () => {
    const withRoute = pocketSummariesForMonth(
      [may, jun],
      junIndiaFromExtra,
      '2026-06',
      DEFAULT_POCKETS
    );
    expect(pocket(withRoute, 'extra').used).toBe(300_00n);
    expect(pocket(withRoute, 'extra').remaining).toBe(200_00n); // 500 carry − 300
    // Paychecks no longer carries the India draw → used drops to the $500 purchase.
    expect(pocket(withRoute, 'paychecks').used).toBe(500_00n);
  });
});

describe('carry-forward (−) — an overspent pocket starts next month in the red', () => {
  const tightMay = checking('tm', '2026-05-01', '2026-05-31', [
    txn('2026-05-08', 'Altera Corporati Payroll', 1000_00n, 'deposit'),
    txn('2026-05-20', 'COSTCO', -1050_00n, 'withdrawal')
  ]);
  const tightJun = checking('tj', '2026-06-01', '2026-06-30', [
    txn('2026-06-08', 'Altera Corporati Payroll', 1000_00n, 'deposit')
  ]);

  test('May ends at −$50 (remaining negative, allowed)', () => {
    const p = pocket(
      pocketSummariesForMonth([tightMay], {}, '2026-05', DEFAULT_POCKETS),
      'paychecks'
    );
    expect(p.remaining).toBe(-50_00n);
  });

  test('June starts at carryIn −$50; +$1,000 new → remaining $950', () => {
    const p = pocket(
      pocketSummariesForMonth([tightMay, tightJun], {}, '2026-06', DEFAULT_POCKETS),
      'paychecks'
    );
    expect(p.carryIn).toBe(-50_00n);
    expect(p.total).toBe(950_00n);
    expect(p.remaining).toBe(950_00n);
  });

  test('an over-used pocket reports pctUsed > 100', () => {
    const p = pocket(
      pocketSummariesForMonth([tightMay], {}, '2026-05', DEFAULT_POCKETS),
      'paychecks'
    );
    expect(p.pctUsed).toBeGreaterThan(100);
  });
});

describe('split routing on the funding side', () => {
  test('income cap: salary split → $2,000 salary (Paychecks) + $1,000 investment_out (no pocket)', () => {
    const capped: Record<string, TransactionAnnotation> = {
      'may#0': {
        category_id: null,
        source: 'manual',
        split: [
          { category_id: null, amount_minor: 2000_00n },
          { category_id: null, amount_minor: 1000_00n, flow_intent: 'investment_out' }
        ]
      }
    };
    const p = pocket(
      pocketSummariesForMonth([may], capped, '2026-05', DEFAULT_POCKETS),
      'paychecks'
    );
    expect(p.newIncome).toBe(2000_00n); // only the capped part fills Paychecks
  });

  test('category split of a spend draws the FULL magnitude from one paid_from pocket', () => {
    const splitSpend: Record<string, TransactionAnnotation> = {
      'jun#1': {
        category_id: null,
        source: 'manual',
        split: [
          { category_id: 'groceries', amount_minor: -300_00n },
          { category_id: 'household', amount_minor: -200_00n }
        ]
      }
    };
    const p = pocket(
      pocketSummariesForMonth([jun], splitSpend, '2026-06', DEFAULT_POCKETS),
      'paychecks'
    );
    // $500 purchase (split 300+200) + $300 India default-paychecks = $800 used.
    expect(p.used).toBe(800_00n);
  });
});

describe('exclusions', () => {
  test('an ignored transaction touches no pocket', () => {
    const simple = checking('ign', '2026-05-01', '2026-05-31', [
      txn('2026-05-08', 'Altera Corporati Payroll', 1000_00n, 'deposit'),
      txn('2026-05-20', 'COSTCO', -100_00n, 'withdrawal')
    ]);
    const ignored: Record<string, TransactionAnnotation> = {
      'ign#1': { category_id: null, source: 'manual', ignored: true }
    };
    const p = pocket(
      pocketSummariesForMonth([simple], ignored, '2026-05', DEFAULT_POCKETS),
      'paychecks'
    );
    expect(p.used).toBe(0n); // the $100 purchase is ignored → nothing drawn
  });

  test('money-movement (cc_payment) is neither income nor a draw', () => {
    const ccImp = checking('cc', '2026-05-01', '2026-05-31', [
      txn('2026-05-10', 'Robinhood Card Payment', -1000_00n, 'payment_to_card')
    ]);
    const p = pocket(pocketSummariesForMonth([ccImp], {}, '2026-05', DEFAULT_POCKETS), 'paychecks');
    expect(p.used).toBe(0n);
    expect(p.newIncome).toBe(0n);
  });

  test('a future month is not counted', () => {
    const sums = pocketSummariesForMonth([jun], {}, '2026-05', DEFAULT_POCKETS);
    expect(pocket(sums, 'paychecks').total).toBe(0n);
  });
});

describe('robustness', () => {
  test('paid_from naming a missing pocket falls back to the first pocket', () => {
    const ghost: Record<string, TransactionAnnotation> = {
      'jun#1': { category_id: null, source: 'manual', paid_from: 'does-not-exist' }
    };
    const sums = pocketSummariesForMonth([jun], ghost, '2026-06', DEFAULT_POCKETS);
    // The $500 + $300 draws both land on Paychecks (first pocket) — money is never lost.
    expect(pocket(sums, 'paychecks').used).toBe(800_00n);
  });

  test('an empty pocket list falls back to DEFAULT_POCKETS (no crash, no lost money)', () => {
    const sums = pocketSummariesForMonth([may], {}, '2026-05', []);
    expect(sums.map((s) => s.pocket.id)).toEqual(['paychecks', 'extra', 'savings']);
  });
});

describe('CONSERVATION — pockets reconcile with spendableFlowByMonth', () => {
  test('Σ newIncome across pockets == headline income for the month', () => {
    const sums = pocketSummariesForMonth([may], {}, '2026-05', DEFAULT_POCKETS);
    const pocketsIncome = sums.reduce((s, p) => s + p.newIncome, 0n);
    const headline = spendableFlowByMonth([may], {}).get('2026-05')!.inflow_minor;
    expect(pocketsIncome).toBe(headline); // 3000 + 500 == 3500
  });

  test('Σ used across pockets == headline outflow (refund-netted) for the month', () => {
    const sums = pocketSummariesForMonth([may], {}, '2026-05', DEFAULT_POCKETS);
    const pocketsUsed = sums.reduce((s, p) => s + p.used, 0n);
    const headline = spendableFlowByMonth([may], {}).get('2026-05')!.outflow_minor;
    expect(pocketsUsed).toBe(headline); // 100 − 25 == 75
  });
});
