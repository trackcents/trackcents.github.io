// ─────────────────────────────────────────────────────────────────────────
// VERIF-KIT STAGED-FLOW RE-VALIDATION STUDY (quarantine dir — NOT promoted)
//
// Goal: prove the cheap Stage-1 method (independent spec reasoning + a handful
// of targeted boundary/metamorphic/adversarial probes) re-catches the SAME four
// real bugs the old heavy IV&V run (thousands of constrained-random cases +
// mutation, ~20-30 min/module) caught — in a fraction of the time.
//
// METHODOLOGY CAVEAT (honest): this is a methodology study, NOT an
// independence-preserving verification run. The buggy variants below were
// reconstructed by reading the CURRENT (fixed) source. The PROBES, however, are
// derived from the implementation-free contracts in
// specs/001-money-tracker-mvp/verification/ (the relation each probe asserts is
// the spec invariant, not anything read from source). So the probes are
// spec-driven even though the buggy reconstructions are source-driven.
//
// For each bug we assert the SAME single Stage-1 probe against BOTH:
//   - a BUGGY reconstruction (must FAIL the probe), and
//   - the REAL fixed function imported from src/ (must PASS the probe).
// ─────────────────────────────────────────────────────────────────────────

import { describe, test, expect } from 'vitest';

// Real (fixed) functions under test.
import { merchantTrends as merchantTrendsFixed } from '../../../src/lib/app/merchant-trends';
import {
  buildCardStreams as buildCardStreamsFixed,
  cardKeyString as cardKeyStringFixed,
  computeFifoAttributions,
  unpaidBalanceAfter
} from '../../../src/lib/app/transaction-stream';
import { reconcileImports as reconcileImportsFixed } from '../../../src/lib/app/reconciliation';
import type {
  ParsedTransaction,
  ParsedStatement,
  AccountType
} from '../../../src/lib/adapters/types';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ImportedStatement } from '../../../src/lib/app/reconciliation';

// ═══════════════════════════════════════════════════════════════════════════
// BUG 1 — merchant-trends: same-day ordering determinism
//   Contract merchant-trends.contract.md INV4 (permutation invariance) + R5
//   (within-merchant ordering). Buggy: sort by posted_date ONLY (stable), so
//   same-day charges keep import order → last/previous/jump depend on import
//   order. Stage-1 catch: metamorphic permutation probe.
// ═══════════════════════════════════════════════════════════════════════════

interface MTxn {
  posted_date: string;
  amount_minor: bigint;
  description: string;
}

// BUGGY reconstruction: only the same-day tiebreak is removed (date-only sort).
function merchantTrendsBuggy(txns: readonly MTxn[]): { last_amount_minor: bigint }[] {
  const groups = new Map<string, MTxn[]>();
  for (const t of txns) {
    if (t.amount_minor >= 0n) continue;
    // normalizeDescriptor is not the bug; group on raw description for this probe
    const key = t.description;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [t]);
    else g.push(t);
  }
  const out: { last_amount_minor: bigint }[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // BUG: posted_date only, stable sort preserves import order on same-day ties.
    const sorted = [...group].sort((a, b) =>
      a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : 0
    );
    const last = sorted[sorted.length - 1]!;
    out.push({ last_amount_minor: last.amount_minor < 0n ? -last.amount_minor : last.amount_minor });
  }
  return out;
}

describe('BUG1 merchant-trends — same-day ordering determinism (INV4 permutation)', () => {
  // Two same-day charges of DIFFERENT magnitude for one merchant. A correct
  // module imposes a total order on same-day ties, so "last_amount_minor" is
  // identical regardless of import order. The buggy date-only sort lets
  // last_amount_minor flip with import order.
  const a: MTxn = { posted_date: '2026-02-01', amount_minor: -1599n, description: 'NETFLIX' };
  const b: MTxn = { posted_date: '2026-02-01', amount_minor: -1799n, description: 'NETFLIX' };

  test('BUGGY: same data in two import orders yields DIFFERENT last_amount → fails permutation', () => {
    const order1 = merchantTrendsBuggy([a, b]);
    const order2 = merchantTrendsBuggy([b, a]);
    // The probe ASSERTS the invariant should hold; we show it does NOT on buggy.
    expect(order1[0]!.last_amount_minor).not.toEqual(order2[0]!.last_amount_minor);
  });

  test('FIXED: same data in two import orders yields IDENTICAL trends', () => {
    const order1 = merchantTrendsFixed([a, b]);
    const order2 = merchantTrendsFixed([b, a]);
    expect(order1).toEqual(order2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG 2 — transaction-stream D19: same-day attribution order
//   Contract transaction-stream.contract.md R6 + INV7. Buggy: buildCardStreams
//   sorts by posted_date ONLY; a same-day purchase −$50 + payment +$50 keeps
//   input order. If payment lands before purchase in the stream, it can't
//   cover it → balance flips with import order. Stage-1 catch: metamorphic
//   permutation — both input orders → balance 0, payment covers purchase.
// ═══════════════════════════════════════════════════════════════════════════

function ccImport(
  bankName: string,
  last4: string | null,
  periodStart: string,
  periodEnd: string,
  txns: ParsedTransaction[],
  accountType: AccountType = 'credit_card'
): ImportSuccess {
  const statement: ParsedStatement = {
    account_type: accountType,
    account_last_4: last4,
    period_start: periodStart,
    period_end: periodEnd,
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
    statement_date: periodEnd,
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name: bankName,
    pdf_source_hash: `hash-${bankName}-${last4}-${periodEnd}-${Math.random()}`,
    statement,
    transactions: txns,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  } as unknown as ImportSuccess;
}

const purchase50: ParsedTransaction = {
  posted_date: '2026-02-01',
  description: 'STORE',
  raw_text: 'STORE',
  amount_minor: -5000n,
  currency: 'USD',
  transaction_type: 'purchase'
};
const payment50: ParsedTransaction = {
  posted_date: '2026-02-01',
  description: 'PAYMENT',
  raw_text: 'PAYMENT',
  amount_minor: 5000n,
  currency: 'USD',
  transaction_type: 'payment_to_card'
};

// BUGGY reconstruction of buildCardStreams: date-only sort (no sameDayRank).
function buildStreamBuggy(txns: ParsedTransaction[]) {
  const sorted = [...txns]
    .map((txn, i) => ({ import_index: 0, transaction_index: i, txn }))
    .sort((a, b) =>
      a.txn.posted_date < b.txn.posted_date ? -1 : a.txn.posted_date > b.txn.posted_date ? 1 : 0
    );
  return { key: { bank_name: 'X', account_last_4: '1111' }, transactions: sorted };
}

describe('BUG2 transaction-stream D19 — same-day attribution order (R6/INV7)', () => {
  test('BUGGY: balance after same-day {purchase,payment} DEPENDS on import order (violates INV7)', () => {
    const balPurchaseFirst = unpaidBalanceAfter(buildStreamBuggy([purchase50, payment50]));
    const balPaymentFirst = unpaidBalanceAfter(buildStreamBuggy([payment50, purchase50]));
    // The Stage-1 metamorphic probe is "balance must be identical (and 0) in both
    // import orders". On the buggy date-only sort the two orders DISAGREE — when
    // the payment is imported first it sorts first and can't cover the purchase,
    // so balance is 5000n instead of 0n. We assert the violation directly so this
    // self-checking artifact passes by CONFIRMING the bug is present.
    expect(balPurchaseFirst).toBe(0n); // purchase-first happens to work
    expect(balPaymentFirst).toBe(5000n); // payment-first leaks the import order → BUG
    expect(balPurchaseFirst).not.toBe(balPaymentFirst); // INV7 permutation invariance VIOLATED
  });

  test('FIXED: balance is 0 and payment covers purchase in BOTH import orders', () => {
    const s1 = buildCardStreamsFixed([ccImport('X', '1111', '2026-01-01', '2026-02-28', [purchase50, payment50])]);
    const s2 = buildCardStreamsFixed([ccImport('X', '1111', '2026-01-01', '2026-02-28', [payment50, purchase50])]);
    const st1 = [...s1.values()][0]!;
    const st2 = [...s2.values()][0]!;
    expect(unpaidBalanceAfter(st1)).toBe(0n);
    expect(unpaidBalanceAfter(st2)).toBe(0n);
    // And the payment actually covers the purchase (full $50) in both orders.
    const cov = (st: typeof st1) => {
      const at = computeFifoAttributions(st);
      return at[0]?.paid_for.reduce((s, p) => s + p.covered_amount_minor, 0n) ?? 0n;
    };
    expect(cov(st1)).toBe(5000n);
    expect(cov(st2)).toBe(5000n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG 3 — transaction-stream D20: cardKeyString collision
//   Contract transaction-stream.contract.md R1 (injectivity: distinct card
//   identities → distinct keys). Buggy: `${bank_name}::${account_last_4}`.
//   Stage-1 catch: adversarial injectivity probe — {'', ':'} and {':', ''}
//   both map to ':::' under the buggy encoding.
// ═══════════════════════════════════════════════════════════════════════════

function cardKeyStringBuggy(k: { bank_name: string; account_last_4: string }): string {
  return `${k.bank_name}::${k.account_last_4}`;
}

describe('BUG3 transaction-stream D20 — cardKeyString injectivity (R1)', () => {
  const cardA = { bank_name: '', account_last_4: ':' };
  const cardB = { bank_name: ':', account_last_4: '' };

  test('BUGGY: two DISTINCT card identities collide to the same key', () => {
    // Probe asserts distinct identities → distinct keys; buggy violates it.
    expect(cardKeyStringBuggy(cardA)).toBe(cardKeyStringBuggy(cardB)); // both ':::'
  });

  test('FIXED: two distinct card identities map to DISTINCT keys', () => {
    expect(cardKeyStringFixed(cardA)).not.toBe(cardKeyStringFixed(cardB));
    // sanity: equal identities still collapse (the legitimate merge)
    expect(cardKeyStringFixed(cardA)).toBe(cardKeyStringFixed({ bank_name: '', account_last_4: ':' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG 4 — reconciliation D22: statement-level vs row-level ambiguity
//   Contract reconciliation.contract.md R7 + INV5 (anti-false-positive).
//   Buggy: matching CC row found via findIndex (first match only), so two
//   equal-amount payment rows in ONE statement collapse to a single match →
//   emits a link instead of staying silent. Stage-1 catch: one directed
//   ambiguity test — two equal payment rows in one statement ⇒ expect 0 links.
// ═══════════════════════════════════════════════════════════════════════════

function bankTxn(amount: bigint, desc: string): ParsedTransaction {
  return {
    posted_date: '2026-03-03',
    description: desc,
    raw_text: desc,
    amount_minor: amount,
    currency: 'USD',
    transaction_type: 'payment_to_card'
  };
}
function ccPaymentRow(amount: bigint): ParsedTransaction {
  return {
    posted_date: '2026-03-01',
    description: 'PAYMENT RECEIVED',
    raw_text: 'PAYMENT RECEIVED',
    amount_minor: amount,
    currency: 'USD',
    transaction_type: 'payment_to_card'
  };
}
function stmt(
  accountType: AccountType,
  bankName: string,
  last4: string | null,
  periodEnd: string,
  txns: ParsedTransaction[]
): ImportedStatement {
  return {
    statement: {
      account_type: accountType,
      account_last_4: last4,
      period_start: '2026-02-01',
      period_end: periodEnd,
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
      statement_date: periodEnd,
      minimum_payment_due_minor: null,
      parser_provides: ['C']
    },
    transactions: txns,
    bank_name: bankName,
    adapter_name: 'test',
    pdf_source_hash: `h-${bankName}-${last4}-${periodEnd}`
  };
}

// BUGGY reconstruction: findIndex (first match only) → statement-level match.
function reconcileBuggy(imports: ImportedStatement[]): number {
  // Returns NUMBER OF LINKS (we only need the count for the ambiguity probe).
  let links = 0;
  const absMinor = (v: bigint) => (v < 0n ? -v : v);
  const ccIndices: number[] = [];
  imports.forEach((imp, idx) => {
    if (imp.statement.account_type === 'credit_card') ccIndices.push(idx);
  });
  imports.forEach((bankImp) => {
    if (bankImp.statement.account_type === 'credit_card') return;
    bankImp.transactions.forEach((tx) => {
      if (tx.transaction_type !== 'payment_to_card') return;
      // We construct descriptors that detectCardPayment recognizes (Chase + last4).
      const bankAbs = absMinor(tx.amount_minor);
      const matches: number[] = [];
      for (const ccIdx of ccIndices) {
        const ccImp = imports[ccIdx]!;
        // BUG: findIndex collapses multiple equal rows in ONE statement to ONE match.
        const rowIdx = ccImp.transactions.findIndex(
          (ccTx) =>
            ccTx.transaction_type === 'payment_to_card' && absMinor(ccTx.amount_minor) === bankAbs
        );
        if (rowIdx !== -1) matches.push(ccIdx);
      }
      if (matches.length === 1) links++;
    });
  });
  return links;
}

describe('BUG4 reconciliation D22 — row-level ambiguity (R7/INV5 anti-false-positive)', () => {
  // ONE CC statement (Chase, last-4 1797) containing TWO equal $800 payment
  // rows; one bank payment of $800 with a Chase descriptor carrying last-4.
  // Two distinct CC rows match → genuinely ambiguous → MUST emit 0 links.
  const bank = stmt('checking', 'Chase Bank', '0001', '2026-03-05', [
    bankTxn(-80000n, 'Payment To Chase Card Ending IN 1797')
  ]);
  const cc = stmt('credit_card', 'Chase', '1797', '2026-02-28', [
    ccPaymentRow(80000n),
    ccPaymentRow(80000n)
  ]);

  test('BUGGY: two equal payment rows in ONE statement collapse → emits 1 link (should be 0)', () => {
    const linkCount = reconcileBuggy([bank, cc]);
    expect(linkCount).toBe(1); // buggy emits a link — VIOLATES INV5
  });

  test('FIXED: two equal payment rows in one statement ⇒ ambiguous ⇒ 0 links', () => {
    const links = reconcileImportsFixed([bank, cc]);
    expect(links.length).toBe(0);
  });

  test('FIXED control: a SINGLE matching CC row ⇒ exactly 1 link (matcher still works)', () => {
    const ccSingle = stmt('credit_card', 'Chase', '1797', '2026-02-28', [ccPaymentRow(80000n)]);
    const links = reconcileImportsFixed([bank, ccSingle]);
    expect(links.length).toBe(1);
  });
});
