// Edge-case fixture library for credit-card statements.
//
// Each exported fixture is an ImportSuccess that exercises ONE edge case
// documented in docs/cc-statement-anatomy.md.  The library exists so that
// the FIFO drill, reconciliation matcher, unified-view filter, and parser
// regression tests can all assert correct behavior under conditions that
// real-world CC statements include but our user-supplied PDFs may never
// have hit.
//
// Per the project's synthetic-data strategy (see project memory and
// plan.md), we generate edge cases programmatically rather than asking
// the user for more real PDFs.  Source: research summarized in
// docs/cc-statement-anatomy.md (CFPB Reg Z + issuer documentation).

import type { ImportSuccess } from '../../../src/lib/app/import';
import type {
  AccountType,
  ParsedStatement,
  ParsedTransaction,
  TransactionType
} from '../../../src/lib/adapters/types';

// ── Shared builders ─────────────────────────────────────────────────────────

let hashCounter = 0;
function uniqueHash(label: string): string {
  hashCounter++;
  return `synthetic-${label}-${hashCounter.toString().padStart(4, '0')}`;
}

function dollarsToCents(d: number): bigint {
  return BigInt(Math.round(d * 100));
}

function mkTxn(
  posted_date: string,
  amount_dollars: number,
  type: TransactionType,
  description: string,
  currency = 'USD'
): ParsedTransaction {
  return {
    posted_date,
    description,
    raw_text: description,
    amount_minor: dollarsToCents(amount_dollars),
    currency,
    transaction_type: type
  };
}

function mkStatement(opts: {
  bank_name: string;
  account_type?: AccountType;
  account_last_4: string | null;
  period_start: string;
  period_end: string;
  previous_balance?: number;
  new_balance?: number;
  currency?: string;
  transactions: ParsedTransaction[];
  label: string;
}): ImportSuccess {
  const stmt: ParsedStatement = {
    account_type: opts.account_type ?? 'credit_card',
    account_last_4: opts.account_last_4,
    period_start: opts.period_start,
    period_end: opts.period_end,
    currency: opts.currency ?? 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor:
      opts.previous_balance !== undefined ? dollarsToCents(opts.previous_balance) : null,
    statement_balance_minor:
      opts.new_balance !== undefined ? dollarsToCents(opts.new_balance) : null,
    printed_transaction_count: opts.transactions.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: opts.period_end,
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };
  return {
    ok: true,
    adapter_name: `synthetic-${opts.label}`,
    adapter_version: '0.0.0',
    bank_name: opts.bank_name,
    pdf_source_hash: uniqueHash(opts.label),
    statement: stmt,
    transactions: opts.transactions,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

// ── 1. Refunds — partial, full, post-payment, unlinked ───────────────────────

export function partialRefund(): ImportSuccess {
  return mkStatement({
    bank_name: 'Discover',
    account_last_4: '0001',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 70,
    label: 'partial-refund',
    transactions: [
      mkTxn('2026-03-05', -100, 'purchase', 'AMAZON MKTPL - LARGE ITEM'),
      mkTxn('2026-03-15', 30, 'refund', 'AMAZON MKTPL - PARTIAL RETURN')
    ]
  });
}

export function fullRefund(): ImportSuccess {
  return mkStatement({
    bank_name: 'Discover',
    account_last_4: '0002',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 0,
    label: 'full-refund',
    transactions: [
      mkTxn('2026-03-05', -75.5, 'purchase', 'TARGET STORE 1234'),
      mkTxn('2026-03-12', 75.5, 'refund', 'TARGET STORE 1234 - REFUND')
    ]
  });
}

/** Refund AFTER the payment that cleared the original purchase creates a credit balance.
 *  This is a known FIFO-drill subtlety: the refund credits FUTURE charges. */
export function refundAfterPayment(): ImportSuccess {
  return mkStatement({
    bank_name: 'Discover',
    account_last_4: '0003',
    period_start: '2026-03-01',
    period_end: '2026-04-30',
    previous_balance: 0,
    new_balance: -50, // CREDIT balance — user has $50 of cushion
    label: 'refund-after-payment',
    transactions: [
      mkTxn('2026-03-05', -100, 'purchase', 'BEST BUY ELECTRONICS'),
      mkTxn('2026-03-20', 100, 'payment_to_card', 'INTERNET PAYMENT - THANK YOU'),
      mkTxn('2026-04-02', 50, 'refund', 'BEST BUY ELECTRONICS - PARTIAL REFUND')
    ]
  });
}

// ── 2. Year-boundary statements ──────────────────────────────────────────────

export function yearBoundary(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0004',
    period_start: '2025-12-28',
    period_end: '2026-01-27',
    previous_balance: 200,
    new_balance: 350,
    label: 'year-boundary',
    transactions: [
      mkTxn('2025-12-30', -50, 'purchase', 'NEW YEARS EVE DINNER'),
      mkTxn('2026-01-02', -100, 'purchase', 'JAN GROCERIES'),
      mkTxn('2026-01-15', 200, 'payment_to_card', 'PAYMENT - THANK YOU'),
      mkTxn('2026-01-20', -300, 'purchase', 'CAR SERVICE')
    ]
  });
}

// ── 3. Leap-year date ────────────────────────────────────────────────────────

export function leapYear(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0005',
    period_start: '2024-02-01',
    period_end: '2024-02-29',
    previous_balance: 0,
    new_balance: 25,
    label: 'leap-year',
    transactions: [mkTxn('2024-02-29', -25, 'purchase', 'LEAP DAY COFFEE STAND')]
  });
}

// ── 4. Foreign currency ──────────────────────────────────────────────────────

export function foreignCurrency(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0006',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 30.83,
    label: 'foreign-currency',
    transactions: [
      // Adapter records USD-equivalent only; original-currency goes in description.
      mkTxn(
        '2026-03-15',
        -27.13,
        'purchase',
        'CAFE DE FLORE PARIS FR (EUR 25.00 @ 1.0852 = USD 27.13)'
      ),
      mkTxn('2026-03-15', -2.7, 'fee', 'FOREIGN TRANSACTION FEE'),
      mkTxn(
        '2026-03-22',
        -1.0,
        'purchase',
        'JAPAN AIRLINES TOKYO JP (JPY 150 @ 0.00667 = USD 1.00)'
      )
    ]
  });
}

// ── 5. Credit balance (new_balance < 0) ──────────────────────────────────────

export function creditBalance(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0007',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 50,
    new_balance: -25,
    label: 'credit-balance',
    transactions: [mkTxn('2026-03-15', 75, 'payment_to_card', 'OVERPAYMENT')]
  });
}

// ── 6. Same-merchant duplicates (same day, same amount) ─────────────────────

export function sameMerchantDuplicates(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0008',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 15,
    label: 'same-merchant-duplicates',
    transactions: [
      mkTxn('2026-03-15', -5, 'purchase', 'STARBUCKS - DOWNTOWN'),
      mkTxn('2026-03-15', -5, 'purchase', 'STARBUCKS - DOWNTOWN'),
      mkTxn('2026-03-15', -5, 'purchase', 'STARBUCKS - DOWNTOWN')
    ]
  });
}

// ── 7. Multiple APR interest rows ────────────────────────────────────────────

export function multipleInterestRates(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0009',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 500,
    new_balance: 560,
    label: 'multiple-interest-rates',
    transactions: [
      mkTxn('2026-03-15', -50, 'purchase', 'AMAZON MKTPL'),
      mkTxn('2026-03-31', -5, 'interest', 'INTEREST CHARGED ON PURCHASES (APR 24.99%)'),
      mkTxn('2026-03-31', -3.5, 'interest', 'INTEREST CHARGED ON CASH ADVANCES (APR 29.99%)'),
      mkTxn('2026-03-31', -1.5, 'interest', 'INTEREST CHARGED ON BALANCE TRANSFERS (APR 0% PROMO)')
    ]
  });
}

// ── 8. Cash advance with associated fee ──────────────────────────────────────

export function cashAdvance(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0010',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 210,
    label: 'cash-advance',
    transactions: [
      mkTxn('2026-03-15', -200, 'purchase', 'ATM CASH ADVANCE - BANK OF AMERICA #1234'),
      mkTxn('2026-03-15', -10, 'fee', 'CASH ADVANCE FEE (5% OF $200)')
    ]
  });
}

// ── 9. Balance transfer with associated fee ──────────────────────────────────

export function balanceTransfer(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0011',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 3090,
    label: 'balance-transfer',
    transactions: [
      mkTxn('2026-03-10', -3000, 'transfer', 'BALANCE TRANSFER FROM CITI 1234'),
      mkTxn('2026-03-10', -90, 'fee', 'BALANCE TRANSFER FEE (3% OF $3,000)')
    ]
  });
}

// ── 10. All fee types in one statement ───────────────────────────────────────

export function allFeeTypes(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0012',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 218,
    label: 'all-fee-types',
    transactions: [
      mkTxn('2026-03-01', -95, 'fee', 'ANNUAL MEMBERSHIP FEE'),
      mkTxn('2026-03-12', -39, 'fee', 'LATE PAYMENT FEE'),
      mkTxn('2026-03-15', -2.7, 'fee', 'FOREIGN TRANSACTION FEE'),
      mkTxn('2026-03-18', -35, 'fee', 'OVER LIMIT FEE'),
      mkTxn('2026-03-22', -38, 'fee', 'RETURNED PAYMENT FEE'),
      mkTxn('2026-03-28', -8.3, 'fee', 'CASH ADVANCE FEE')
    ]
  });
}

// ── 11. Long merchant names (90+ chars) ──────────────────────────────────────

export function longMerchantName(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0013',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 200,
    label: 'long-merchant-name',
    transactions: [
      mkTxn(
        '2026-03-15',
        -150,
        'purchase',
        'THE INTERNATIONAL INSTITUTE OF VERY LONG MERCHANT NAMES ENTERPRISE EDITION LIMITED'
      ),
      mkTxn(
        '2026-03-22',
        -50,
        'purchase',
        'ANOTHER REALLY REALLY LONG NAME WITH NUMBERS 1234567890 AND PUNCTUATION!!!!!!'
      )
    ]
  });
}

// ── 12. Special characters in merchant names ─────────────────────────────────

export function specialCharsInMerchantName(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0014',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 65,
    label: 'special-chars',
    transactions: [
      mkTxn('2026-03-15', -10, 'purchase', 'CAFÉ NOIR (PARIS)'),
      mkTxn('2026-03-16', -20, 'purchase', "TRADER JOE'S #42"),
      mkTxn('2026-03-17', -15, 'purchase', 'BARNES & NOBLE BOOKSELLERS'),
      mkTxn('2026-03-18', -8, 'purchase', 'SQ *COFFEE SHOP'),
      mkTxn('2026-03-19', -12, 'purchase', 'PAYPAL|MERCHANT-INC')
    ]
  });
}

// ── 13. Very large + very small amounts ──────────────────────────────────────

export function extremeAmounts(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0015',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 9999.95,
    label: 'extreme-amounts',
    transactions: [
      mkTxn('2026-03-10', -0.01, 'purchase', 'TEST CHARGE'),
      mkTxn('2026-03-15', -9999.99, 'purchase', 'LUXURY APPLIANCE STORE'),
      mkTxn('2026-03-20', 0.05, 'refund', 'PRICE ADJUSTMENT')
    ]
  });
}

// ── 14. Statement credit (positive amount, not a payment) ────────────────────

export function statementCredit(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0016',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 70,
    label: 'statement-credit',
    transactions: [
      mkTxn('2026-03-05', -100, 'purchase', 'AMAZON MKTPL'),
      mkTxn('2026-03-15', 30, 'refund', 'CASHBACK REWARDS REDEMPTION — STATEMENT CREDIT')
    ]
  });
}

// ── 15. Disputed + reversal pair ─────────────────────────────────────────────

export function disputedTransaction(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0017',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 0,
    label: 'disputed',
    transactions: [
      mkTxn('2026-03-05', -250, 'purchase', 'MYSTERY MERCHANT - DISPUTED'),
      mkTxn('2026-03-20', 250, 'refund', 'DISPUTED CHARGE REVERSAL - REF 6970200001')
    ]
  });
}

// ── 16. Multi-line description (the airline itinerary pattern) ───────────────

export function multiLineDescription(): ImportSuccess {
  // After PDF.js extraction + adapter, this comes out as a single
  // joined-string description with internal whitespace.  We assert the
  // adapter doesn't lose any of the itinerary tokens.
  return mkStatement({
    bank_name: 'Robinhood',
    account_last_4: '0018',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 425,
    label: 'multi-line-desc',
    transactions: [
      mkTxn(
        '2026-03-15',
        -425,
        'purchase',
        'FRONTIER AIRLINES AUSTIN BOSTON AUSTIN ROUND TRIP CONFIRMATION ABC123'
      )
    ]
  });
}

// ── 17. Authorized user attribution ──────────────────────────────────────────

export function authorizedUser(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0019',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 250,
    label: 'authorized-user',
    transactions: [
      mkTxn('2026-03-10', -150, 'purchase', 'AMAZON MKTPL (PRIMARY CARDHOLDER)'),
      mkTxn('2026-03-12', -100, 'purchase', 'TARGET STORE 1234 (AUTH USER: J. DOE)')
    ]
  });
}

// ── 18. Zero-activity statement ──────────────────────────────────────────────

export function zeroActivity(): ImportSuccess {
  return mkStatement({
    bank_name: 'Chase',
    account_last_4: '0020',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    previous_balance: 0,
    new_balance: 0,
    label: 'zero-activity',
    transactions: []
  });
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const ALL_EDGE_CASES = {
  partialRefund,
  fullRefund,
  refundAfterPayment,
  yearBoundary,
  leapYear,
  foreignCurrency,
  creditBalance,
  sameMerchantDuplicates,
  multipleInterestRates,
  cashAdvance,
  balanceTransfer,
  allFeeTypes,
  longMerchantName,
  specialCharsInMerchantName,
  extremeAmounts,
  statementCredit,
  disputedTransaction,
  multiLineDescription,
  authorizedUser,
  zeroActivity
} as const;
