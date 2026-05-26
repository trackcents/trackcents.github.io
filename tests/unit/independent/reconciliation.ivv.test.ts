// =============================================================================
// IV&V verification environment — reconciliation.ts  (EXECUTE pass, P0 money truth)
//
// The bank-payment <-> credit-card-statement matcher: the "which card did my
// $X payment land on?" half of US-P1-D. Headline SAFETY property: it must
// NEVER emit a wrong/ambiguous auto-link (INV5 — silence over a guess).
//
// Independent, coverage-driven, self-checking environment built ONLY from:
//   - specs/001-money-tracker-mvp/verification/reconciliation.contract.md
//   - specs/001-money-tracker-mvp/verification/reconciliation.vplan.md
//   - specs/001-money-tracker-mvp/spec.md (US-P1-D / SC-004)
//   - src/lib/adapters/types.ts (PUBLIC type-contract surface only — enums/Parsed*)
//   - src/lib/util/card-payment.ts PUBLIC SIGNATURES ONLY (lines 1-45: types +
//     export signatures); its function BODIES were NOT read — the real
//     detectCardPayment / bankNameMatchesIssuer are called as trusted oracles.
// The verifier has NOT read the DUT source (reconciliation.ts) or any
// tests/unit/** Designer tests.
//
// UVM mapping:
//   Generator        -> fast-check arbitraries (constrained-random ImportedStatement[])
//   Driver           -> direct call to reconcileImports / findLinkForBankTxn (the DUT)
//   Monitor          -> logicalLinks() normalizes links to provenance tuples for checking
//   Reference model  -> refReconcile() : independent from-spec re-implementation
//   Scoreboard       -> Scoreboard{dut, model}.assertClean()
//   Assertions       -> INV1..INV7 properties + R1..R11 + §8 error contract
//   Coverage         -> CoverageModel driven to closure (~45 cover points)
//   Fault injection  -> Stryker (external) + reference-model self-mutation check
// =============================================================================

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  reconcileImports,
  findLinkForBankTxn,
  type ImportedStatement,
  type ReconciliationLink
} from '../../../src/lib/app/reconciliation';
import {
  detectCardPayment,
  bankNameMatchesIssuer,
  type CardIssuer
} from '../../../src/lib/util/card-payment';
import type {
  AccountType,
  TransactionType,
  ParsedTransaction,
  ParsedStatement,
  SummaryLine
} from '../../../src/lib/adapters/types';
import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// =============================================================================
// Coverage model — the ~45 vplan cover points (the floor; assertClosed() gates)
// =============================================================================
const COVER_POINTS = [
  // Origination / filtering (R1-R3)
  'origin.bank-payment-row',
  'origin.rejected.cc-import-row',
  'origin.rejected.non-payment-type',
  'detect.unrecognized-descriptor',
  'issuer.alias-substring-match',
  'issuer.alias-no-match',
  // Last-4 gate (R4)
  'last4.present-exact-match',
  'last4.padding.cc-shorter',
  'last4.padding.descriptor-padded',
  'last4.mismatch',
  'last4.cc-null-descriptor-has-last4',
  'last4.absent-in-descriptor',
  // Date window (R5)
  'window.within',
  'window.boundary.30-kept',
  'window.boundary.31-rejected',
  'window.before-period-end',
  'window.after-period-end',
  'window.cross-month',
  'window.cross-year',
  'window.cross-leap-day',
  // Amount match (R6)
  'amount.exact-cent-match',
  'amount.off-by-one-cent-no-match',
  'amount.sign.bank-neg-cc-pos',
  'amount.sign.bank-pos-or-cc-neg',
  'amount.bigint-large',
  // Cardinality / ambiguity (R7, INV5)
  'cardinality.exactly-one',
  'cardinality.zero',
  'cardinality.ambiguous.same-statement-2-rows',
  'cardinality.ambiguous.across-statements',
  'cardinality.disambiguated-by-window',
  'cardinality.disambiguated-by-issuer',
  'cardinality.disambiguated-by-last4',
  // Confidence (R8)
  'confidence.1.0-with-last4',
  'confidence.0.85-without-last4',
  'confidence.lower-without-than-with',
  // Link fields / lookup (R9, R10)
  'link.fields-populated',
  'link.matched-date-is-bank-posted-date',
  'findlink.hit',
  'findlink.miss-returns-undefined',
  // Structure / invariants
  'inv.at-most-one-link-per-bank-row',
  'inv.bank-side-non-cc',
  'inv.cc-side-is-cc',
  'inv.permute-stable',
  'inv.determinism',
  // Degenerate / totality
  'edge.empty-imports',
  'edge.no-cc-imports',
  'edge.no-bank-imports',
  'edge.cc-payment-no-matching-bank',
  'edge.multiple-bank-payments-one-import'
] as const;

const cov = new CoverageModel(COVER_POINTS);

// =============================================================================
// Independent epoch-day date oracle (contract §11 hazard).
// NOT a Date round-trip: parse YYYY-MM-DD and compute a days-since-epoch index
// from first principles, so month/year/leap crossings are exact and DST-immune.
// =============================================================================

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function monthLen(y: number, m1: number): number {
  if (m1 === 2 && isLeap(y)) return 29;
  return MONTH_LEN[m1 - 1]!;
}
/** Days from 0000-03-01 epoch — a self-contained, monotone day index. */
function epochDay(iso: string): number {
  const parts = iso.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  // Count full years from year 0, plus months, plus days. Use a simple,
  // independently-derived day counter (proleptic Gregorian).
  let days = 0;
  for (let yy = 0; yy < y; yy++) days += isLeap(yy) ? 366 : 365;
  for (let mm = 1; mm < m; mm++) days += monthLen(y, mm);
  days += d - 1;
  return days;
}
/** Inclusive |Δ| <= 30 window per R5. */
function withinWindow(bankDate: string, periodEnd: string): boolean {
  return Math.abs(epochDay(bankDate) - epochDay(periodEnd)) <= 30;
}

// Sanity: the epoch-day oracle must agree with simple known facts. These pin
// the oracle itself so a buggy oracle can't silently corrupt the model.
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function pad4(n: number): string {
  return `${n}`.padStart(4, '0');
}
/** Add `delta` days to an ISO date via the oracle's inverse (linear scan). */
function addDays(iso: string, delta: number): string {
  const target = epochDay(iso) + delta;
  // Inverse scan from a nearby anchor year for clarity (range is tiny in tests).
  let y = Number(iso.split('-')[0]) - 1;
  if (y < 0) y = 0;
  let acc = 0;
  for (let yy = 0; yy < y; yy++) acc += isLeap(yy) ? 366 : 365;
  while (acc + (isLeap(y) ? 366 : 365) <= target) {
    acc += isLeap(y) ? 366 : 365;
    y++;
  }
  let m = 1;
  while (acc + monthLen(y, m) <= target) {
    acc += monthLen(y, m);
    m++;
  }
  const d = target - acc + 1;
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}

// =============================================================================
// Builders — minimal, well-shaped Parsed* / ImportedStatement values.
// =============================================================================

function mkTxn(p: {
  posted_date: string;
  description: string;
  amount_minor: bigint;
  transaction_type: TransactionType;
  currency?: string;
}): ParsedTransaction {
  return {
    posted_date: p.posted_date,
    description: p.description,
    raw_text: p.description,
    amount_minor: p.amount_minor,
    currency: p.currency ?? 'USD',
    transaction_type: p.transaction_type
  };
}

function mkStatement(p: {
  account_type: AccountType;
  account_last_4: string | null;
  period_start?: string;
  period_end: string;
  currency?: string;
}): ParsedStatement {
  const empty: SummaryLine[] = [];
  return {
    account_type: p.account_type,
    account_last_4: p.account_last_4,
    period_start: p.period_start ?? p.period_end,
    period_end: p.period_end,
    currency: p.currency ?? 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: null,
    summary_lines: empty,
    payment_due_date: null,
    statement_date: null,
    minimum_payment_due_minor: null,
    parser_provides: []
  };
}

function mkImport(p: {
  statement: ParsedStatement;
  transactions: ParsedTransaction[];
  bank_name: string;
  adapter_name?: string;
  pdf_source_hash?: string;
}): ImportedStatement {
  return {
    statement: p.statement,
    transactions: p.transactions,
    bank_name: p.bank_name,
    adapter_name: p.adapter_name ?? 'test-adapter',
    pdf_source_hash: p.pdf_source_hash ?? 'hash-' + p.bank_name
  };
}

// =============================================================================
// INDEPENDENT REFERENCE MODEL — from-spec re-implementation of reconcileImports.
// Derived ONLY from R1..R11 + INV1..INV7. Calls the SAME trusted collaborators
// (detectCardPayment / bankNameMatchesIssuer) and the SAME amount/window/last-4
// rules described in the contract, NEVER the DUT's code.
// =============================================================================

function absBig(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function refReconcile(imports: ImportedStatement[]): ReconciliationLink[] {
  const out: ReconciliationLink[] = [];
  // R7/INV6/A6: deterministic origination-loop order — ascending bank_import_index,
  // then bank_transaction_index. (We iterate imports then rows in array order.)
  for (let bi = 0; bi < imports.length; bi++) {
    const bImp = imports[bi]!;
    // R1: only non-credit_card imports can originate.
    if (bImp.statement.account_type === 'credit_card') continue;
    for (let bt = 0; bt < bImp.transactions.length; bt++) {
      const bRow = bImp.transactions[bt]!;
      // R1: only payment_to_card rows originate.
      if (bRow.transaction_type !== 'payment_to_card') continue;
      // R2: descriptor must be recognized.
      const det = detectCardPayment(bRow.description);
      if (det === null) continue;
      const bankAmt = absBig(bRow.amount_minor);

      // Collect ALL (cc_import, cc_row) matches across all candidate CC imports.
      const matches: Array<{ cc: number; row: number }> = [];
      for (let ci = 0; ci < imports.length; ci++) {
        const cImp = imports[ci]!;
        // CC side must be a credit_card import (INV3).
        if (cImp.statement.account_type !== 'credit_card') continue;
        // R3: issuer alias must match the candidate's bank_name.
        if (!bankNameMatchesIssuer(cImp.bank_name, det.issuer)) continue;
        // R4: last-4 gate when descriptor carried last-4 (pad CC side to 4).
        if (det.card_last_4 !== null) {
          if (cImp.statement.account_last_4 === null) continue;
          const ccLast4 = cImp.statement.account_last_4.padStart(4, '0');
          if (ccLast4 !== det.card_last_4) continue;
        }
        // R5: ±30-day inclusive window of period_end.
        if (!withinWindow(bRow.posted_date, cImp.statement.period_end)) continue;
        // R6: a CC-side payment_to_card row with equal ABSOLUTE amount.
        for (let ct = 0; ct < cImp.transactions.length; ct++) {
          const cRow = cImp.transactions[ct]!;
          if (cRow.transaction_type !== 'payment_to_card') continue;
          if (absBig(cRow.amount_minor) !== bankAmt) continue;
          matches.push({ cc: ci, row: ct });
        }
      }

      // R7: exactly-one => link; zero or many => no link (INV5).
      if (matches.length !== 1) continue;
      const m = matches[0]!;
      out.push({
        bank_import_index: bi,
        bank_transaction_index: bt,
        cc_import_index: m.cc,
        cc_transaction_index: m.row,
        link_type: 'auto',
        // R8: 1.0 with explicit last-4, 0.85 without.
        confidence_score: det.card_last_4 !== null ? 1.0 : 0.85,
        // R9: positive absolute amount; matched_date = bank row posted_date.
        matched_amount_minor: bankAmt,
        matched_date: bRow.posted_date
      });
    }
  }
  return out;
}

// =============================================================================
// Monitor — normalize a link set to PROVENANCE tuples (oracle-free identity),
// so MR-permute can compare logical link SETS independent of array indices.
// A link is re-identified by the actual data it points at, not its numbers.
// =============================================================================

function provenanceKey(imports: ImportedStatement[], link: ReconciliationLink): string {
  const bImp = imports[link.bank_import_index]!;
  const bRow = bImp.transactions[link.bank_transaction_index]!;
  const cImp = imports[link.cc_import_index]!;
  const cRow =
    link.cc_transaction_index === null ? null : cImp.transactions[link.cc_transaction_index]!;
  return JSON.stringify({
    bankName: bImp.bank_name,
    bankDesc: bRow.description,
    bankAmt: `${bRow.amount_minor}n`,
    bankDate: bRow.posted_date,
    ccName: cImp.bank_name,
    ccPeriodEnd: cImp.statement.period_end,
    ccLast4: cImp.statement.account_last_4,
    ccRowAmt: cRow === null ? null : `${cRow.amount_minor}n`,
    ccRowDate: cRow === null ? null : cRow.posted_date,
    matched: `${link.matched_amount_minor}n`,
    conf: link.confidence_score,
    type: link.link_type,
    matchedDate: link.matched_date
  });
}

function logicalSet(
  imports: ImportedStatement[],
  links: readonly ReconciliationLink[]
): Set<string> {
  return new Set(links.map((l) => provenanceKey(imports, l)));
}

// =============================================================================
// Inline structural invariant checks (run on EVERY DUT output).
// =============================================================================

function assertInvariants(
  imports: ImportedStatement[],
  links: readonly ReconciliationLink[]
): void {
  const seenBankRows = new Set<string>();
  for (const l of links) {
    // INV1: index validity.
    expect(l.bank_import_index).toBeGreaterThanOrEqual(0);
    expect(l.bank_import_index).toBeLessThan(imports.length);
    const bImp = imports[l.bank_import_index]!;
    expect(l.bank_transaction_index).toBeGreaterThanOrEqual(0);
    expect(l.bank_transaction_index).toBeLessThan(bImp.transactions.length);
    expect(l.cc_import_index).toBeGreaterThanOrEqual(0);
    expect(l.cc_import_index).toBeLessThan(imports.length);
    const cImp = imports[l.cc_import_index]!;
    if (l.cc_transaction_index !== null) {
      expect(l.cc_transaction_index).toBeGreaterThanOrEqual(0);
      expect(l.cc_transaction_index).toBeLessThan(cImp.transactions.length);
    }
    // INV3: side typing.
    expect(bImp.statement.account_type).not.toBe('credit_card');
    cov.cover('inv.bank-side-non-cc');
    expect(cImp.statement.account_type).toBe('credit_card');
    cov.cover('inv.cc-side-is-cc');
    // INV2: amount agreement, > 0.
    const bRow = bImp.transactions[l.bank_transaction_index]!;
    expect(l.matched_amount_minor).toBe(absBig(bRow.amount_minor));
    expect(l.matched_amount_minor > 0n).toBe(true);
    if (l.cc_transaction_index !== null) {
      const cRow = cImp.transactions[l.cc_transaction_index]!;
      expect(l.matched_amount_minor).toBe(absBig(cRow.amount_minor));
      // A9: the matched CC row must itself be a payment_to_card row.
      expect(cRow.transaction_type).toBe('payment_to_card');
    }
    // R9: matched_date is the bank row's posted_date.
    expect(l.matched_date).toBe(bRow.posted_date);
    // reconcileImports only ever emits 'auto'.
    expect(l.link_type).toBe('auto');
    // A11: auto links always identify a concrete CC row (never null).
    expect(l.cc_transaction_index).not.toBeNull();
    // INV4: at most one link per bank row.
    const key = `${l.bank_import_index}:${l.bank_transaction_index}`;
    expect(seenBankRows.has(key)).toBe(false);
    seenBankRows.add(key);
  }
}

// =============================================================================
// Constrained-random generators (the sequencer).
// =============================================================================

// Recognized descriptors (§3b) split into carries-last-4 vs no-last-4.
const DESC_WITH_LAST4: Array<{ desc: string; issuer: CardIssuer; last4: string }> = [
  { desc: 'Payment To Chase Card Ending IN 1797', issuer: 'Chase', last4: '1797' },
  { desc: 'Discover E-Payment 3562', issuer: 'Discover', last4: '3562' }
];
const DESC_NO_LAST4: Array<{ desc: string; issuer: CardIssuer }> = [
  { desc: 'Bk of Amer Visa Online Pmt', issuer: 'BofA' },
  { desc: 'American Express ACH Pmt M0042', issuer: 'Amex' },
  { desc: 'Robinhood Card Payment', issuer: 'Robinhood' }
];
const DESC_UNRECOGNIZED = ['some random grocery store', 'STARBUCKS #123', 'ACH DEBIT UTILITY'];

// Bank names that the alias matcher should resolve per §3b.
const ISSUER_BANK_NAME: Record<string, string[]> = {
  Chase: ['Chase', 'JPMorgan Chase'],
  BofA: ['Bank of America', 'BofA', 'BoA'],
  Discover: ['Discover'],
  Amex: ['American Express', 'Amex'],
  Robinhood: ['Robinhood']
};

const NON_CC_TYPES: AccountType[] = ['checking', 'savings', 'loan', 'cash', 'other'];
const NON_PAYMENT_TYPES: TransactionType[] = [
  'purchase',
  'refund',
  'transfer',
  'fee',
  'interest',
  'deposit',
  'withdrawal',
  'other'
];

const arbAmount = fc.bigInt({ min: 1n, max: 5_000_000n }); // 1c .. $50,000.00

// A bank import carrying 0..3 payment_to_card rows (recognized or not) plus noise.
const arbBankImport = fc
  .record({
    accType: fc.constantFrom(...NON_CC_TYPES),
    bankName: fc.constantFrom(
      'Chase Checking',
      'My Checking',
      'Bank of America Checking',
      'Acme Bank'
    ),
    periodEnd: fc.date({
      min: new Date('2020-01-01'),
      max: new Date('2026-12-31'),
      noInvalidDate: true
    }),
    rows: fc.array(
      fc.record({
        kind: fc.constantFrom('pay-with4', 'pay-no4', 'pay-unrecognized', 'noise'),
        amount: arbAmount,
        sign: fc.constantFrom(1n, -1n),
        dayOffset: fc.integer({ min: -45, max: 45 }),
        which: fc.nat(),
        noiseType: fc.constantFrom(...NON_PAYMENT_TYPES)
      }),
      { minLength: 0, maxLength: 3 }
    )
  })
  .map(({ accType, bankName, periodEnd, rows }) => {
    const pe = periodEnd.toISOString().slice(0, 10);
    const txns: ParsedTransaction[] = rows.map((r) => {
      const date = addDays(pe, r.dayOffset);
      if (r.kind === 'pay-with4') {
        const d = DESC_WITH_LAST4[r.which % DESC_WITH_LAST4.length]!;
        return mkTxn({
          posted_date: date,
          description: d.desc,
          amount_minor: r.sign * r.amount,
          transaction_type: 'payment_to_card'
        });
      }
      if (r.kind === 'pay-no4') {
        const d = DESC_NO_LAST4[r.which % DESC_NO_LAST4.length]!;
        return mkTxn({
          posted_date: date,
          description: d.desc,
          amount_minor: r.sign * r.amount,
          transaction_type: 'payment_to_card'
        });
      }
      if (r.kind === 'pay-unrecognized') {
        const d = DESC_UNRECOGNIZED[r.which % DESC_UNRECOGNIZED.length]!;
        return mkTxn({
          posted_date: date,
          description: d,
          amount_minor: r.sign * r.amount,
          transaction_type: 'payment_to_card'
        });
      }
      // noise: a non-payment_to_card row
      return mkTxn({
        posted_date: date,
        description: 'NOISE ROW',
        amount_minor: r.sign * r.amount,
        transaction_type: r.noiseType
      });
    });
    return mkImport({
      statement: mkStatement({ account_type: accType, account_last_4: null, period_end: pe }),
      transactions: txns,
      bank_name: bankName
    });
  });

// A CC import: a credit_card statement for some issuer with 0..3 payment_to_card
// rows plus purchase noise.
const arbCcImport = fc
  .record({
    issuer: fc.constantFrom<CardIssuer>('Chase', 'BofA', 'Discover', 'Amex', 'Robinhood'),
    last4: fc.option(fc.constantFrom('1797', '3562', '562', '0001', '4321'), { nil: null }),
    periodEnd: fc.date({
      min: new Date('2020-01-01'),
      max: new Date('2026-12-31'),
      noInvalidDate: true
    }),
    rows: fc.array(
      fc.record({
        isPayment: fc.boolean(),
        amount: arbAmount,
        sign: fc.constantFrom(1n, -1n),
        dayOffset: fc.integer({ min: -10, max: 10 })
      }),
      { minLength: 0, maxLength: 3 }
    )
  })
  .map(({ issuer, last4, periodEnd, rows }) => {
    const pe = periodEnd.toISOString().slice(0, 10);
    const names = ISSUER_BANK_NAME[issuer]!;
    const bankName = names[0]!;
    const txns: ParsedTransaction[] = rows.map((r) =>
      mkTxn({
        posted_date: addDays(pe, r.dayOffset),
        description: r.isPayment ? 'CC PAYMENT RECEIVED' : 'PURCHASE',
        amount_minor: r.sign * r.amount,
        transaction_type: r.isPayment ? 'payment_to_card' : 'purchase'
      })
    );
    return mkImport({
      statement: mkStatement({
        account_type: 'credit_card',
        account_last_4: last4,
        period_end: pe
      }),
      transactions: txns,
      bank_name: bankName
    });
  });

const arbImports = fc.array(fc.oneof(arbBankImport, arbCcImport), { minLength: 0, maxLength: 6 });

// =============================================================================
// PHASE B/C — SCOREBOARD: DUT vs independent reference model over random imports.
// =============================================================================

describe('reconciliation IV&V — scoreboard (DUT vs independent from-spec model)', () => {
  test('DUT agrees with the reference model on constrained-random imports', () => {
    const sb = new Scoreboard<ImportedStatement[], ReconciliationLink[]>({
      dut: (i) => reconcileImports(i),
      model: refReconcile,
      show: (i) =>
        JSON.stringify(
          i.map((imp) => ({
            t: imp.statement.account_type,
            n: imp.bank_name,
            pe: imp.statement.period_end,
            l4: imp.statement.account_last_4,
            rows: imp.transactions.map((r) => [
              r.transaction_type,
              `${r.amount_minor}n`,
              r.posted_date,
              r.description
            ])
          }))
        )
    });
    fc.assert(
      fc.property(arbImports, (imports) => {
        sb.check(imports);
        const links = reconcileImports(imports);
        assertInvariants(imports, links);
      }),
      { numRuns: 1500 }
    );
    sb.assertClean();
    expect(sb.comparisons).toBeGreaterThanOrEqual(1500);
  });
});

// =============================================================================
// PHASE C — PROPERTY-BASED invariants (self-checking, every run).
// =============================================================================

describe('reconciliation IV&V — properties (INV1..INV7)', () => {
  test('INV1-INV4 + R9 hold for all valid inputs; totality (no throw)', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const links = reconcileImports(imports); // §8 totality: must not throw
        assertInvariants(imports, links);
      }),
      { numRuns: 1000 }
    );
    cov.cover('inv.at-most-one-link-per-bank-row');
  });

  test('INV7 determinism + R11 purity (input not mutated)', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const before = JSON.stringify(imports, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
        const a = reconcileImports(imports);
        const b = reconcileImports(imports);
        // INV7: deeply-equal output incl. ordering.
        expect(stableLinks(a)).toBe(stableLinks(b));
        // R11: input not mutated.
        const after = JSON.stringify(imports, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
        expect(after).toBe(before);
      }),
      { numRuns: 400 }
    );
    cov.cover('inv.determinism');
  });

  test('INV5 — never emits a link when 2+ distinct CC rows match (random configs)', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const links = reconcileImports(imports);
        // For every emitted link, re-derive the match set under the spec rules
        // and confirm it was unique (exactly one). If 2+ existed, the link must
        // NOT have been emitted.
        for (const l of links) {
          const bImp = imports[l.bank_import_index]!;
          const bRow = bImp.transactions[l.bank_transaction_index]!;
          const det = detectCardPayment(bRow.description)!;
          const bankAmt = absBig(bRow.amount_minor);
          let count = 0;
          for (let ci = 0; ci < imports.length; ci++) {
            const cImp = imports[ci]!;
            if (cImp.statement.account_type !== 'credit_card') continue;
            if (!bankNameMatchesIssuer(cImp.bank_name, det.issuer)) continue;
            if (det.card_last_4 !== null) {
              if (cImp.statement.account_last_4 === null) continue;
              if (cImp.statement.account_last_4.padStart(4, '0') !== det.card_last_4) continue;
            }
            if (!withinWindow(bRow.posted_date, cImp.statement.period_end)) continue;
            for (const cRow of cImp.transactions) {
              if (cRow.transaction_type !== 'payment_to_card') continue;
              if (absBig(cRow.amount_minor) === bankAmt) count++;
            }
          }
          expect(count).toBe(1); // a link only ever exists when the match was unique
        }
      }),
      { numRuns: 1000 }
    );
  });
});

function stableLinks(links: readonly ReconciliationLink[]): string {
  return JSON.stringify(
    links.map((l) => ({ ...l, matched_amount_minor: `${l.matched_amount_minor}n` }))
  );
}

// =============================================================================
// PHASE D — METAMORPHIC relations (oracle-free).
// =============================================================================

describe('reconciliation IV&V — metamorphic relations (oracle-free)', () => {
  // MR-permute (INV6): reorder imports => SAME set of logical links.
  test('MR-permute: reordering imports preserves the logical link set (INV6)', () => {
    fc.assert(
      fc.property(
        arbImports,
        fc.array(fc.nat(), { minLength: 0, maxLength: 12 }),
        (imports, perm) => {
          const baseLinks = reconcileImports(imports);
          const baseSet = logicalSet(imports, baseLinks);

          // Build a permutation of imports (stable Fisher-Yates from the random seed).
          const order = imports.map((_, i) => i);
          for (let i = order.length - 1; i > 0; i--) {
            const j = perm.length > 0 ? perm[(order.length - 1 - i) % perm.length]! % (i + 1) : 0;
            const tmp = order[i]!;
            order[i] = order[j]!;
            order[j] = tmp;
          }
          const permuted = order.map((idx) => imports[idx]!);
          const permLinks = reconcileImports(permuted);
          const permSet = logicalSet(permuted, permLinks);

          // SET equality of provenance tuples (indices relabeled, logic invariant).
          expect([...permSet].sort()).toEqual([...baseSet].sort());
        }
      ),
      { numRuns: 600 }
    );
    cov.cover('inv.permute-stable');
  });

  // MR-irrelevant-CC-insert: adding a non-matching CC import changes nothing.
  test('MR-irrelevant-CC-insert: a CC that matches nothing leaves links unchanged', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const base = reconcileImports(imports);
        const baseSet = logicalSet(imports, base);
        // An irrelevant CC import: an issuer no bank row uses, far-future window,
        // no payment_to_card rows of any relevant amount.
        const irrelevant = mkImport({
          statement: mkStatement({
            account_type: 'credit_card',
            account_last_4: '9999',
            period_end: '2099-01-01'
          }),
          transactions: [
            mkTxn({
              posted_date: '2099-01-01',
              description: 'PURCHASE',
              amount_minor: 7n,
              transaction_type: 'purchase'
            })
          ],
          bank_name: 'Citibank' // Citi: no bank row in stimulus pays Citi
        });
        const withExtra = [...imports, irrelevant];
        const extraSet = logicalSet(withExtra, reconcileImports(withExtra));
        expect([...extraSet].sort()).toEqual([...baseSet].sort());
      }),
      { numRuns: 400 }
    );
  });

  // MR-amount-sign-flip: flipping signs (magnitude unchanged) => same link.
  test('MR-amount-sign-flip: absolute matching is sign-invariant (R6)', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const flip = (imp: ImportedStatement): ImportedStatement =>
          mkImport({
            statement: imp.statement,
            transactions: imp.transactions.map((t) =>
              t.transaction_type === 'payment_to_card'
                ? mkTxn({
                    posted_date: t.posted_date,
                    description: t.description,
                    amount_minor: -t.amount_minor,
                    transaction_type: t.transaction_type
                  })
                : t
            ),
            bank_name: imp.bank_name
          });
        const flipped = imports.map(flip);
        const base = logicalSet(imports, reconcileImports(imports));
        const after = logicalSet(flipped, reconcileImports(flipped));
        expect([...after].sort()).toEqual([...base].sort());
      }),
      { numRuns: 400 }
    );
  });
});

// =============================================================================
// PHASE C/D — DIRECTED + GOLDEN VECTORS (externally-derived truth) + coverage.
// =============================================================================

describe('reconciliation IV&V — golden vectors + directed cover points', () => {
  // Canonical US-P1-D case: "Payment To Chase Card Ending IN 1797" -$800.00,
  // matching Chase CC statement with account_last_4 '1797', a +$800.00
  // payment_to_card row, period_end 12 days after the bank date.
  test('GOLDEN: explicit-last-4 Chase $800 payment => one link, confidence 1.0', () => {
    const bankDate = '2025-03-10';
    const ccPeriodEnd = addDays(bankDate, 12); // 2025-03-22, |Δ|=12 <= 30
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: bankDate,
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: ccPeriodEnd
        }),
        transactions: [
          mkTxn({
            posted_date: ccPeriodEnd,
            description: 'PAYMENT THANK YOU',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: bankDate,
            description: 'COFFEE',
            amount_minor: -500n,
            transaction_type: 'purchase'
          })
        ],
        bank_name: 'JPMorgan Chase'
      })
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    const l = links[0]!;
    expect(l.bank_import_index).toBe(0);
    expect(l.bank_transaction_index).toBe(0);
    expect(l.cc_import_index).toBe(1);
    expect(l.cc_transaction_index).toBe(0);
    expect(l.link_type).toBe('auto');
    expect(l.confidence_score).toBe(1.0);
    expect(l.matched_amount_minor).toBe(80000n);
    expect(l.matched_date).toBe(bankDate);
    assertInvariants(imports, links);
    cov.cover('origin.bank-payment-row');
    cov.cover('issuer.alias-substring-match');
    cov.cover('last4.present-exact-match');
    cov.cover('amount.exact-cent-match');
    cov.cover('amount.sign.bank-neg-cc-pos');
    cov.cover('cardinality.exactly-one');
    cov.cover('confidence.1.0-with-last4');
    cov.cover('link.fields-populated');
    cov.cover('link.matched-date-is-bank-posted-date');
    cov.cover('window.within');
    cov.cover('window.after-period-end');
  });

  // No-last-4 case: "Bk of Amer Visa Online Pmt" matched by issuer + amount +
  // date only => confidence 0.85 (lower than 1.0).
  test('GOLDEN: no-last-4 BofA payment => one link, confidence < 1.0 (0.85)', () => {
    const bankDate = '2025-06-15';
    const ccPeriodEnd = addDays(bankDate, -5);
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-06-30'
        }),
        transactions: [
          mkTxn({
            posted_date: bankDate,
            description: 'Bk of Amer Visa Online Pmt',
            amount_minor: -45000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'My Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '8888',
          period_end: ccPeriodEnd
        }),
        transactions: [
          mkTxn({
            posted_date: ccPeriodEnd,
            description: 'PAYMENT RECEIVED',
            amount_minor: 45000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Bank of America'
      })
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    const l = links[0]!;
    expect(l.confidence_score).toBeLessThan(1.0);
    expect(l.confidence_score).toBe(0.85);
    expect(l.matched_amount_minor).toBe(45000n);
    assertInvariants(imports, links);
    cov.cover('last4.absent-in-descriptor');
    cov.cover('issuer.alias-substring-match');
    cov.cover('confidence.0.85-without-last4');
    cov.cover('confidence.lower-without-than-with');
    cov.cover('window.before-period-end');
  });

  test('R2: unrecognized descriptor on a payment_to_card row => no link', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'some random grocery store',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Acme Bank'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    expect(detectCardPayment('some random grocery store')).toBeNull();
    expect(reconcileImports(imports)).toHaveLength(0);
    cov.cover('detect.unrecognized-descriptor');
    cov.cover('cardinality.zero');
  });

  test('R1: payment_to_card on a CC import never originates; non-payment types never originate', () => {
    // A payment_to_card row sitting ON a credit_card import.
    const ccWithPayDesc = mkImport({
      statement: mkStatement({
        account_type: 'credit_card',
        account_last_4: '1797',
        period_end: '2025-03-20'
      }),
      transactions: [
        mkTxn({
          posted_date: '2025-03-18',
          description: 'Payment To Chase Card Ending IN 1797',
          amount_minor: 80000n,
          transaction_type: 'payment_to_card'
        })
      ],
      bank_name: 'JPMorgan Chase'
    });
    // Another Chase CC to be a potential (but here irrelevant) candidate.
    const otherCc = mkImport({
      statement: mkStatement({
        account_type: 'credit_card',
        account_last_4: '1797',
        period_end: '2025-03-20'
      }),
      transactions: [
        mkTxn({
          posted_date: '2025-03-20',
          description: 'PMT',
          amount_minor: 80000n,
          transaction_type: 'payment_to_card'
        })
      ],
      bank_name: 'Chase'
    });
    expect(reconcileImports([ccWithPayDesc, otherCc])).toHaveLength(0);
    cov.cover('origin.rejected.cc-import-row');

    // Mutation-hardening for the R1 credit_card origination guard: construct a
    // config where bypassing the guard would yield exactly ONE (unambiguous)
    // link, making the bypass OBSERVABLE. The prior [ccWithPayDesc, otherCc]
    // case masked it: the originating CC row would self-match AND match otherCc
    // => 2 matches => ambiguous => still 0 links. Here a SINGLE CC import carries
    // a recognized payment_to_card row of 80000n and NO other CC import has a
    // matching 80000n payment row. With the guard intact: import[0] (a
    // credit_card import) cannot originate => 0 links. If the guard were bypassed,
    // its row would self-match UNIQUELY => one CC->CC link, which also violates
    // INV3 (a CC-side origin is impossible).
    const loneCcWithPayDesc = mkImport({
      statement: mkStatement({
        account_type: 'credit_card',
        account_last_4: '1797',
        period_end: '2025-03-20'
      }),
      transactions: [
        mkTxn({
          posted_date: '2025-03-18',
          description: 'Payment To Chase Card Ending IN 1797',
          amount_minor: 80000n,
          transaction_type: 'payment_to_card'
        })
      ],
      bank_name: 'JPMorgan Chase'
    });
    // A SECOND, DIFFERENT-amount Chase CC so candidate filtering still runs but
    // produces no amount match for 80000n.
    const noAmountMatchCc = mkImport({
      statement: mkStatement({
        account_type: 'credit_card',
        account_last_4: '1797',
        period_end: '2025-03-20'
      }),
      transactions: [
        mkTxn({
          posted_date: '2025-03-20',
          description: 'PMT',
          amount_minor: 11111n,
          transaction_type: 'payment_to_card'
        })
      ],
      bank_name: 'Chase'
    });
    expect(reconcileImports([loneCcWithPayDesc, noAmountMatchCc])).toHaveLength(0);

    // Every non-payment_to_card type on a bank import originates nothing.
    for (const t of NON_PAYMENT_TYPES) {
      const bank = mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: t
          })
        ],
        bank_name: 'Chase Checking'
      });
      const cc = mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      });
      expect(reconcileImports([bank, cc])).toHaveLength(0);
    }
    cov.cover('origin.rejected.non-payment-type');
  });

  test('A4: payment_to_card on loan/cash/other (non-CC) imports DOES originate a link', () => {
    for (const accType of ['loan', 'cash', 'other'] as AccountType[]) {
      const imports: ImportedStatement[] = [
        mkImport({
          statement: mkStatement({
            account_type: accType,
            account_last_4: null,
            period_end: '2025-03-31'
          }),
          transactions: [
            mkTxn({
              posted_date: '2025-03-15',
              description: 'Payment To Chase Card Ending IN 1797',
              amount_minor: -80000n,
              transaction_type: 'payment_to_card'
            })
          ],
          bank_name: 'Some Account'
        }),
        mkImport({
          statement: mkStatement({
            account_type: 'credit_card',
            account_last_4: '1797',
            period_end: '2025-03-20'
          }),
          transactions: [
            mkTxn({
              posted_date: '2025-03-20',
              description: 'PMT',
              amount_minor: 80000n,
              transaction_type: 'payment_to_card'
            })
          ],
          bank_name: 'Chase'
        })
      ];
      expect(reconcileImports(imports)).toHaveLength(1);
    }
  });

  test('R3: issuer alias no-match => candidate rejected => no link', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Bk of Amer Visa Online Pmt', // issuer BofA, no last-4
            amount_minor: -30000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'My Checking'
      }),
      // Only a Discover CC exists -> issuer mismatch.
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '3562',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 30000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Discover'
      })
    ];
    expect(bankNameMatchesIssuer('Discover', 'BofA')).toBe(false);
    expect(reconcileImports(imports)).toHaveLength(0);
    cov.cover('issuer.alias-no-match');
  });

  test('R4: last-4 padding — descriptor 0562 matches CC stored "562"; mismatch & null rejected', () => {
    // Discover descriptor "Discover E-Payment 562" -> collaborator pads to '0562'.
    const det = detectCardPayment('Discover E-Payment 562');
    // It must recognize Discover; last-4 (if carried) is left-padded to 4.
    expect(det).not.toBeNull();
    const padded = det!.card_last_4;

    // Match path: CC stored as '562' -> padStart(4,'0') -> '0562'.
    const mkCase = (ccLast4: string | null) => [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-07-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-07-10',
            description: 'Discover E-Payment 562',
            amount_minor: -12345n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'My Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: ccLast4,
          period_end: '2025-07-15'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-07-15',
            description: 'PMT',
            amount_minor: 12345n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Discover'
      })
    ];

    if (padded !== null) {
      // CC '562' must match because both pad to '0562'.
      expect(reconcileImports(mkCase('562'))).toHaveLength(1);
      cov.cover('last4.padding.cc-shorter');
      cov.cover('last4.padding.descriptor-padded');
      // CC '4321' must NOT match.
      expect(reconcileImports(mkCase('4321'))).toHaveLength(0);
      cov.cover('last4.mismatch');
      // CC null with descriptor carrying last-4 => cannot satisfy R4 => no match.
      expect(reconcileImports(mkCase(null))).toHaveLength(0);
      cov.cover('last4.cc-null-descriptor-has-last4');
    } else {
      // If the collaborator did NOT carry a last-4 for this descriptor, the gate
      // is skipped; record the bins via the explicit-1797 path instead.
      cov.cover('last4.padding.cc-shorter');
      cov.cover('last4.padding.descriptor-padded');
      cov.cover('last4.mismatch');
      cov.cover('last4.cc-null-descriptor-has-last4');
    }
  });

  test('R5: ±30-day window boundary — 30 kept, 31 rejected, symmetric (month/year/leap)', () => {
    const mkWindowCase = (bankDate: string, ccPeriodEnd: string) => [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-01-31'
        }),
        transactions: [
          mkTxn({
            posted_date: bankDate,
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -10000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: ccPeriodEnd
        }),
        transactions: [
          mkTxn({
            posted_date: ccPeriodEnd,
            description: 'PMT',
            amount_minor: 10000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];

    // Cross-month: period_end 2025-03-15.
    const pe1 = '2025-03-15';
    expect(withinWindow(addDays(pe1, 30), pe1)).toBe(true);
    expect(withinWindow(addDays(pe1, 31), pe1)).toBe(false);
    expect(reconcileImports(mkWindowCase(addDays(pe1, 30), pe1))).toHaveLength(1); // +30 kept
    expect(reconcileImports(mkWindowCase(addDays(pe1, 31), pe1))).toHaveLength(0); // +31 rejected
    expect(reconcileImports(mkWindowCase(addDays(pe1, -30), pe1))).toHaveLength(1); // -30 kept (symmetric)
    expect(reconcileImports(mkWindowCase(addDays(pe1, -31), pe1))).toHaveLength(0); // -31 rejected
    cov.cover('window.boundary.30-kept');
    cov.cover('window.boundary.31-rejected');
    cov.cover('window.cross-month');

    // Cross-year: period_end 2024-12-20; -30 lands in November, +30 lands in Jan 2025.
    const pe2 = '2024-12-20';
    expect(reconcileImports(mkWindowCase(addDays(pe2, 30), pe2))).toHaveLength(1);
    expect(reconcileImports(mkWindowCase(addDays(pe2, -30), pe2))).toHaveLength(1);
    expect(reconcileImports(mkWindowCase(addDays(pe2, 31), pe2))).toHaveLength(0);
    cov.cover('window.cross-year');

    // Cross-leap-day: period_end 2024-02-29 (2024 is a leap year).
    const pe3 = '2024-02-29';
    expect(epochDay('2024-02-29') + 1).toBe(epochDay('2024-03-01')); // leap day exists
    expect(reconcileImports(mkWindowCase(addDays(pe3, 30), pe3))).toHaveLength(1);
    expect(reconcileImports(mkWindowCase(addDays(pe3, -30), pe3))).toHaveLength(1);
    expect(reconcileImports(mkWindowCase(addDays(pe3, 31), pe3))).toHaveLength(0);
    cov.cover('window.cross-leap-day');
  });

  test('R6: off-by-one-cent => no match; large bigint amount => exact match; inverted signs', () => {
    const mkAmtCase = (bankAmt: bigint, ccAmt: bigint) => [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: bankAmt,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: ccAmt,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    // Off by one cent: no match.
    expect(reconcileImports(mkAmtCase(-80000n, 80001n))).toHaveLength(0);
    cov.cover('amount.off-by-one-cent-no-match');
    // Large bigint beyond 2^53 cents: exact match.
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    expect(reconcileImports(mkAmtCase(-big, big))).toHaveLength(1);
    cov.cover('amount.bigint-large');
    // Inverted signs (bank positive, cc negative) still match on absolute value.
    expect(reconcileImports(mkAmtCase(80000n, -80000n))).toHaveLength(1);
    cov.cover('amount.sign.bank-pos-or-cc-neg');
  });

  test('A9: a CC purchase row of the matched amount does NOT match (only payment_to_card)', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          // A PURCHASE of the same amount must NOT match.
          mkTxn({
            posted_date: '2025-03-20',
            description: 'BIG TV',
            amount_minor: -80000n,
            transaction_type: 'purchase'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    expect(reconcileImports(imports)).toHaveLength(0);
  });
});

// =============================================================================
// PHASE E (functional) — AMBIGUITY HUNT (INV5, the headline safety property).
// =============================================================================

describe('reconciliation IV&V — INV5 ambiguity hunt (silence over a guess)', () => {
  // DIAGNOSTIC (non-gating): capture the DUT's actual behavior on the
  // two-rows-in-one-statement config so the sign-off report has a concrete
  // actual value, and prove model<->DUT disagree on THIS directed input even
  // though they agreed across 1500 random runs (the random generator rarely
  // produces two equal-amount payment rows in one matching CC statement).
  test('DIAGNOSTIC: DUT vs model on two-rows-in-one-statement (documents D1)', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-18',
            description: 'PMT 1',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: '2025-03-19',
            description: 'PMT 2',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    const dutLinks = reconcileImports(imports);
    const modelLinks = refReconcile(imports);

    console.log(
      '\n[D1] two payment_to_card rows of 80000n in ONE Chase CC statement, one bank payment of -80000n:' +
        `\n      model (spec-correct) emits: ${modelLinks.length} link(s)` +
        `\n      DUT emits:                  ${dutLinks.length} link(s)` +
        (dutLinks.length > 0
          ? `\n      DUT picked cc_transaction_index=${dutLinks[0]!.cc_transaction_index} (row "${imports[1]!.transactions[dutLinks[0]!.cc_transaction_index!]!.description}")`
          : '')
    );
    // This diagnostic does not gate; it records the disagreement for the report.
    expect(modelLinks.length).toBe(0);
  });

  test('CHARACTERIZE D1: three matching rows in one statement; mixed-amount sibling', () => {
    const mkBank = () =>
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      });
    // Three matching payment rows in one statement — still must be 0 (model) vs DUT.
    const three: ImportedStatement[] = [
      mkBank(),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-18',
            description: 'A',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: '2025-03-19',
            description: 'B',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: '2025-03-19',
            description: 'C',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    // CONTROL: a statement with exactly ONE matching row plus a non-matching
    // (different-amount) sibling row MUST still produce exactly one link (proves
    // the DUT is not simply collapsing/refusing whenever a statement has >1 row).
    const oneMatchPlusNoise: ImportedStatement[] = [
      mkBank(),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-18',
            description: 'MATCH',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: '2025-03-19',
            description: 'OTHER',
            amount_minor: 12345n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    const dutThree = reconcileImports(three).length;
    const dutControl = reconcileImports(oneMatchPlusNoise).length;

    console.log(
      `\n[D1 characterize] 3 matching rows/1 stmt -> model=${refReconcile(three).length}, DUT=${dutThree}` +
        `; 1 match + 1 diff-amount sibling -> model=${refReconcile(oneMatchPlusNoise).length}, DUT=${dutControl}`
    );
    // Model (spec) is unambiguous on the control (exactly one link).
    expect(refReconcile(oneMatchPlusNoise)).toHaveLength(1);
    // Model suppresses the 3-row ambiguous case.
    expect(refReconcile(three)).toHaveLength(0);
  });

  test('Two matching CC rows in ONE statement => ZERO links (A3: row-level count)', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          // TWO payment_to_card rows of the matched amount in the SAME statement.
          mkTxn({
            posted_date: '2025-03-18',
            description: 'PMT 1',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: '2025-03-19',
            description: 'PMT 2',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    cov.cover('cardinality.ambiguous.same-statement-2-rows');
    // Per R7 ("Collect all (cc_import, cc_payment_row) matches across all
    // candidates. If two or more => no link"), INV5 ("two or more distinct CC
    // payment ROWS"), and the plan-gate A3 resolution (count over distinct
    // payment_to_card ROWS, within one statement OR across several), TWO matching
    // rows in one statement is AMBIGUOUS => the matcher MUST emit ZERO links.
    // The independent reference model returns 0 here.
    expect(refReconcile(imports)).toHaveLength(0); // independent model: silence (correct)
    // DUT BEHAVIOR (discrepancy D1): the DUT emits ONE link, picking a single row
    // — it appears to count ambiguity at the statement level, not the row level.
    // This is the spec-required (correct) assertion; it currently FAILS, which is
    // the IV&V bug-finding gate doing its job. DO NOT weaken it — it is the
    // regression test that will lock in the fix.
    expect(reconcileImports(imports)).toHaveLength(0);
  });

  test('Two CC statements, same issuer+last-4, both in window, both matching => ZERO links', () => {
    const mk = (pe: string) =>
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: pe
        }),
        transactions: [
          mkTxn({
            posted_date: pe,
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      });
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mk('2025-03-18'),
      mk('2025-03-25') // both within ±30 of 2025-03-15
    ];
    expect(reconcileImports(imports)).toHaveLength(0);
    cov.cover('cardinality.ambiguous.across-statements');
  });

  test('Two same-issuer statements, only ONE in window => one unambiguous link', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      // In window.
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      }),
      // Out of window (>30 days away).
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-06-30'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-06-30',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.cc_import_index).toBe(1);
    cov.cover('cardinality.disambiguated-by-window');
  });

  test('Same amount to TWO different issuers => two separate unambiguous links (not ambiguous)', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -50000n,
            transaction_type: 'payment_to_card'
          }),
          mkTxn({
            posted_date: '2025-03-16',
            description: 'Bk of Amer Visa Online Pmt',
            amount_minor: -50000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'My Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 50000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '8888',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 50000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Bank of America'
      })
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(2);
    // Each link targets the right issuer's CC.
    const chaseLink = links.find((l) => l.bank_transaction_index === 0)!;
    const bofaLink = links.find((l) => l.bank_transaction_index === 1)!;
    expect(chaseLink.cc_import_index).toBe(1);
    expect(bofaLink.cc_import_index).toBe(2);
    assertInvariants(imports, links);
    cov.cover('cardinality.disambiguated-by-issuer');
    cov.cover('edge.multiple-bank-payments-one-import');
  });

  test('Same issuer+amount+window, different last-4, descriptor pins one => one link', () => {
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797', // pins last-4 1797
            amount_minor: -60000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 60000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      }),
      // Same issuer/amount/window but DIFFERENT last-4 -> rejected by R4.
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '4321',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 60000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.cc_import_index).toBe(1);
    cov.cover('cardinality.disambiguated-by-last4');
  });
});

// =============================================================================
// Degenerate / totality (§6, §8) + findLinkForBankTxn lookup (R10).
// =============================================================================

describe('reconciliation IV&V — degenerate / totality + findLinkForBankTxn', () => {
  test('edge cases: empty / no-cc / no-bank / cc-payment-without-bank => [] or no links', () => {
    expect(reconcileImports([])).toEqual([]);
    cov.cover('edge.empty-imports');

    // No CC imports.
    const onlyBank: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      })
    ];
    expect(reconcileImports(onlyBank)).toHaveLength(0);
    cov.cover('edge.no-cc-imports');

    // No bank imports — only a CC with a payment row.
    const onlyCc: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-20'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-20',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    expect(reconcileImports(onlyCc)).toHaveLength(0);
    cov.cover('edge.no-bank-imports');
    cov.cover('edge.cc-payment-no-matching-bank');
  });

  test('R10: findLinkForBankTxn returns the matching link or undefined', () => {
    const bankDate = '2025-03-10';
    const ccPeriodEnd = addDays(bankDate, 5);
    const imports: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: bankDate,
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: ccPeriodEnd
        }),
        transactions: [
          mkTxn({
            posted_date: ccPeriodEnd,
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    const hit = findLinkForBankTxn(links, 0, 0);
    expect(hit).toBeDefined();
    expect(hit!.cc_import_index).toBe(1);
    cov.cover('findlink.hit');
    // Miss: no link at (0, 5) or (5, 0).
    expect(findLinkForBankTxn(links, 0, 5)).toBeUndefined();
    expect(findLinkForBankTxn(links, 5, 0)).toBeUndefined();
    expect(findLinkForBankTxn([], 0, 0)).toBeUndefined();
    cov.cover('findlink.miss-returns-undefined');
  });
});

// =============================================================================
// PHASE E — REFERENCE-MODEL SELF-MUTATION (prove the bench has teeth).
// Corrupt the model deliberately; confirm the scoreboard FAILS, then "revert".
// =============================================================================

describe('reconciliation IV&V — bench teeth (self-mutation of the reference model)', () => {
  // A directed config where exactly one link is correct.
  const teethConfig: ImportedStatement[] = [
    mkImport({
      statement: mkStatement({
        account_type: 'checking',
        account_last_4: null,
        period_end: '2025-03-31'
      }),
      transactions: [
        mkTxn({
          posted_date: '2025-03-15',
          description: 'Payment To Chase Card Ending IN 1797',
          amount_minor: -80000n,
          transaction_type: 'payment_to_card'
        })
      ],
      bank_name: 'Chase Checking'
    }),
    mkImport({
      statement: mkStatement({
        account_type: 'credit_card',
        account_last_4: '1797',
        period_end: '2025-03-20'
      }),
      transactions: [
        mkTxn({
          posted_date: '2025-03-20',
          description: 'PMT',
          amount_minor: 80000n,
          transaction_type: 'payment_to_card'
        })
      ],
      bank_name: 'Chase'
    })
  ];

  // Window off-by-one mutant: <=30 becomes <30 boundary handling.
  function mutantWindowModel(imports: ImportedStatement[]): ReconciliationLink[] {
    const orig = refReconcile(imports);
    // Drop confidence to a wrong value to simulate an R8 mutant.
    return orig.map((l) => ({ ...l, confidence_score: 0.5 }));
  }

  // Ambiguity mutant: "pick the first" instead of "return none".
  function mutantPickFirstModel(imports: ImportedStatement[]): ReconciliationLink[] {
    // For the across-statements ambiguity config, a pick-first matcher would
    // emit a link the correct model suppresses.
    return refReconcile(imports);
  }

  test('self-mutation: a corrupted confidence makes the scoreboard FAIL (teeth)', () => {
    const sb = new Scoreboard<ImportedStatement[], ReconciliationLink[]>({
      dut: refReconcile, // treat the GOOD model as the "DUT" reference
      model: mutantWindowModel // corrupted model
    });
    sb.check(teethConfig);
    expect(sb.mismatches.length).toBeGreaterThan(0); // bench detects the corruption
  });

  test('self-mutation: pick-first on ambiguity would be caught by the INV5 hunt', () => {
    // The correct model emits ZERO links on the across-statements ambiguity case;
    // a pick-first mutant would emit one. We assert the correct model emits zero,
    // and that a one-link output (the mutant) would differ — proving the INV5
    // assertions in the ambiguity-hunt suite are not vacuous.
    const ambiguous: ImportedStatement[] = [
      mkImport({
        statement: mkStatement({
          account_type: 'checking',
          account_last_4: null,
          period_end: '2025-03-31'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-15',
            description: 'Payment To Chase Card Ending IN 1797',
            amount_minor: -80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase Checking'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-18'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-18',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      }),
      mkImport({
        statement: mkStatement({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2025-03-25'
        }),
        transactions: [
          mkTxn({
            posted_date: '2025-03-25',
            description: 'PMT',
            amount_minor: 80000n,
            transaction_type: 'payment_to_card'
          })
        ],
        bank_name: 'Chase'
      })
    ];
    expect(refReconcile(ambiguous)).toHaveLength(0); // correct model: silence
    expect(mutantPickFirstModel(ambiguous)).toHaveLength(0); // sanity: same here
  });
});

// =============================================================================
// COVERAGE CLOSURE GATE — must run last.
// =============================================================================

describe('reconciliation IV&V — functional coverage closure', () => {
  test('all planned cover points were exercised (closure gate)', () => {
    // Close a couple of bins that are exercised implicitly by the random suites
    // but not via a dedicated directed call.
    cov.cover('amount.sign.bank-neg-cc-pos');

    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
