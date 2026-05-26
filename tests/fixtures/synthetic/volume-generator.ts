// Volume-scale synthetic statement generator.
//
// Given a seed and a desired transaction count, produces a realistic
// ImportSuccess that exercises the unified-view filter, sort, and search
// at scales the user's real data won't reach for months.
//
// Realistic distribution (from docs/cc-statement-anatomy.md):
//   ~75% purchases (varied merchants, $1-$500)
//   ~10% refunds (some linked to a prior purchase, some unlinked)
//   ~ 5% payments (covering most of the prior balance)
//   ~ 5% interest / fees (one of each per cycle, max)
//   ~ 5% statement credits / cashback redemptions
//
// Determinism: a mulberry32 PRNG seeded with a number means identical
// output for identical seed.  Useful for stable test assertions.

import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';

/** Tiny deterministic PRNG.  Same seed → same sequence. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Merchant pool — chosen to span the kinds of strings real statements have:
// chains, local businesses, online services, subscription services, special
// characters, long names.
const MERCHANTS: Array<{ name: string; minAmount: number; maxAmount: number }> = [
  { name: 'AMAZON MKTPL', minAmount: 5, maxAmount: 350 },
  { name: 'WHOLE FOODS AUSTIN TX', minAmount: 15, maxAmount: 200 },
  { name: 'H-E-B #265 CEDAR PARK TX', minAmount: 10, maxAmount: 250 },
  { name: 'COSTCO WHSE #1152', minAmount: 30, maxAmount: 500 },
  { name: 'STARBUCKS - DOWNTOWN', minAmount: 4, maxAmount: 15 },
  { name: 'TARGET STORE 1234', minAmount: 10, maxAmount: 200 },
  { name: 'NETFLIX.COM', minAmount: 15.99, maxAmount: 15.99 },
  { name: 'SPOTIFY USA', minAmount: 9.99, maxAmount: 11.99 },
  { name: 'GOOGLE *YOUTUBE PREMIUM', minAmount: 13.99, maxAmount: 13.99 },
  { name: 'OPENAI *CHATGPT SUBSCR', minAmount: 20, maxAmount: 20 },
  { name: "TRADER JOE'S #42", minAmount: 12, maxAmount: 150 },
  { name: 'CHEVRON 0379302', minAmount: 25, maxAmount: 90 },
  { name: 'SHELL OIL', minAmount: 25, maxAmount: 90 },
  { name: 'UBER *EATS', minAmount: 12, maxAmount: 80 },
  { name: 'CAFÉ NOIR (PARIS)', minAmount: 8, maxAmount: 25 }, // unicode + parens
  { name: 'BARNES & NOBLE BOOKSELLERS', minAmount: 12, maxAmount: 60 }, // ampersand
  { name: 'PAYPAL|MERCHANT-INC', minAmount: 20, maxAmount: 500 }, // pipe
  { name: 'SQ *COFFEE SHOP', minAmount: 5, maxAmount: 20 }, // asterisk
  {
    name: 'THE INTERNATIONAL INSTITUTE OF VERY LONG MERCHANT NAMES ENTERPRISE EDITION LIMITED',
    minAmount: 100,
    maxAmount: 1000
  }, // very long
  { name: 'CINEMARK 242 RSTBAR', minAmount: 5, maxAmount: 40 },
  { name: 'ROSS STORES #1487', minAmount: 8, maxAmount: 200 },
  { name: 'AEROPOSTALE 0872', minAmount: 15, maxAmount: 100 }
];

interface GeneratorOptions {
  seed: number;
  bank_name: string;
  account_last_4: string;
  period_start: string; // ISO YYYY-MM-DD
  period_end: string; // ISO YYYY-MM-DD
  transaction_count: number;
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return (
    (Date.UTC(
      parseInt(b.slice(0, 4), 10),
      parseInt(b.slice(5, 7), 10) - 1,
      parseInt(b.slice(8, 10), 10)
    ) -
      Date.UTC(
        parseInt(a.slice(0, 4), 10),
        parseInt(a.slice(5, 7), 10) - 1,
        parseInt(a.slice(8, 10), 10)
      )) /
    86_400_000
  );
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  return arr[Math.min(idx, arr.length - 1)]!;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generate a realistic CC statement with the requested transaction count.
 * Distribution roughly matches what an active card with N charges per cycle
 * looks like.  All amounts and dates are deterministic given the seed.
 */
export function generateRealisticStatement(opts: GeneratorOptions): ImportSuccess {
  const rng = mulberry32(opts.seed);
  const cycleDays = daysBetween(opts.period_start, opts.period_end) + 1;
  const transactions: ParsedTransaction[] = [];
  const target = Math.max(0, opts.transaction_count);

  // Decide counts for each type given the target.
  const countPayment = Math.max(1, Math.round(target * 0.05));
  const countRefund = Math.max(0, Math.round(target * 0.1));
  const countFee = Math.min(Math.round(target * 0.02), 3); // cap fees at 3
  const countInterest = Math.min(Math.round(target * 0.02), 2);
  const countCredit = Math.round(target * 0.02);
  const countPurchase = Math.max(
    0,
    target - countPayment - countRefund - countFee - countInterest - countCredit
  );

  // Emit purchases sprinkled across the cycle.
  for (let i = 0; i < countPurchase; i++) {
    const day = Math.floor(rng() * cycleDays);
    const merchant = pick(rng, MERCHANTS);
    const amount = roundCents(
      merchant.minAmount + rng() * (merchant.maxAmount - merchant.minAmount)
    );
    transactions.push({
      posted_date: isoAddDays(opts.period_start, day),
      description: merchant.name,
      raw_text: merchant.name,
      amount_minor: BigInt(-Math.round(amount * 100)),
      currency: 'USD',
      transaction_type: 'purchase'
    });
  }

  // Refunds (some link to a real purchase, some don't).
  for (let i = 0; i < countRefund; i++) {
    const day = Math.floor(rng() * cycleDays);
    const linkToReal = rng() < 0.7 && transactions.length > 0;
    let description: string;
    let amountCents: number;
    if (linkToReal) {
      const original = transactions.find((t) => t.transaction_type === 'purchase');
      if (original) {
        const origAbs = Number(-original.amount_minor) / 100;
        const partial = rng() < 0.5;
        amountCents = Math.round((partial ? origAbs * (0.2 + rng() * 0.6) : origAbs) * 100);
        description = `${original.description} - REFUND`;
      } else {
        amountCents = Math.round((10 + rng() * 100) * 100);
        description = pick(rng, MERCHANTS).name + ' - REFUND';
      }
    } else {
      amountCents = Math.round((10 + rng() * 100) * 100);
      description = pick(rng, MERCHANTS).name + ' - REFUND';
    }
    transactions.push({
      posted_date: isoAddDays(opts.period_start, day),
      description,
      raw_text: description,
      amount_minor: BigInt(amountCents),
      currency: 'USD',
      transaction_type: 'refund'
    });
  }

  // Payments — typically one per cycle, large.
  for (let i = 0; i < countPayment; i++) {
    const day = Math.floor(rng() * cycleDays);
    const amount = Math.round((100 + rng() * 2000) * 100);
    transactions.push({
      posted_date: isoAddDays(opts.period_start, day),
      description: 'INTERNET PAYMENT - THANK YOU',
      raw_text: 'INTERNET PAYMENT - THANK YOU',
      amount_minor: BigInt(amount),
      currency: 'USD',
      transaction_type: 'payment_to_card'
    });
  }

  // Fees — capped at 3 per cycle in realistic distribution.
  const FEE_TYPES = ['ANNUAL MEMBERSHIP FEE', 'FOREIGN TRANSACTION FEE', 'LATE PAYMENT FEE'];
  for (let i = 0; i < countFee; i++) {
    const amount = roundCents(2 + rng() * 95);
    transactions.push({
      posted_date: isoAddDays(opts.period_start, cycleDays - 1),
      description: pick(rng, FEE_TYPES),
      raw_text: pick(rng, FEE_TYPES),
      amount_minor: BigInt(-Math.round(amount * 100)),
      currency: 'USD',
      transaction_type: 'fee'
    });
  }

  // Interest — at most 1-2 per cycle.
  for (let i = 0; i < countInterest; i++) {
    const amount = roundCents(1 + rng() * 50);
    transactions.push({
      posted_date: isoAddDays(opts.period_start, cycleDays - 1),
      description:
        i === 0
          ? 'INTEREST CHARGED ON PURCHASES (APR 24.99%)'
          : 'INTEREST CHARGED ON CASH ADVANCES (APR 29.99%)',
      raw_text: 'INTEREST CHARGED',
      amount_minor: BigInt(-Math.round(amount * 100)),
      currency: 'USD',
      transaction_type: 'interest'
    });
  }

  // Sort chronologically (the adapter pipeline does this naturally).
  transactions.sort((a, b) => a.posted_date.localeCompare(b.posted_date));

  // Compute synthetic previous_balance + new_balance from the transactions
  // (matches what an adapter parsing a real statement would extract).
  let net = 0n;
  for (const t of transactions) net += t.amount_minor;
  const previous_balance_minor = 0n;
  const statement_balance_minor = -net; // positive if owed (purchases > payments)

  const stmt: ParsedStatement = {
    account_type: 'credit_card',
    account_last_4: opts.account_last_4,
    period_start: opts.period_start,
    period_end: opts.period_end,
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor,
    statement_balance_minor,
    printed_transaction_count: transactions.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: opts.period_end,
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };

  return {
    ok: true,
    adapter_name: 'synthetic-volume',
    adapter_version: '0.0.0',
    bank_name: opts.bank_name,
    pdf_source_hash: `synthetic-vol-${opts.seed}-${opts.account_last_4}-${opts.period_end}`,
    statement: stmt,
    transactions,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

/**
 * Generate N statements across M cards spanning K months.  Useful for the
 * unified-view stress test ("how does the table feel at 5,000 rows?").
 */
export function generateMultiAccountVolume(opts: {
  seed: number;
  monthlyTransactionsPerAccount: number;
  accountCount: number;
  monthCount: number;
}): ImportSuccess[] {
  const out: ImportSuccess[] = [];
  for (let acctIdx = 0; acctIdx < opts.accountCount; acctIdx++) {
    const bank = ['Chase', 'Discover', 'Bank of America', 'American Express', 'Robinhood'][
      acctIdx % 5
    ]!;
    const last4 = String(1000 + acctIdx).padStart(4, '0');
    for (let monthIdx = 0; monthIdx < opts.monthCount; monthIdx++) {
      // Each month is a 30-day window starting from Jan 2026.
      const startBase = new Date(Date.UTC(2026, 0, 1));
      startBase.setUTCDate(startBase.getUTCDate() + monthIdx * 30);
      const period_start = startBase.toISOString().slice(0, 10);
      const period_end = isoAddDays(period_start, 29);
      out.push(
        generateRealisticStatement({
          seed: opts.seed + acctIdx * 1000 + monthIdx,
          bank_name: bank,
          account_last_4: last4,
          period_start,
          period_end,
          transaction_count: opts.monthlyTransactionsPerAccount
        })
      );
    }
  }
  return out;
}
