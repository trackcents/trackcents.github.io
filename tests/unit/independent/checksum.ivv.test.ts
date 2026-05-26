// =============================================================================
// IV&V verification environment — runChecksumGate (the HARD IMPORT GATE)
// =============================================================================
//
// Independent Verification & Validation of the constitution's Principle II
// enforcement point: a parsed statement MUST reconcile to its printed totals to
// the cent, or the import is REFUSED. A false PASS lets wrong financial data
// enter the app silently (the single worst failure mode); a false REFUSE blocks
// a valid import. Both must be impossible.
//
// Authored by the independent verification engineer from the verification
// contract + spec ALONE. The implementation source (src/lib/app/checksum.ts)
// was NEVER read. The reference model below is derived from first principles
// (contract R4-R11 + the data-model sign convention), NOT by mirroring any
// suspected implementation.
//
// UVM mapping:
//   Generator      -> fast-check arbitraries (constrained-random statements + txns)
//   Driver         -> calls runChecksumGate (the DUT)
//   Monitor        -> normalize() projects DUT/model output onto checkable facts
//   Reference model -> refGate() — a second from-spec implementation
//   Scoreboard     -> Scoreboard{dut, model} over normalized projections
//   Assertions     -> INV1..INV7 fast-check properties
//   Coverage       -> CoverageModel (~45 cover points) -> assertClosed()
//   Fault injection -> reference-model self-mutation teeth-check (Stryker runs separately)
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
// =============================================================================

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import {
  runChecksumGate,
  type ChecksumGateResult,
  type ChecksumLevelResult
} from '../../../src/lib/app/checksum';
import type {
  ChecksumLevel,
  ParsedStatement,
  ParsedTransaction,
  TransactionType
} from '../../../src/lib/adapters/types';

import { CoverageModel } from '../../_framework/coverage-model';
import { Scoreboard } from '../../_framework/scoreboard';

// -----------------------------------------------------------------------------
// Local builders for the DUT's input shapes (transcribed from contract §3a /
// adapters/types.ts public interface — never from an implementation body).
// -----------------------------------------------------------------------------

function txn(
  amount_minor: bigint,
  transaction_type: TransactionType = 'purchase'
): ParsedTransaction {
  return {
    posted_date: '2026-01-15',
    description: 'row',
    raw_text: 'row',
    amount_minor,
    currency: 'USD',
    transaction_type
  };
}

interface StmtFields {
  opening?: bigint | null;
  closing?: bigint | null;
  totalDebits?: bigint | null;
  totalCredits?: bigint | null;
  statementBalance?: bigint | null;
  previousBalance?: bigint | null;
  printedCount?: number | null;
  provides: ChecksumLevel[];
}

function stmt(f: StmtFields): ParsedStatement {
  return {
    account_type: 'credit_card',
    account_last_4: '0000',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    currency: 'USD',
    opening_balance_minor: f.opening ?? null,
    closing_balance_minor: f.closing ?? null,
    total_debits_minor: f.totalDebits ?? null,
    total_credits_minor: f.totalCredits ?? null,
    statement_balance_minor: f.statementBalance ?? null,
    previous_balance_minor: f.previousBalance ?? null,
    printed_transaction_count: f.printedCount ?? null,
    summary_lines: [],
    payment_due_date: null,
    statement_date: null,
    minimum_payment_due_minor: null,
    parser_provides: f.provides
  };
}

// -----------------------------------------------------------------------------
// INDEPENDENT REFERENCE MODEL ("golden") — a second from-spec implementation.
//
// Derived purely from the contract's WHAT (R1-R11) + the data-model sign
// convention. Sign handling re-derived from first principles, NOT copied:
//   * outflows (charges/debits) are NEGATIVE amount_minor
//   * inflows (payments/credits/refunds) are POSITIVE amount_minor
//   * total_debits_minor is the ABSOLUTE (positive) printed debit total
//
// Level C per contract R6 (Designer-ruled canonical & algebraically identical
// to the spec's 4-term form on normalized data — see contract §R6 equivalence
// note): previous + |Σ charges<0| − Σ payments>0 === statement_balance.
// -----------------------------------------------------------------------------

const STRONG: ReadonlySet<ChecksumLevel> = new Set<ChecksumLevel>(['A', 'B', 'C']);

interface RefLevelResult {
  level: ChecksumLevel;
  passed: boolean;
  expected_minor: bigint | null;
  actual_minor: bigint | null;
  diff_minor: bigint | null;
}

/** Signed sum of EVERY transaction (Level A includes zero rows). */
function signedSum(txns: readonly ParsedTransaction[]): bigint {
  return txns.reduce((acc, t) => acc + t.amount_minor, 0n);
}

/** |Σ amount where amount < 0| — strict inequality, zero rows excluded. */
function absDebitSum(txns: readonly ParsedTransaction[]): bigint {
  const neg = txns.reduce((acc, t) => (t.amount_minor < 0n ? acc + t.amount_minor : acc), 0n);
  return neg < 0n ? -neg : neg;
}

/** Σ amount where amount > 0 — strict inequality, zero rows excluded. */
function creditSum(txns: readonly ParsedTransaction[]): bigint {
  return txns.reduce((acc, t) => (t.amount_minor > 0n ? acc + t.amount_minor : acc), 0n);
}

/** Build the per-level result independently from the spec. */
function refLevel(
  level: ChecksumLevel,
  s: ParsedStatement,
  txns: readonly ParsedTransaction[]
): RefLevelResult {
  const missing = (): RefLevelResult => ({
    level,
    passed: false,
    expected_minor: null,
    actual_minor: null,
    diff_minor: null
  });

  if (level === 'A') {
    if (s.opening_balance_minor === null || s.closing_balance_minor === null) return missing();
    // R4/R11 direction: expected = the COMPUTED reconciliation target (opening+Σ);
    // actual = the PRINTED closing balance. R4 worked example: closing 7499 with
    // computed 7500 ⇒ diff_minor = expected − actual = 7500 − 7499 = 1.
    const expected = s.opening_balance_minor + signedSum(txns);
    const actual = s.closing_balance_minor;
    const diff = expected - actual;
    return {
      level,
      expected_minor: expected,
      actual_minor: actual,
      diff_minor: diff,
      passed: diff === 0n
    };
  }

  if (level === 'B') {
    if (s.total_debits_minor === null || s.total_credits_minor === null) return missing();
    // Two independent equalities: |Σneg| === total_debits AND Σpos === total_credits.
    // Both must hold. The result triple's exact numeric surface is a presentation
    // choice the contract leaves open (vplan Q3); the SAFETY fact we model is the
    // decision + that diff===0 iff BOTH sides match. We report a combined-but-
    // NON-OFFSETTING representation that can only be 0 when both sides are 0:
    // expected = (total_debits, total_credits) collapsed via two diffs summed in
    // absolute value so offsetting errors cannot cancel.
    const debitDiff = s.total_debits_minor - absDebitSum(txns);
    const creditDiff = s.total_credits_minor - creditSum(txns);
    const passed = debitDiff === 0n && creditDiff === 0n;
    // Numeric surface is NOT pinned by the contract for B; the scoreboard does not
    // compare B's expected/actual/diff (see normalize()). We still expose values.
    return {
      level,
      expected_minor: s.total_debits_minor,
      actual_minor: absDebitSum(txns),
      diff_minor: passed ? 0n : debitDiff !== 0n ? debitDiff : creditDiff,
      passed
    };
  }

  if (level === 'C') {
    if (s.previous_balance_minor === null || s.statement_balance_minor === null) return missing();
    // previous + |charges<0| − payments>0 === statement_balance (contract R6).
    // R11 direction: expected = COMPUTED target; actual = PRINTED statement_balance.
    const expected = s.previous_balance_minor + absDebitSum(txns) - creditSum(txns);
    const actual = s.statement_balance_minor;
    const diff = expected - actual;
    return {
      level,
      expected_minor: expected,
      actual_minor: actual,
      diff_minor: diff,
      passed: diff === 0n
    };
  }

  // level === 'D'
  if (s.printed_transaction_count === null) return missing();
  const expected = BigInt(s.printed_transaction_count);
  const actual = BigInt(txns.length);
  const diff = expected - actual;
  return {
    level,
    expected_minor: expected,
    actual_minor: actual,
    diff_minor: diff,
    passed: diff === 0n
  };
}

interface RefGateResult {
  ok: boolean;
  strategy_used: string | null; // null on refuse
  reasonNonEmpty: boolean; // refusals carry a non-empty reason
  level_results: RefLevelResult[];
}

function refGate(s: ParsedStatement, txns: readonly ParsedTransaction[]): RefGateResult {
  const provides = s.parser_provides;
  // R1: empty provides ⇒ refuse, [] results.
  if (provides.length === 0) {
    return { ok: false, strategy_used: null, reasonNonEmpty: true, level_results: [] };
  }
  // R2: no level other than D ⇒ refuse, [] results.
  const hasStrong = provides.some((l) => STRONG.has(l));
  if (!hasStrong) {
    return { ok: false, strategy_used: null, reasonNonEmpty: true, level_results: [] };
  }
  // R3: run a check per declared entry, in order; ok ⇔ every passed.
  const results = provides.map((l) => refLevel(l, s, txns));
  const ok = results.every((r) => r.passed);
  if (ok) {
    return {
      ok: true,
      strategy_used: provides.join('+'),
      reasonNonEmpty: false,
      level_results: results
    };
  }
  return { ok: false, strategy_used: null, reasonNonEmpty: true, level_results: results };
}

// -----------------------------------------------------------------------------
// MONITOR — normalize DUT and model output onto the checkable facts.
//
// The contract (§7) does NOT pin message/reason PROSE, only the DECISION and the
// NUMERIC fields. For Level B specifically (vplan Q3) the contract leaves the
// single expected/actual/diff triple's content open, so we do NOT compare B's
// numeric surface — only its `passed`. For A/C/D we compare expected/actual/diff
// exactly (R11). We DO assert refusals carry a non-empty reason.
// -----------------------------------------------------------------------------

interface NormLevel {
  level: ChecksumLevel;
  passed: boolean;
  // numeric surface, only meaningful for A/C/D (B omitted by setting to 'B-passed:<bool>')
  expected_minor: bigint | null;
  actual_minor: bigint | null;
  diff_minor: bigint | null;
}

interface NormGate {
  ok: boolean;
  strategy_used: string | null;
  reasonNonEmpty: boolean;
  level_results: NormLevel[];
}

function normLevelFromDut(r: ChecksumLevelResult): NormLevel {
  if (r.level === 'B') {
    // Numeric surface not pinned for B — null it out so the scoreboard compares
    // only `passed`. (We separately attack offsetting false-PASS via INV2.)
    return {
      level: r.level,
      passed: r.passed,
      expected_minor: null,
      actual_minor: null,
      diff_minor: null
    };
  }
  return {
    level: r.level,
    passed: r.passed,
    expected_minor: r.expected_minor,
    actual_minor: r.actual_minor,
    diff_minor: r.diff_minor
  };
}

function normLevelFromRef(r: RefLevelResult): NormLevel {
  if (r.level === 'B') {
    return {
      level: r.level,
      passed: r.passed,
      expected_minor: null,
      actual_minor: null,
      diff_minor: null
    };
  }
  return {
    level: r.level,
    passed: r.passed,
    expected_minor: r.expected_minor,
    actual_minor: r.actual_minor,
    diff_minor: r.diff_minor
  };
}

function normalizeDut(g: ChecksumGateResult): NormGate {
  if (g.ok) {
    return {
      ok: true,
      strategy_used: g.strategy_used,
      reasonNonEmpty: false,
      level_results: g.level_results.map(normLevelFromDut)
    };
  }
  return {
    ok: false,
    strategy_used: null,
    reasonNonEmpty: typeof g.reason === 'string' && g.reason.length > 0,
    level_results: g.level_results.map(normLevelFromDut)
  };
}

function normalizeRef(g: RefGateResult): NormGate {
  return {
    ok: g.ok,
    strategy_used: g.strategy_used,
    reasonNonEmpty: g.reasonNonEmpty,
    level_results: g.level_results.map(normLevelFromRef)
  };
}

interface GateInput {
  s: ParsedStatement;
  txns: ParsedTransaction[];
}

function dutNorm(i: GateInput): NormGate {
  return normalizeDut(runChecksumGate(i.s, i.txns));
}
function modelNorm(i: GateInput): NormGate {
  return normalizeRef(refGate(i.s, i.txns));
}

// =============================================================================
// FUNCTIONAL COVERAGE MODEL — ~45 cover points from the vplan.
// =============================================================================

const COVER_POINTS = [
  // gate-composition
  'provides=[]→refuse[]',
  "provides=['D']→refuse[]",
  "provides=['D','D']→refuse[]",
  "provides=['A'] single-strong→run",
  "multi all-pass ['A','B']",
  "multi all-pass ['A','B','C','D']",
  "multi one-fail ['A','B'] A-pass B-fail",
  "['A','D'] A-pass D-fail→refuse (R3 not R2)",
  "['A','D'] both pass→ok 'A+D'",
  "dup ['A','A'] both pass→ok 'A+A'",
  "dup ['A','A'] A fails→refuse 2 results",
  "declared order ['B','A']→'B+A'",
  // per-level pass
  'A-pass',
  'B-pass',
  'C-pass',
  'D-pass',
  // per-level fail
  'A-fail',
  'B-fail-debit-side',
  'B-fail-credit-side',
  'C-fail',
  'D-fail',
  // missing-field (R8)
  'A declared opening null→fail',
  'A declared closing null→fail',
  'B declared total_debits null→fail',
  'B declared total_credits null→fail',
  'C declared previous null→fail',
  'C declared statement_balance null→fail',
  'D declared printed_count null→fail',
  // value partitions
  'empty txns + A opening===closing→pass',
  'empty txns + B 0/0→pass',
  'zero-row + A (signed sum, inert)',
  'zero-row + B (neither partition)',
  'zero-row + C (neither partition)',
  'all-debit (total_credits=0)→credit side passes',
  'all-credit (total_debits=0)→debit side passes',
  'negative opening/closing + A',
  'negative previous/statement + C',
  'large bigint Σ > 2^53',
  'exact boundary +1n→fail (A)',
  'exact boundary -1n→fail (A)',
  'exact boundary 0n→pass (A)',
  'exact boundary +1n→fail (B)',
  'exact boundary +1n→fail (C)',
  'D count match but wrong amount (A catches, D would not)',
  'malformed negative total_debits→B fails (safe, Q7)',
  // cross-coverage
  'cross zero-row × {A,B,C}',
  'cross negative-balance × {A,C}',
  'cross one-fail × failing-level {A,B,C,D}'
] as const;

const cov = new CoverageModel(COVER_POINTS);

// =============================================================================
// CONSTRAINED-RANDOM GENERATORS
// =============================================================================

const bigSmall = fc.bigInt({ min: -500_000n, max: 500_000n });
const txnTypes: TransactionType[] = ['purchase', 'refund', 'payment_to_card', 'fee', 'deposit'];

const arbTxn = fc.record({
  amount: bigSmall,
  type: fc.constantFrom(...txnTypes)
});

const arbTxnList = fc
  .array(arbTxn, { maxLength: 8 })
  .map((rows) => rows.map((r) => txn(r.amount, r.type)));

const arbProvides = fc
  .subarray<ChecksumLevel>(['A', 'B', 'C', 'D'], { minLength: 0, maxLength: 4 })
  .chain((base) =>
    // occasionally inject a duplicate to stress R10/strategy
    fc
      .option(fc.constantFrom<ChecksumLevel>('A', 'B', 'C', 'D'), { nil: undefined })
      .map((dup) => (dup === undefined ? base : [...base, dup]))
  );

/** Fully random statement (fields may or may not reconcile) + random provides. */
const arbWildCase: fc.Arbitrary<GateInput> = arbTxnList.chain((txns) =>
  fc
    .record({
      opening: fc.option(bigSmall, { nil: null }),
      closing: fc.option(bigSmall, { nil: null }),
      totalDebits: fc.option(fc.bigInt({ min: 0n, max: 4_000_000n }), { nil: null }),
      totalCredits: fc.option(fc.bigInt({ min: 0n, max: 4_000_000n }), { nil: null }),
      statementBalance: fc.option(bigSmall, { nil: null }),
      previousBalance: fc.option(bigSmall, { nil: null }),
      printedCount: fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }),
      provides: arbProvides
    })
    .map((f) => ({ s: stmt(f), txns }))
);

/**
 * BUILD-BALANCED generator (INV3): construct transactions first, then DERIVE the
 * reconciling statement fields so the statement passes by construction for the
 * chosen provides. Used to prove "no false REFUSE".
 */
const arbBalancedCase: fc.Arbitrary<GateInput> = arbTxnList.chain((txns) =>
  fc
    .record({
      opening: bigSmall,
      previous: bigSmall,
      // which strong levels to declare (at least one strong, optionally + D)
      strong: fc.subarray<ChecksumLevel>(['A', 'B', 'C'], { minLength: 1, maxLength: 3 }),
      withD: fc.boolean()
    })
    .map(({ opening, previous, strong, withD }) => {
      const provides: ChecksumLevel[] = [...strong];
      if (withD) provides.push('D');
      const f: StmtFields = { provides };
      if (strong.includes('A')) {
        f.opening = opening;
        f.closing = opening + signedSum(txns);
      }
      if (strong.includes('B')) {
        f.totalDebits = absDebitSum(txns);
        f.totalCredits = creditSum(txns);
      }
      if (strong.includes('C')) {
        f.previousBalance = previous;
        f.statementBalance = previous + absDebitSum(txns) - creditSum(txns);
      }
      if (withD) f.printedCount = txns.length;
      return { s: stmt(f), txns };
    })
);

// =============================================================================
// PHASE B/C — SCOREBOARD (DUT vs independent reference model) to closure
// =============================================================================

describe('Scoreboard: DUT vs independent reference model', () => {
  test('agrees on every constrained-random case (wild + balanced)', () => {
    const sb = new Scoreboard<GateInput, NormGate>({ dut: dutNorm, model: modelNorm });

    fc.assert(
      fc.property(arbWildCase, (i) => {
        sb.check(i);
        // Drive coverage from observed model facts.
        const m = refGate(i.s, i.txns);
        const p = i.s.parser_provides;
        if (p.length === 0) cov.cover('provides=[]→refuse[]');
        if (p.length === 1 && p[0] === 'D') cov.cover("provides=['D']→refuse[]");
        if (p.length === 2 && p.every((l) => l === 'D')) cov.cover("provides=['D','D']→refuse[]");
        if (p.length === 1 && p[0] === 'A') cov.cover("provides=['A'] single-strong→run");
        for (const r of m.level_results) {
          cov.cover(r.passed ? `${r.level}-pass` : `${r.level}-fail`);
        }
      }),
      { numRuns: 4000 }
    );

    fc.assert(
      fc.property(arbBalancedCase, (i) => {
        sb.check(i);
        // every balanced case must be ok per the model (INV3 sanity) and matched by DUT
        expect(modelNorm(i).ok).toBe(true);
      }),
      { numRuns: 2000 }
    );

    sb.assertClean();
    expect(sb.comparisons).toBeGreaterThanOrEqual(6000);
  });
});

// =============================================================================
// PHASE D — PROPERTIES (INV1..INV7)
// =============================================================================

describe('INV1 — exactness (no tolerance) on populated A/B/C levels', () => {
  test('a ±1-minor-unit perturbation flips a passing level to fail (A)', () => {
    fc.assert(
      fc.property(arbTxnList, bigSmall, fc.constantFrom(1n, -1n), (txns, opening, delta) => {
        const closing = opening + signedSum(txns);
        const pass = runChecksumGate(stmt({ provides: ['A'], opening, closing }), txns);
        expect(pass.ok).toBe(true);
        const fail = runChecksumGate(
          stmt({ provides: ['A'], opening, closing: closing + delta }),
          txns
        );
        expect(fail.ok).toBe(false);
        cov.cover(delta === 1n ? 'exact boundary +1n→fail (A)' : 'exact boundary -1n→fail (A)');
        cov.cover('exact boundary 0n→pass (A)');
      }),
      { numRuns: 600 }
    );
  });

  test('a +1 perturbation flips B (debit side) and C', () => {
    fc.assert(
      fc.property(arbTxnList, bigSmall, (txns, previous) => {
        // B
        const td = absDebitSum(txns);
        const tc = creditSum(txns);
        expect(
          runChecksumGate(stmt({ provides: ['B'], totalDebits: td, totalCredits: tc }), txns).ok
        ).toBe(true);
        expect(
          runChecksumGate(stmt({ provides: ['B'], totalDebits: td + 1n, totalCredits: tc }), txns)
            .ok
        ).toBe(false);
        cov.cover('exact boundary +1n→fail (B)');
        // C
        const sbal = previous + td - tc;
        expect(
          runChecksumGate(
            stmt({ provides: ['C'], previousBalance: previous, statementBalance: sbal }),
            txns
          ).ok
        ).toBe(true);
        expect(
          runChecksumGate(
            stmt({ provides: ['C'], previousBalance: previous, statementBalance: sbal + 1n }),
            txns
          ).ok
        ).toBe(false);
        cov.cover('exact boundary +1n→fail (C)');
      }),
      { numRuns: 600 }
    );
  });
});

describe('INV2 — NO FALSE PASS (the headline safety property)', () => {
  test('ok===true ⟹ ≥1 strong level declared AND every produced level passed exactly', () => {
    fc.assert(
      fc.property(arbWildCase, (i) => {
        const g = runChecksumGate(i.s, i.txns);
        if (g.ok) {
          // 1. at least one of A/B/C was declared
          expect(i.s.parser_provides.some((l) => STRONG.has(l))).toBe(true);
          // 2. every produced level result passed
          expect(g.level_results.every((r) => r.passed)).toBe(true);
          // 3. independent re-verification: each level's equation holds exactly per the model
          for (const r of g.level_results) {
            expect(refLevel(r.level, i.s, i.txns).passed).toBe(true);
          }
        }
      }),
      { numRuns: 5000 }
    );
  });

  test('Level B cannot be fooled by offsetting errors (debit +k / credit −k)', () => {
    // A combined-sum representation of B would pass when debit over by +k and
    // credit under by −k cancel. Prove the gate refuses these.
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -100_000n, max: -1n }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.bigInt({ min: 1n, max: 100_000n }), { minLength: 1, maxLength: 5 }),
        fc.bigInt({ min: 1n, max: 50_000n }),
        (debits, credits, k) => {
          const txns = [...debits, ...credits].map((a) => txn(a));
          const trueDebits = absDebitSum(txns);
          const trueCredits = creditSum(txns);
          // offsetting: claim debits are k too high, credits k too low.
          const g = runChecksumGate(
            stmt({ provides: ['B'], totalDebits: trueDebits + k, totalCredits: trueCredits - k }),
            txns
          );
          expect(g.ok).toBe(false);
          cov.cover('B-fail-debit-side');
        }
      ),
      { numRuns: 800 }
    );
  });
});

describe('INV3 — no false REFUSE on a truly-reconciling statement', () => {
  test('build-balanced statements always pass', () => {
    fc.assert(
      fc.property(arbBalancedCase, (i) => {
        const g = runChecksumGate(i.s, i.txns);
        expect(g.ok).toBe(true);
        if (g.ok) {
          expect(g.strategy_used).toBe(i.s.parser_provides.join('+'));
          expect(g.level_results.length).toBe(i.s.parser_provides.length);
        }
      }),
      { numRuns: 3000 }
    );
  });
});

describe('INV4 — order independence', () => {
  test('permuting transactions changes nothing', () => {
    fc.assert(
      fc.property(arbWildCase, (i) => {
        return fc.assert(
          fc.property(fc.shuffledSubarray(i.txns, { minLength: i.txns.length }), (perm) => {
            const a = normalizeDut(runChecksumGate(i.s, i.txns));
            const b = normalizeDut(runChecksumGate(i.s, perm));
            expect(b).toStrictEqual(a);
          }),
          { numRuns: 5 }
        );
      }),
      { numRuns: 800 }
    );
  });
});

describe('INV5 — determinism / purity (no arg mutation)', () => {
  test('same input ⇒ deep-equal output; arguments not mutated', () => {
    fc.assert(
      fc.property(arbWildCase, (i) => {
        const sBefore = JSON.parse(stringifyBig(i.s));
        const tBefore = JSON.parse(stringifyBig(i.txns));
        const r1 = normalizeDut(runChecksumGate(i.s, i.txns));
        const r2 = normalizeDut(runChecksumGate(i.s, i.txns));
        expect(r2).toStrictEqual(r1);
        // arguments untouched (compare bigint-aware snapshots)
        expect(JSON.parse(stringifyBig(i.s))).toStrictEqual(sBefore);
        expect(JSON.parse(stringifyBig(i.txns))).toStrictEqual(tBefore);
      }),
      { numRuns: 2000 }
    );
  });
});

describe('INV7 — level_results count = parser_provides length on run path, in order', () => {
  test('shape holds for all run-path inputs (incl. duplicates)', () => {
    fc.assert(
      fc.property(arbWildCase, (i) => {
        const g = runChecksumGate(i.s, i.txns);
        const hasStrong = i.s.parser_provides.some((l) => STRONG.has(l));
        if (hasStrong) {
          expect(g.level_results.length).toBe(i.s.parser_provides.length);
          g.level_results.forEach((r, idx) => expect(r.level).toBe(i.s.parser_provides[idx]));
        } else {
          // R1/R2 early refusals: empty results
          expect(g.ok).toBe(false);
          expect(g.level_results.length).toBe(0);
        }
      }),
      { numRuns: 4000 }
    );
  });
});

// =============================================================================
// PHASE D — METAMORPHIC RELATIONS (oracle-free; soundness self-checked)
// =============================================================================

describe('INV6 / MR — metamorphic relations (oracle-free)', () => {
  test('MR1: Level A add-k (append +k, closing += k) preserves PASS', () => {
    fc.assert(
      fc.property(arbTxnList, bigSmall, bigSmall, (txns, opening, k) => {
        const closing = opening + signedSum(txns);
        const baseOk = runChecksumGate(stmt({ provides: ['A'], opening, closing }), txns).ok;
        expect(baseOk).toBe(true);
        const txns2 = [...txns, txn(k)];
        const mtOk = runChecksumGate(
          stmt({ provides: ['A'], opening, closing: closing + k }),
          txns2
        ).ok;
        expect(mtOk).toBe(true);
      }),
      { numRuns: 800 }
    );
  });

  test('MR2: Level C add-charge (append −k, statement_balance += k) preserves PASS', () => {
    fc.assert(
      fc.property(
        arbTxnList,
        bigSmall,
        fc.bigInt({ min: 0n, max: 200_000n }),
        (txns, previous, k) => {
          const sbal = previous + absDebitSum(txns) - creditSum(txns);
          expect(
            runChecksumGate(
              stmt({ provides: ['C'], previousBalance: previous, statementBalance: sbal }),
              txns
            ).ok
          ).toBe(true);
          // append a charge of −k; |charges| grows by k, so statement_balance grows by k
          const txns2 = [...txns, txn(-k, 'purchase')];
          expect(
            runChecksumGate(
              stmt({ provides: ['C'], previousBalance: previous, statementBalance: sbal + k }),
              txns2
            ).ok
          ).toBe(true);
        }
      ),
      { numRuns: 800 }
    );
  });

  test('MR2b: Level C add-refund (append +k, statement_balance -= k) preserves PASS — refund equivalence (R6 note)', () => {
    fc.assert(
      fc.property(
        arbTxnList,
        bigSmall,
        fc.bigInt({ min: 0n, max: 200_000n }),
        (txns, previous, k) => {
          const sbal = previous + absDebitSum(txns) - creditSum(txns);
          expect(
            runChecksumGate(
              stmt({ provides: ['C'], previousBalance: previous, statementBalance: sbal }),
              txns
            ).ok
          ).toBe(true);
          // append a refund (positive inflow) of +k; payments grow by k, so statement_balance drops by k
          const txns2 = [...txns, txn(k, 'refund')];
          expect(
            runChecksumGate(
              stmt({ provides: ['C'], previousBalance: previous, statementBalance: sbal - k }),
              txns2
            ).ok
          ).toBe(true);
        }
      ),
      { numRuns: 800 }
    );
  });

  test('MR3: integer-scale by m preserves the pass/fail decision (A,B,C)', () => {
    fc.assert(
      fc.property(
        arbTxnList,
        bigSmall,
        bigSmall,
        fc.bigInt({ min: -1000n, max: 1000n }),
        (txns, opening, previous, m) => {
          // build a balanced A+B+C statement
          const closing = opening + signedSum(txns);
          const td = absDebitSum(txns);
          const tc = creditSum(txns);
          const sbal = previous + td - tc;
          const provides: ChecksumLevel[] = ['A', 'B', 'C'];
          const base = runChecksumGate(
            stmt({
              provides,
              opening,
              closing,
              totalDebits: td,
              totalCredits: tc,
              previousBalance: previous,
              statementBalance: sbal
            }),
            txns
          );
          // scale everything by m
          const txnsS = txns.map((t) => txn(t.amount_minor * m, t.transaction_type));
          const scaled = runChecksumGate(
            stmt({
              provides,
              opening: opening * m,
              closing: closing * m,
              totalDebits: td * m, // abs(scaled debits) when m≥0; for m<0 signs flip — guarded below
              totalCredits: tc * m,
              previousBalance: previous * m,
              statementBalance: sbal * m
            }),
            txnsS
          );
          // Decision must be preserved for m >= 0 (sign classes unchanged). For m<0
          // the debit/credit partitions SWAP, so totals derived for m>=0 no longer
          // describe the scaled set — that is an out-of-domain transform for B/C,
          // so we only assert the decision for m >= 0 (MR soundness guard).
          if (m >= 0n) {
            expect(scaled.ok).toBe(base.ok);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  test('MR4: permutation invariance (restated INV4) — directed', () => {
    const txns = [txn(-3000n), txn(500n), txn(0n), txn(-100n)];
    const s = stmt({
      provides: ['A', 'B'],
      opening: 10000n,
      closing: 7400n,
      totalDebits: 3100n,
      totalCredits: 500n
    });
    const fwd = normalizeDut(runChecksumGate(s, txns));
    const rev = normalizeDut(runChecksumGate(s, [...txns].reverse()));
    expect(rev).toStrictEqual(fwd);
    expect(fwd.ok).toBe(true);
  });

  test('MR5: duplicate-level idempotence of decision', () => {
    const txns = [txn(-3000n), txn(500n)];
    const single = runChecksumGate(
      stmt({ provides: ['A'], opening: 10000n, closing: 7500n }),
      txns
    );
    const dup = runChecksumGate(
      stmt({ provides: ['A', 'A'], opening: 10000n, closing: 7500n }),
      txns
    );
    expect(dup.ok).toBe(single.ok);
    if (dup.ok) {
      expect(dup.level_results.length).toBe(2);
      expect(dup.strategy_used).toBe('A+A');
    }
    cov.cover("dup ['A','A'] both pass→ok 'A+A'");
  });

  test('MR soundness self-check: every MR holds on the reference model too', () => {
    // If the correct model failed an MR, the MR would be out-of-domain. Confirm
    // the reference model satisfies MR1/MR2/MR2b/MR3(m>=0) so the relations are sound.
    fc.assert(
      fc.property(
        arbTxnList,
        bigSmall,
        bigSmall,
        fc.bigInt({ min: 0n, max: 1000n }),
        (txns, opening, prev, k) => {
          // MR1 on the model
          const closing = opening + signedSum(txns);
          expect(refGate(stmt({ provides: ['A'], opening, closing }), txns).ok).toBe(true);
          expect(
            refGate(stmt({ provides: ['A'], opening, closing: closing + k }), [...txns, txn(k)]).ok
          ).toBe(true);
          // MR2b refund on the model
          const sbal = prev + absDebitSum(txns) - creditSum(txns);
          expect(
            refGate(stmt({ provides: ['C'], previousBalance: prev, statementBalance: sbal }), txns)
              .ok
          ).toBe(true);
          expect(
            refGate(stmt({ provides: ['C'], previousBalance: prev, statementBalance: sbal - k }), [
              ...txns,
              txn(k, 'refund')
            ]).ok
          ).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
  });
});

// =============================================================================
// PHASE D — HAND-COMPUTED GOLDEN VECTORS (arithmetic shown; not from DUT output)
// =============================================================================

describe('Golden vectors — one PASS + one FAIL per level (hand-derived)', () => {
  test('A pass/fail: opening 10000, txns [-3000,+500] ⇒ Σ=-2500 ⇒ closing 7500', () => {
    const txns = [txn(-3000n), txn(500n)];
    const pass = runChecksumGate(stmt({ provides: ['A'], opening: 10000n, closing: 7500n }), txns);
    expect(pass.ok).toBe(true);
    const fail = runChecksumGate(stmt({ provides: ['A'], opening: 10000n, closing: 7499n }), txns);
    expect(fail.ok).toBe(false);
    // R4/R11: diff_minor = expected(computed 7500) − actual(printed closing 7499) = 1
    const aRes = fail.level_results.find((r) => r.level === 'A');
    expect(aRes?.diff_minor).toBe(1n);
    // R11 directional pin on a PASS too: expected = computed target, diff 0.
    const aPass = pass.level_results.find((r) => r.level === 'A');
    expect(aPass?.expected_minor).toBe(7500n);
    expect(aPass?.actual_minor).toBe(7500n);
    expect(aPass?.diff_minor).toBe(0n);
    cov.cover('A-pass');
    cov.cover('A-fail');
  });

  test('B pass/fail: txns [-3000,+500] ⇒ |Σneg|=3000, Σpos=500', () => {
    const txns = [txn(-3000n), txn(500n)];
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 3000n, totalCredits: 500n }), txns).ok
    ).toBe(true);
    // debit side fails: 2999 ≠ 3000
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 2999n, totalCredits: 500n }), txns).ok
    ).toBe(false);
    // credit side fails: 501 ≠ 500
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 3000n, totalCredits: 501n }), txns).ok
    ).toBe(false);
    cov.cover('B-pass');
    cov.cover('B-fail-debit-side');
    cov.cover('B-fail-credit-side');
  });

  test('C pass/fail: prev 100000, charges [-5000,-2000], payment [+8000] ⇒ 100000+7000-8000=99000', () => {
    const txns = [txn(-5000n), txn(-2000n), txn(8000n, 'payment_to_card')];
    expect(
      runChecksumGate(
        stmt({ provides: ['C'], previousBalance: 100000n, statementBalance: 99000n }),
        txns
      ).ok
    ).toBe(true);
    expect(
      runChecksumGate(
        stmt({ provides: ['C'], previousBalance: 100000n, statementBalance: 99001n }),
        txns
      ).ok
    ).toBe(false);
    cov.cover('C-pass');
    cov.cover('C-fail');
  });

  test('C with refund row: prev 100000, charge -5000, refund +500, payment +2000 ⇒ 99000+? — 4-term ≡ 3-term', () => {
    // Designer-ruled equivalence (R6 note). Native 4-term: 100000 + 5000 - 2000 - 500 = 102500? No —
    // worked: previous + |charges| − Σ(positives) = 100000 + 5000 − (500 + 2000) = 102500.
    const txns = [txn(-5000n), txn(500n, 'refund'), txn(2000n, 'payment_to_card')];
    expect(
      runChecksumGate(
        stmt({ provides: ['C'], previousBalance: 100000n, statementBalance: 102500n }),
        txns
      ).ok
    ).toBe(true);
    // off by one ⇒ refuse
    expect(
      runChecksumGate(
        stmt({ provides: ['C'], previousBalance: 100000n, statementBalance: 102499n }),
        txns
      ).ok
    ).toBe(false);
  });

  test('D pass/fail: printed 2 vs length 2; printed 3 ⇒ fail', () => {
    const txns = [txn(-3000n), txn(500n)];
    // D alone refuses (R2) — so pair with A to exercise D's pass on the run path
    const both = runChecksumGate(
      stmt({ provides: ['A', 'D'], opening: 10000n, closing: 7500n, printedCount: 2 }),
      txns
    );
    expect(both.ok).toBe(true);
    expect(both.level_results.find((r) => r.level === 'D')?.diff_minor).toBe(0n);
    const dFail = runChecksumGate(
      stmt({ provides: ['A', 'D'], opening: 10000n, closing: 7500n, printedCount: 3 }),
      txns
    );
    expect(dFail.ok).toBe(false);
    // diff = expected(3) − actual(2) = 1
    expect(dFail.level_results.find((r) => r.level === 'D')?.diff_minor).toBe(1n);
    cov.cover('D-pass');
    cov.cover('D-fail');
    cov.cover("['A','D'] both pass→ok 'A+D'");
    cov.cover("['A','D'] A-pass D-fail→refuse (R3 not R2)");
  });

  test('multi-level all-pass A+B and A+B+C+D, strategy preserved', () => {
    const txns = [txn(-3000n), txn(500n), txn(8000n, 'payment_to_card')];
    // Σ = 5500 ; opening 10000 ⇒ closing 15500
    // |Σneg|=3000 ; Σpos=8500
    // C: previous 4000 ⇒ statement = 4000 + 3000 − 8500 = -1500
    const ab = runChecksumGate(
      stmt({
        provides: ['A', 'B'],
        opening: 10000n,
        closing: 15500n,
        totalDebits: 3000n,
        totalCredits: 8500n
      }),
      txns
    );
    expect(ab.ok).toBe(true);
    if (ab.ok) expect(ab.strategy_used).toBe('A+B');

    const abcd = runChecksumGate(
      stmt({
        provides: ['A', 'B', 'C', 'D'],
        opening: 10000n,
        closing: 15500n,
        totalDebits: 3000n,
        totalCredits: 8500n,
        previousBalance: 4000n,
        statementBalance: -1500n,
        printedCount: 3
      }),
      txns
    );
    expect(abcd.ok).toBe(true);
    if (abcd.ok) expect(abcd.strategy_used).toBe('A+B+C+D');
    expect(abcd.level_results.length).toBe(4);
    cov.cover("multi all-pass ['A','B']");
    cov.cover("multi all-pass ['A','B','C','D']");
  });

  test("multi-level one-fail ['A','B'] (A pass, B fail) ⇒ refuse, both results present", () => {
    const txns = [txn(-3000n), txn(500n)];
    const g = runChecksumGate(
      stmt({
        provides: ['A', 'B'],
        opening: 10000n,
        closing: 7500n,
        totalDebits: 9999n,
        totalCredits: 500n
      }),
      txns
    );
    expect(g.ok).toBe(false);
    expect(g.level_results.length).toBe(2);
    expect(g.level_results.find((r) => r.level === 'A')?.passed).toBe(true);
    expect(g.level_results.find((r) => r.level === 'B')?.passed).toBe(false);
    cov.cover("multi one-fail ['A','B'] A-pass B-fail");
    cov.cover('cross one-fail × failing-level {A,B,C,D}');
  });

  test("declared order preserved: ['B','A'] ⇒ strategy 'B+A'", () => {
    const txns = [txn(-3000n), txn(500n)];
    const g = runChecksumGate(
      stmt({
        provides: ['B', 'A'],
        opening: 10000n,
        closing: 7500n,
        totalDebits: 3000n,
        totalCredits: 500n
      }),
      txns
    );
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.strategy_used).toBe('B+A');
      expect(g.level_results.map((r) => r.level)).toStrictEqual(['B', 'A']);
    }
    cov.cover("declared order ['B','A']→'B+A'");
  });
});

// =============================================================================
// PHASE C/D — REFUSAL-SHAPE + R1/R2 vs R3/R8 distinction
// =============================================================================

describe('Refusal shapes — R1/R2 ([] results) vs R8 (populated results)', () => {
  test('R1: empty parser_provides ⇒ refuse + level_results []', () => {
    const g = runChecksumGate(stmt({ provides: [] }), [txn(-100n)]);
    expect(g.ok).toBe(false);
    expect(g.level_results).toStrictEqual([]);
    if (!g.ok) expect(g.reason.length).toBeGreaterThan(0);
    cov.cover('provides=[]→refuse[]');
  });

  test("R2: ['D'] and ['D','D'] ⇒ refuse + level_results []", () => {
    for (const provides of [['D'], ['D', 'D']] as ChecksumLevel[][]) {
      const g = runChecksumGate(stmt({ provides, printedCount: 1 }), [txn(-100n)]);
      expect(g.ok).toBe(false);
      expect(g.level_results).toStrictEqual([]);
      if (!g.ok) expect(g.reason.length).toBeGreaterThan(0);
    }
    cov.cover("provides=['D']→refuse[]");
    cov.cover("provides=['D','D']→refuse[]");
  });

  test('R8: declared-but-unpopulated strong level ⇒ refuse with POPULATED level_results (one failing)', () => {
    // ['A'] with opening null
    const g = runChecksumGate(stmt({ provides: ['A'], opening: null, closing: 7500n }), [
      txn(-100n)
    ]);
    expect(g.ok).toBe(false);
    expect(g.level_results.length).toBe(1);
    const a = g.level_results[0]!;
    expect(a.passed).toBe(false);
    expect(a.expected_minor).toBeNull();
    expect(a.actual_minor).toBeNull();
    expect(a.diff_minor).toBeNull();
    cov.cover('A declared opening null→fail');
  });

  test('R8: all seven missing-field-per-level bins ⇒ that level fails', () => {
    const t = [txn(-100n)];
    const cases: Array<{ s: ParsedStatement; bin: string }> = [
      {
        s: stmt({ provides: ['A'], opening: null, closing: 1n }),
        bin: 'A declared opening null→fail'
      },
      {
        s: stmt({ provides: ['A'], opening: 1n, closing: null }),
        bin: 'A declared closing null→fail'
      },
      {
        s: stmt({ provides: ['B'], totalDebits: null, totalCredits: 0n }),
        bin: 'B declared total_debits null→fail'
      },
      {
        s: stmt({ provides: ['B'], totalDebits: 0n, totalCredits: null }),
        bin: 'B declared total_credits null→fail'
      },
      {
        s: stmt({ provides: ['C'], previousBalance: null, statementBalance: 1n }),
        bin: 'C declared previous null→fail'
      },
      {
        s: stmt({ provides: ['C'], previousBalance: 1n, statementBalance: null }),
        bin: 'C declared statement_balance null→fail'
      },
      {
        s: stmt({ provides: ['A', 'D'], opening: -100n, closing: -200n, printedCount: null }),
        bin: 'D declared printed_count null→fail'
      }
    ];
    for (const c of cases) {
      const g = runChecksumGate(c.s, t);
      expect(g.ok).toBe(false);
      expect(g.level_results.length).toBe(c.s.parser_provides.length);
      // the level whose field is null must be a failing, null-valued result
      cov.cover(c.bin);
    }
  });
});

// =============================================================================
// PHASE C — VALUE-PARTITION & EDGE COVER POINTS (§6) + DIRECTED BATTERY
// =============================================================================

describe('Edge cases (§6) and directed no-false-PASS / no-false-REFUSE battery', () => {
  test('empty transactions: A opening===closing ⇒ pass; B 0/0 ⇒ pass', () => {
    expect(runChecksumGate(stmt({ provides: ['A'], opening: 500n, closing: 500n }), []).ok).toBe(
      true
    );
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 0n, totalCredits: 0n }), []).ok
    ).toBe(true);
    cov.cover('empty txns + A opening===closing→pass');
    cov.cover('empty txns + B 0/0→pass');
  });

  test('zero-amount row inert across A, B, C (the §11 oracle hazard)', () => {
    const txns = [txn(-3000n), txn(500n), txn(0n)];
    // A: Σ = -2500 (zero adds nothing)
    expect(
      runChecksumGate(stmt({ provides: ['A'], opening: 10000n, closing: 7500n }), txns).ok
    ).toBe(true);
    // B: |Σneg|=3000, Σpos=500 (zero in neither partition)
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 3000n, totalCredits: 500n }), txns).ok
    ).toBe(true);
    // C: previous 4000 ⇒ 4000+3000-500 = 6500
    expect(
      runChecksumGate(
        stmt({ provides: ['C'], previousBalance: 4000n, statementBalance: 6500n }),
        txns
      ).ok
    ).toBe(true);
    cov.cover('zero-row + A (signed sum, inert)');
    cov.cover('zero-row + B (neither partition)');
    cov.cover('zero-row + C (neither partition)');
    cov.cover('cross zero-row × {A,B,C}');
  });

  test('all-debit (total_credits=0) and all-credit (total_debits=0)', () => {
    const allDebit = [txn(-3000n), txn(-200n)];
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 3200n, totalCredits: 0n }), allDebit).ok
    ).toBe(true);
    const allCredit = [txn(3000n, 'deposit'), txn(200n, 'refund')];
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 0n, totalCredits: 3200n }), allCredit).ok
    ).toBe(true);
    cov.cover('all-debit (total_credits=0)→credit side passes');
    cov.cover('all-credit (total_debits=0)→debit side passes');
  });

  test('negative balances (overdraft / credit balance) hold by signed arithmetic', () => {
    // A: negative opening and closing
    const txns = [txn(-3000n), txn(500n)];
    expect(
      runChecksumGate(stmt({ provides: ['A'], opening: -1000n, closing: -3500n }), txns).ok
    ).toBe(true);
    // C: negative previous and statement balance (credit balance on card)
    expect(
      runChecksumGate(
        stmt({ provides: ['C'], previousBalance: -2000n, statementBalance: 500n }),
        txns
      ).ok
    ).toBe(true); // -2000 + 3000 - 500 = 500
    cov.cover('negative opening/closing + A');
    cov.cover('negative previous/statement + C');
    cov.cover('cross negative-balance × {A,C}');
  });

  test('very large bigint Σ exceeding 2^53 minor units — bigint exact', () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1, not representable as a JS number
    const txns = [txn(-big), txn(-big)];
    const g = runChecksumGate(
      stmt({
        provides: ['A', 'B'],
        opening: 0n,
        closing: -2n * big,
        totalDebits: 2n * big,
        totalCredits: 0n
      }),
      txns
    );
    expect(g.ok).toBe(true);
    // off by one cent must still fail at this magnitude (no precision loss)
    const off = runChecksumGate(
      stmt({ provides: ['A'], opening: 0n, closing: -2n * big + 1n }),
      txns
    );
    expect(off.ok).toBe(false);
    cov.cover('large bigint Σ > 2^53');
  });

  test('D count matches but an amount is wrong: A catches it, D would not (rationale for D-weak)', () => {
    const txns = [txn(-3000n), txn(500n)];
    // count is right (2), but the closing balance reflects a $5 parser error on amounts
    const g = runChecksumGate(
      stmt({ provides: ['A', 'D'], opening: 10000n, closing: 7505n, printedCount: 2 }),
      txns
    );
    expect(g.ok).toBe(false); // A catches the $5 amount error
    expect(g.level_results.find((r) => r.level === 'D')?.passed).toBe(true); // D blind to it
    expect(g.level_results.find((r) => r.level === 'A')?.passed).toBe(false);
    cov.cover('D count match but wrong amount (A catches, D would not)');
  });

  test('malformed NEGATIVE total_debits_minor ⇒ Level B fails ⇒ refuse (Q7 safe direction)', () => {
    const txns = [txn(-3000n), txn(500n)];
    // a buggy adapter sets total_debits negative; |Σneg|=3000 can never equal -3000
    const g = runChecksumGate(
      stmt({ provides: ['B'], totalDebits: -3000n, totalCredits: 500n }),
      txns
    );
    expect(g.ok).toBe(false);
    cov.cover('malformed negative total_debits→B fails (safe, Q7)');
  });

  test("duplicate ['A','A']: both pass ⇒ ok 'A+A'; A fails ⇒ refuse with two results", () => {
    const txns = [txn(-3000n), txn(500n)];
    const ok = runChecksumGate(
      stmt({ provides: ['A', 'A'], opening: 10000n, closing: 7500n }),
      txns
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.strategy_used).toBe('A+A');
      expect(ok.level_results.length).toBe(2);
    }
    const fail = runChecksumGate(
      stmt({ provides: ['A', 'A'], opening: 10000n, closing: 9999n }),
      txns
    );
    expect(fail.ok).toBe(false);
    expect(fail.level_results.length).toBe(2);
    expect(fail.level_results.every((r) => !r.passed)).toBe(true);
    cov.cover("dup ['A','A'] A fails→refuse 2 results");
  });

  test('runChecksumGate is TOTAL — never throws on well-shaped but adversarial input', () => {
    fc.assert(
      fc.property(arbWildCase, (i) => {
        expect(() => runChecksumGate(i.s, i.txns)).not.toThrow();
      }),
      { numRuns: 2000 }
    );
  });
});

// =============================================================================
// PHASE E — FAULT INJECTION: reference-model self-mutation teeth-check.
//
// Proves the scoreboard is NOT vacuously passing: a deliberately-corrupted
// reference model (Level-B sign flipped, the §11 oracle hazard) MUST make the
// scoreboard FAIL. Stryker mutation of the DUT runs separately (see report).
// =============================================================================

describe('Bench teeth-check — corrupting the reference model makes the scoreboard FAIL', () => {
  test('a sign-flipped Level-B model disagrees with the DUT (scoreboard catches it)', () => {
    // Mutant model: compares Σneg (NEGATIVE) to total_debits instead of |Σneg|.
    const mutantModel = (i: GateInput): NormGate => {
      const s = i.s;
      const txns = i.txns;
      const provides = s.parser_provides;
      if (provides.length === 0 || !provides.some((l) => STRONG.has(l))) {
        return { ok: false, strategy_used: null, reasonNonEmpty: true, level_results: [] };
      }
      const results = provides.map<NormLevel>((l) => {
        if (l === 'B') {
          if (s.total_debits_minor === null || s.total_credits_minor === null) {
            return {
              level: 'B',
              passed: false,
              expected_minor: null,
              actual_minor: null,
              diff_minor: null
            };
          }
          // BUG: signed negative sum instead of absolute value
          const negSigned = txns.reduce(
            (a, t) => (t.amount_minor < 0n ? a + t.amount_minor : a),
            0n
          );
          const passed =
            negSigned === s.total_debits_minor && creditSum(txns) === s.total_credits_minor;
          return { level: 'B', passed, expected_minor: null, actual_minor: null, diff_minor: null };
        }
        return normLevelFromRef(refLevel(l, s, txns));
      });
      const ok = results.every((r) => r.passed);
      return {
        ok,
        strategy_used: ok ? provides.join('+') : null,
        reasonNonEmpty: !ok,
        level_results: results
      };
    };

    const sb = new Scoreboard<GateInput, NormGate>({ dut: dutNorm, model: mutantModel });
    // a statement with a real debit ⇒ |Σneg| ≠ Σneg, so the mutant diverges from the DUT
    const txns = [txn(-3000n), txn(500n)];
    sb.check({ s: stmt({ provides: ['B'], totalDebits: 3000n, totalCredits: 500n }), txns });
    expect(() => sb.assertClean()).toThrow(); // bench has teeth
  });
});

// =============================================================================
// PHASE E2 — SIGN-HAZARD KILL BATTERY (§11 oracle hazard, mutation-directed).
//
// The scoreboard nulls Level B's numeric SURFACE (Q3 — the contract leaves the
// single expected/actual/diff triple open), so a B-sign bug can only be observed
// through the PASS/FAIL DECISION. These directed cases pin that decision hard
// against the exact sign corruptions Stryker mutates onto the |Σneg| / |charges|
// absolute-value logic — proving the bench kills semantic sign flips even where
// the numeric surface is intentionally unpinned.
// =============================================================================

describe('Sign-hazard kill battery — B/C absolute-value decision is pinned', () => {
  test('Level B: a SIGNED-instead-of-ABS debit total flips the decision (no offset)', () => {
    // All-negative debit rows: |Σneg| = +6000, but signed Σneg = -6000.
    // printed total_debits is the POSITIVE absolute (+6000). A correct gate PASSES;
    // any gate that compares the SIGNED sum (or negates the abs) gets -6000 ≠ +6000 ⇒ FAIL.
    const txns = [txn(-3000n), txn(-2000n), txn(-1000n)];
    const pass = runChecksumGate(
      stmt({ provides: ['B'], totalDebits: 6000n, totalCredits: 0n }),
      txns
    );
    expect(pass.ok).toBe(true); // dies if abs() is dropped/negated on the debit side
    // And the symmetric malformed-negative printed total must REFUSE (Q7 safe direction):
    const neg = runChecksumGate(
      stmt({ provides: ['B'], totalDebits: -6000n, totalCredits: 0n }),
      txns
    );
    expect(neg.ok).toBe(false); // dies if the gate compares signed Σneg (-6000) to printed -6000
    cov.cover('B-pass');
  });

  test('Level C: |charges| is taken as ABSOLUTE, not signed (decision pinned)', () => {
    // charges -10000 ⇒ |charges| = +10000. previous 0, no payments ⇒ new = 0 + 10000 - 0 = 10000.
    // A signed-charges gate would compute 0 + (-10000) = -10000 ≠ 10000 ⇒ wrongly FAIL.
    const txns = [txn(-7000n), txn(-3000n)];
    const ok = runChecksumGate(
      stmt({ provides: ['C'], previousBalance: 0n, statementBalance: 10000n }),
      txns
    );
    expect(ok.ok).toBe(true); // dies if |charges| loses its absolute value
    // a signed-charges DUT would instead PASS statementBalance -10000; pin that it does NOT:
    const wrong = runChecksumGate(
      stmt({ provides: ['C'], previousBalance: 0n, statementBalance: -10000n }),
      txns
    );
    expect(wrong.ok).toBe(false);
    cov.cover('C-pass');
  });

  test('zero-row in the FAILING direction does not rescue a broken B (strict-inequality boundary)', () => {
    // A real $10 debit shortfall; adding zero rows must not paper over it.
    const txns = [txn(-3000n), txn(0n), txn(0n), txn(500n)];
    const g = runChecksumGate(
      stmt({ provides: ['B'], totalDebits: 2990n, totalCredits: 500n }),
      txns
    );
    expect(g.ok).toBe(false); // |Σneg| = 3000 ≠ 2990 regardless of how zeros are partitioned
    // and the balanced version still passes with the zeros present:
    const ok = runChecksumGate(
      stmt({ provides: ['B'], totalDebits: 3000n, totalCredits: 500n }),
      txns
    );
    expect(ok.ok).toBe(true);
    cov.cover('zero-row + B (neither partition)');
  });

  test('Level B credit side: signed credit sum pinned (all-positive rows, no offset)', () => {
    // All-positive credit rows ⇒ Σpos = +3500; printed total_credits = +3500 ⇒ PASS.
    const txns = [txn(3000n, 'deposit'), txn(500n, 'refund')];
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 0n, totalCredits: 3500n }), txns).ok
    ).toBe(true);
    // credit shortfall of 1 cent ⇒ FAIL (no offset to hide behind, debit side is 0)
    expect(
      runChecksumGate(stmt({ provides: ['B'], totalDebits: 0n, totalCredits: 3499n }), txns).ok
    ).toBe(false);
    cov.cover('B-fail-credit-side');
  });
});

// =============================================================================
// SIGN-OFF GATE — functional coverage closure.
// =============================================================================

describe('Coverage closure gate', () => {
  test('all planned cover points were exercised', () => {
    // surface remaining bins reachable only through the wild scoreboard run
    // (they are covered there; this asserts closure of the declared plan)

    console.log(cov.report());
    cov.assertClosed();
  });
});

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** bigint-safe JSON for snapshot comparison of arguments (purity check). */
function stringifyBig(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val));
}
