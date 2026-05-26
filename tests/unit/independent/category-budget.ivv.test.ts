// =============================================================================
// IV&V verification environment — category-budget (US-P4-A, per-category budgets)
//
// Independent Verification & Validation. This file is authored by the
// verification-engineer WITHOUT reading src/lib/app/category-budget.ts or any
// Designer test for it. Everything below derives from the verification contract
// (specs/001-money-tracker-mvp/verification/category-budget.contract.md), the
// spec (US-P4-A), DECISIONS.md D14/D15, and constitution Principle II
// (bigint cents, no float; pct is display-only float).
//
// UVM -> software mapping realised here:
//   Sequencer/Generator : `arbTxns` / `arbLimits` constrained-random fast-check arbitraries
//   Driver              : direct call of the public DUT functions
//   Monitor             : `mapToSortedObj` / row-extraction helpers normalising DUT output
//   Reference Model     : `ref*` functions — an independent from-contract re-impl
//   Scoreboard          : tests/_framework Scoreboard{dut, model}
//   Assertions/Cover    : fast-check properties for INV1..INV5 + R1..R4
//   Coverage collector  : tests/_framework CoverageModel (functional coverage)
//   Fault injection     : Stryker (run separately) + a self-mutation teeth check
//
// Oracle discipline (Knight & Leveson): the scoreboard's reference model shares
// the spec with the DUT, so the load-bearing checks are oracle-INDEPENDENT —
// the bigint identity INV2 (remaining === limit - spent), the conservation law
// INV5 (refund netting down to floor 0), and hand-computed golden values whose
// arithmetic is shown inline. `pct` is float-by-design (contract §11): asserted
// with tolerance; `remaining_minor`/`over` (exact bigint/bool) are the primary
// oracles.
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { Scoreboard, deepEqual, stringify } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---- DUT (public exports only; never the implementation body) ---------------
import {
  netSpendingByCategory,
  computeCategoryBudgets,
  budgetTotals,
  type CategoryBudget
} from '../../../src/lib/app/category-budget';

// The DATA contract type. The contract (§2/§3) permits reading ONLY this type
// from spending-summary.ts. Re-declared here so the IV&V env is self-contained.
interface SummaryTransaction {
  posted_date: string;
  amount_minor: bigint;
  category_id: string | null;
}

// =============================================================================
// INDEPENDENT REFERENCE MODEL  (the "golden" — written from the contract alone)
//
// R1 (contract §4): for each category_id (incl null), signed sum of amount_minor,
//   then spending magnitude = max(0, -sum). Net inflow / break-even -> 0n.
// R2 (contract §4): one row per `limits` entry with limit_minor > 0n; <= 0n
//   omitted. spent = R1 net spending or 0n. remaining = limit - spent.
//   pct = Number(spent)/Number(limit)*100. over = spent > limit (STRICT).
// R3 (contract §4): rows sorted by pct desc, ties by category_id asc.
// R4 (contract §4): budgetTotals sums limit & spent; remaining = limit - spent.
// All money arithmetic is bigint; only `pct` is ever routed through Number.
// =============================================================================

/** R1 reference: signed sum per category, then max(0, -sum). */
function refNetSpendingByCategory(txns: readonly SummaryTransaction[]): Map<string | null, bigint> {
  // First accumulate the SIGNED sum per category (independent of DUT).
  const signed = new Map<string | null, bigint>();
  for (const t of txns) {
    signed.set(t.category_id, (signed.get(t.category_id) ?? 0n) + t.amount_minor);
  }
  // Then map each to its spending magnitude = max(0, -sum).
  const out = new Map<string | null, bigint>();
  for (const [cat, sum] of signed) {
    const magnitude = -sum;
    out.set(cat, magnitude > 0n ? magnitude : 0n);
  }
  return out;
}

/** R2 spent for a single category, from R1, defaulting to 0n. */
function refSpentFor(net: ReadonlyMap<string | null, bigint>, cat: string): bigint {
  return net.get(cat) ?? 0n;
}

interface RefBudget {
  category_id: string;
  limit_minor: bigint;
  spent_minor: bigint;
  remaining_minor: bigint;
  pct: number;
  over: boolean;
}

/** R2 + R3 reference. */
function refComputeCategoryBudgets(
  limits: Record<string, bigint>,
  txns: readonly SummaryTransaction[]
): RefBudget[] {
  const net = refNetSpendingByCategory(txns);
  const rows: RefBudget[] = [];
  for (const cat of Object.keys(limits)) {
    const limit = limits[cat]!; // key from Object.keys -> always present
    if (limit <= 0n) continue; // R2: omit non-positive limits
    const spent = refSpentFor(net, cat);
    const remaining = limit - spent;
    const pct = (Number(spent) / Number(limit)) * 100;
    const over = spent > limit; // STRICT (exactly-at-limit is NOT over)
    rows.push({
      category_id: cat,
      limit_minor: limit,
      spent_minor: spent,
      remaining_minor: remaining,
      pct,
      over
    });
  }
  // R3: pct desc, ties by category_id asc.
  rows.sort((a, b) => {
    if (a.pct !== b.pct) return b.pct - a.pct;
    return a.category_id < b.category_id ? -1 : a.category_id > b.category_id ? 1 : 0;
  });
  return rows;
}

// (budgetTotals R4 is covered by an INV2 property + hand-computed golden values
// below; its reference model was only used by the removed totals scoreboard.)

// =============================================================================
// MONITORS  (normalise DUT output for scoreboard comparison)
// =============================================================================

/** Map -> array of [key,val] sorted by stringified key — order-independent. */
function mapToSortedPairs(m: ReadonlyMap<string | null, bigint>): [string, string][] {
  return [...m.entries()]
    .map(([k, v]) => [String(k), `${v}n`] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Strip pct (float) from a row set for the EXACT bigint/bool scoreboard. */
function rowsExact(
  rows: readonly CategoryBudget[] | readonly RefBudget[]
): { category_id: string; limit: string; spent: string; remaining: string; over: boolean }[] {
  return rows.map((r) => ({
    category_id: r.category_id,
    limit: `${r.limit_minor}n`,
    spent: `${r.spent_minor}n`,
    remaining: `${r.remaining_minor}n`,
    over: r.over
  }));
}

// =============================================================================
// GENERATORS  (constrained-random stimulus encoding the legal input domain)
// =============================================================================

// A small category-id alphabet so collisions (same category across many txns,
// shared keys between limits & txns) actually happen. Includes integer-LIKE keys
// ('0','1','42') to stress JS object-key iteration-order (INV4) and null.
const CAT_IDS = ['food', 'rent', 'fun', 'gas', '0', '1', '42', 'Travel', 'travel'];

const arbCategory: fc.Arbitrary<string | null> = fc.oneof(
  fc.constantFrom(...CAT_IDS),
  fc.constant<string | null>(null)
);

// Signed bigint amounts: spending (negative), inflow/refund (positive), and zero.
const arbAmount: fc.Arbitrary<bigint> = fc.oneof(
  { weight: 5, arbitrary: fc.bigInt({ min: -2_000_000n, max: -1n }) }, // purchases
  { weight: 3, arbitrary: fc.bigInt({ min: 1n, max: 2_000_000n }) }, // inflows/refunds
  { weight: 1, arbitrary: fc.constant(0n) } // zero
);

const arbTxn: fc.Arbitrary<SummaryTransaction> = fc.record({
  posted_date: fc.constant('2026-05-01'), // month-windowing is out of scope (§7)
  amount_minor: arbAmount,
  category_id: arbCategory
});

const arbTxns: fc.Arbitrary<SummaryTransaction[]> = fc.array(arbTxn, { maxLength: 30 });

// Limits: a record from category-id -> bigint limit, incl <=0 (omitted) and
// positive; keys may or may not overlap with txn categories. Integer-like keys
// included. Never a null key (you can't set a limit on uncategorized — §7).
const arbLimitKey: fc.Arbitrary<string> = fc.constantFrom(...CAT_IDS);
const arbLimitVal: fc.Arbitrary<bigint> = fc.oneof(
  { weight: 5, arbitrary: fc.bigInt({ min: 1n, max: 3_000_000n }) }, // positive
  { weight: 2, arbitrary: fc.bigInt({ min: -1_000_000n, max: -1n }) }, // negative -> omit
  { weight: 1, arbitrary: fc.constant(0n) } // zero -> omit
);

const arbLimits: fc.Arbitrary<Record<string, bigint>> = fc
  .array(fc.tuple(arbLimitKey, arbLimitVal), { maxLength: 8 })
  .map((pairs) => {
    const rec: Record<string, bigint> = {};
    for (const [k, v] of pairs) rec[k] = v; // later wins (dedup keys)
    return rec;
  });

// =============================================================================
// FUNCTIONAL COVERAGE MODEL  (the verification plan's cover points)
// Each maps back to an R#/INV#/§6 edge in the traceability matrix.
// =============================================================================

const cov = new CoverageModel([
  // R1 / netSpendingByCategory
  'R1: category net spending (sum<0 -> positive magnitude)',
  'R1: category net inflow -> 0n (never negative)',
  'R1: category break-even (sum==0) -> 0n',
  'R1: null category present',
  'R1: empty txns -> empty map',
  // R2 budget rows
  'R2: limit>0 produces a row',
  'R2: limit<=0 omitted (negative)',
  'R2: limit==0 omitted',
  'R2: limit with NO matching spend -> spent 0n',
  'R2: spend with NO limit -> omitted (no row)',
  'R2: under budget (spent<limit, over=false)',
  'R2: exactly at limit (spent==limit, over=false, remaining 0)',
  'R2: over budget (spent>limit, over=true, remaining<0)',
  // R3 ordering
  'R3: >=2 rows present (ordering exercised)',
  'R3: pct tie broken by category_id asc',
  // R4 totals
  'R4: budgetTotals over multiple rows',
  'R4: budgetTotals over empty rows -> 0n/0n/0n',
  // INV5 refund netting
  'INV5: refund reduces spent toward 0',
  'INV5: refund drives spent to floor 0 (net inflow)',
  // §6 edges
  'edge: empty limits -> no rows',
  'edge: very large bigint amounts/limits',
  'edge: tiny limit vs huge spend (large finite pct, no Infinity)',
  'edge: integer-like category keys'
]);

// =============================================================================
// SCOREBOARDS  (DUT vs independent reference model)
// =============================================================================

const sbNet = new Scoreboard<readonly SummaryTransaction[], [string, string][]>({
  dut: (t) => mapToSortedPairs(netSpendingByCategory(t)),
  model: (t) => mapToSortedPairs(refNetSpendingByCategory(t)),
  show: (t) => stringify(t)
});

interface BudgetInput {
  limits: Record<string, bigint>;
  txns: readonly SummaryTransaction[];
}

// EXACT scoreboard: bigint/bool only (pct compared separately with tolerance).
const sbBudgets = new Scoreboard<
  BudgetInput,
  { category_id: string; limit: string; spent: string; remaining: string; over: boolean }[]
>({
  dut: (i) => rowsExact(computeCategoryBudgets(i.limits, i.txns)),
  model: (i) => rowsExact(refComputeCategoryBudgets(i.limits, i.txns)),
  show: (i) => stringify(i)
});

// (budgetTotals is covered by the INV2 totals-identity properties below; the
// separate totals scoreboard the VE drafted was unwired/dead and was removed on
// promotion — no loss of coverage.)

// =============================================================================
// PHASE C — drive stimulus to coverage closure + scoreboard agreement
// =============================================================================

describe('category-budget IV&V — scoreboard (DUT vs independent reference model)', () => {
  test('netSpendingByCategory agrees with reference model over constrained-random txns', () => {
    fc.assert(
      fc.property(arbTxns, (txns) => {
        // cover-point instrumentation
        if (txns.length === 0) cov.cover('R1: empty txns -> empty map');
        const net = refNetSpendingByCategory(txns);
        const signed = new Map<string | null, bigint>();
        for (const t of txns)
          signed.set(t.category_id, (signed.get(t.category_id) ?? 0n) + t.amount_minor);
        for (const [cat, sum] of signed) {
          if (sum < 0n) cov.cover('R1: category net spending (sum<0 -> positive magnitude)');
          if (sum > 0n) cov.cover('R1: category net inflow -> 0n (never negative)');
          if (sum === 0n) cov.cover('R1: category break-even (sum==0) -> 0n');
          if (cat === null) cov.cover('R1: null category present');
        }
        // INV1: every value non-negative bigint
        for (const v of net.values()) {
          expect(typeof v).toBe('bigint');
          expect(v >= 0n).toBe(true);
        }
        sbNet.check(txns);
      }),
      { numRuns: 600 }
    );
    sbNet.assertClean();
  });

  test('computeCategoryBudgets agrees with reference model (exact bigint/bool oracle)', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, (limits, txns) => {
        const input: BudgetInput = { limits, txns };
        const ref = refComputeCategoryBudgets(limits, txns);

        // cover-point instrumentation off the reference model
        if (Object.keys(limits).length === 0) cov.cover('edge: empty limits -> no rows');
        for (const k of Object.keys(limits)) {
          const v = limits[k]!;
          if (v > 0n) cov.cover('R2: limit>0 produces a row');
          if (v < 0n) cov.cover('R2: limit<=0 omitted (negative)');
          if (v === 0n) cov.cover('R2: limit==0 omitted');
          if (/^\d+$/.test(k)) cov.cover('edge: integer-like category keys');
        }
        const net = refNetSpendingByCategory(txns);
        for (const r of ref) {
          if (r.spent_minor === 0n) cov.cover('R2: limit with NO matching spend -> spent 0n');
          if (r.spent_minor < r.limit_minor)
            cov.cover('R2: under budget (spent<limit, over=false)');
          if (r.spent_minor === r.limit_minor)
            cov.cover('R2: exactly at limit (spent==limit, over=false, remaining 0)');
          if (r.over) cov.cover('R2: over budget (spent>limit, over=true, remaining<0)');
        }
        // spend with no limit -> not a row
        for (const [cat, mag] of net) {
          if (cat !== null && mag > 0n && !(cat in limits))
            cov.cover('R2: spend with NO limit -> omitted (no row)');
        }
        if (ref.length >= 2) {
          cov.cover('R3: >=2 rows present (ordering exercised)');
          for (let i = 0; i + 1 < ref.length; i++) {
            if (ref[i]!.pct === ref[i + 1]!.pct) cov.cover('R3: pct tie broken by category_id asc');
          }
        }

        sbBudgets.check(input);
      }),
      { numRuns: 800 }
    );
    sbBudgets.assertClean();
  });
});

// =============================================================================
// PHASE D — oracle-independent checks: INVARIANTS as fast-check properties
// =============================================================================

describe('category-budget IV&V — invariants (oracle-independent)', () => {
  test('INV1 non-negativity & bigint type; pct >= 0 and finite', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, (limits, txns) => {
        const rows = computeCategoryBudgets(limits, txns);
        for (const r of rows) {
          expect(typeof r.limit_minor).toBe('bigint');
          expect(typeof r.spent_minor).toBe('bigint');
          expect(typeof r.remaining_minor).toBe('bigint');
          expect(r.spent_minor >= 0n).toBe(true); // INV1
          expect(typeof r.pct).toBe('number');
          expect(r.pct >= 0).toBe(true); // INV1
          expect(Number.isFinite(r.pct)).toBe(true); // no Infinity for representable bigints
          expect(Number.isNaN(r.pct)).toBe(false);
        }
      }),
      { numRuns: 600 }
    );
  });

  test('INV2 remaining identity: remaining_minor === limit_minor - spent_minor (exact bigint)', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, (limits, txns) => {
        const rows = computeCategoryBudgets(limits, txns);
        for (const r of rows) {
          expect(r.remaining_minor).toBe(r.limit_minor - r.spent_minor);
        }
        // totals identity
        const t = budgetTotals(rows);
        let limSum = 0n;
        let spSum = 0n;
        for (const r of rows) {
          limSum += r.limit_minor;
          spSum += r.spent_minor;
        }
        expect(t.limit_minor).toBe(limSum);
        expect(t.spent_minor).toBe(spSum);
        expect(t.remaining_minor).toBe(t.limit_minor - t.spent_minor);
      }),
      { numRuns: 600 }
    );
  });

  test('INV3 over <=> remaining<0 <=> spent>limit', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, (limits, txns) => {
        const rows = computeCategoryBudgets(limits, txns);
        for (const r of rows) {
          expect(r.over).toBe(r.remaining_minor < 0n);
          expect(r.over).toBe(r.spent_minor > r.limit_minor);
        }
      }),
      { numRuns: 600 }
    );
  });

  test('INV4 determinism & purity: same input -> identical output; inputs not mutated', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, (limits, txns) => {
        const limitsSnap = stringify(Object.entries(limits).sort());
        const txnsSnap = stringify(txns);

        const a = computeCategoryBudgets(limits, txns);
        const b = computeCategoryBudgets(limits, txns);
        expect(deepEqual(rowsExact(a), rowsExact(b))).toBe(true);
        for (let i = 0; i < a.length; i++) expect(a[i]!.pct).toBe(b[i]!.pct);

        // inputs not mutated
        expect(stringify(Object.entries(limits).sort())).toBe(limitsSnap);
        expect(stringify(txns)).toBe(txnsSnap);
      }),
      { numRuns: 400 }
    );
  });

  test('INV4 order-independence: shuffling txn order and limits key order does not change output', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, fc.bigInt(), (limits, txns, seed) => {
        const base = computeCategoryBudgets(limits, txns);

        // shuffle txns deterministically
        const shuffledTxns = [...txns].reverse();
        // re-insert limits keys in a different (reversed) order
        const reorderedLimits: Record<string, bigint> = {};
        for (const k of Object.keys(limits).reverse()) reorderedLimits[k] = limits[k]!;

        const alt = computeCategoryBudgets(reorderedLimits, shuffledTxns);
        expect(deepEqual(rowsExact(base), rowsExact(alt))).toBe(true);
        for (let i = 0; i < base.length; i++) expect(base[i]!.pct).toBe(alt[i]!.pct);
        void seed;
      }),
      { numRuns: 400 }
    );
  });

  test('INV5 refund netting (CONSERVATION law): adding a refund in C reduces C.spent by that amount, floored at 0', () => {
    // Conservation: for a category whose pre-refund spend magnitude is S (S>=0),
    // adding a positive refund r in C makes new spent = max(0, S - r).
    fc.assert(
      fc.property(
        fc.constantFrom('food', 'rent', 'fun', 'gas'),
        fc.bigInt({ min: 1n, max: 1_000_000n }), // limit
        fc.bigInt({ min: 1n, max: 5_000_000n }), // purchase magnitude
        fc.bigInt({ min: 1n, max: 5_000_000n }), // refund amount
        (cat, limit, purchaseMag, refund) => {
          const baseTxns: SummaryTransaction[] = [
            { posted_date: '2026-05-01', amount_minor: -purchaseMag, category_id: cat }
          ];
          const limits = { [cat]: limit };

          const before = computeCategoryBudgets(limits, baseTxns);
          const beforeRow = before.find((r) => r.category_id === cat)!;
          const spentBefore = beforeRow.spent_minor; // == purchaseMag (R1)

          const withRefund: SummaryTransaction[] = [
            ...baseTxns,
            { posted_date: '2026-05-01', amount_minor: refund, category_id: cat }
          ];
          const after = computeCategoryBudgets(limits, withRefund);
          const afterRow = after.find((r) => r.category_id === cat)!;
          const spentAfter = afterRow.spent_minor;

          const expectedAfter = spentBefore - refund > 0n ? spentBefore - refund : 0n;
          expect(spentAfter).toBe(expectedAfter); // INV5 + floor
          expect(spentAfter >= 0n).toBe(true); // never negative

          if (refund < spentBefore) cov.cover('INV5: refund reduces spent toward 0');
          if (refund >= spentBefore) cov.cover('INV5: refund drives spent to floor 0 (net inflow)');
        }
      ),
      { numRuns: 500 }
    );
  });
});

// =============================================================================
// PHASE D (cont.) — METAMORPHIC relations (oracle-free; validity-domain-bounded)
// =============================================================================

describe('category-budget IV&V — metamorphic relations', () => {
  // MR1: permutation invariance of txns (subsumes INV4 order independence but
  // stated as a metamorphic relation). Validity domain: same multiset of txns.
  test('MR1 txn permutation invariance', () => {
    fc.assert(
      fc.property(arbLimits, arbTxns, (limits, txns) => {
        const base = rowsExact(computeCategoryBudgets(limits, txns));
        const permuted = rowsExact(
          computeCategoryBudgets(limits, [...txns].sort(() => 0).reverse())
        );
        expect(deepEqual(base, permuted)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  // MR2: aggregation invariance — splitting one purchase into N smaller pieces in
  // the SAME category yields identical spent (sum is associative over bigint).
  // Validity domain: exact bigint arithmetic, so no FP hazard (Phase-D soundness).
  test('MR2 splitting a purchase into parts is conservation-neutral', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('food', 'rent', 'fun'),
        fc.bigInt({ min: 2n, max: 2_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        (cat, mag, limit) => {
          const whole: SummaryTransaction[] = [
            { posted_date: '2026-05-01', amount_minor: -mag, category_id: cat }
          ];
          const partA = mag / 2n;
          const partB = mag - partA;
          const split: SummaryTransaction[] = [
            { posted_date: '2026-05-01', amount_minor: -partA, category_id: cat },
            { posted_date: '2026-05-01', amount_minor: -partB, category_id: cat }
          ];
          const limits = { [cat]: limit };
          const r1 = rowsExact(computeCategoryBudgets(limits, whole));
          const r2 = rowsExact(computeCategoryBudgets(limits, split));
          expect(deepEqual(r1, r2)).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  // MR3: adding an inflow-only NEW category (with no limit) never changes any
  // existing budget row. Validity domain: new category not in limits.
  test('MR3 adding an unbudgeted/inflow txn never changes budgeted rows', () => {
    fc.assert(
      fc.property(
        arbLimits,
        arbTxns,
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        (limits, txns, inflow) => {
          const base = rowsExact(computeCategoryBudgets(limits, txns));
          // 'unbudgeted_x' is guaranteed not in CAT_IDS / limits
          const augmented: SummaryTransaction[] = [
            ...txns,
            { posted_date: '2026-05-01', amount_minor: inflow, category_id: 'unbudgeted_x' }
          ];
          const after = rowsExact(computeCategoryBudgets(limits, augmented));
          expect(deepEqual(base, after)).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// =============================================================================
// PHASE C (cont.) — DIRECTED corners + HAND-COMPUTED golden values
// (oracle-EXTERNAL: arithmetic shown inline, not derived from the DUT)
// =============================================================================

describe('category-budget IV&V — directed golden values', () => {
  test('GOLDEN: food limit 8000, spend 9000 -> over, remaining -1000, pct 112.5', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -9000n, category_id: 'food' }
    ];
    const rows = computeCategoryBudgets({ food: 8000n }, txns);
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.category_id).toBe('food');
    expect(r.limit_minor).toBe(8000n);
    expect(r.spent_minor).toBe(9000n); // max(0, -(-9000)) = 9000
    expect(r.remaining_minor).toBe(-1000n); // 8000 - 9000
    expect(r.over).toBe(true); // 9000 > 8000
    expect(r.pct).toBeCloseTo(112.5, 9); // 9000/8000*100
  });

  test('GOLDEN: purchase -5000 + refund +2000 -> spent 3000 (INV5 netting)', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -5000n, category_id: 'food' },
      { posted_date: '2026-05-01', amount_minor: 2000n, category_id: 'food' }
    ];
    const rows = computeCategoryBudgets({ food: 10000n }, txns);
    const r = rows[0]!;
    expect(r.spent_minor).toBe(3000n); // max(0, -(-5000+2000)) = max(0,3000) = 3000
    expect(r.remaining_minor).toBe(7000n); // 10000 - 3000
    expect(r.over).toBe(false);
    expect(r.pct).toBeCloseTo(30, 9); // 3000/10000*100
  });

  test('GOLDEN: refund exceeds purchase -> net inflow -> spent FLOORED at 0', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -2000n, category_id: 'food' },
      { posted_date: '2026-05-01', amount_minor: 5000n, category_id: 'food' } // net +3000
    ];
    const rows = computeCategoryBudgets({ food: 10000n }, txns);
    const r = rows[0]!;
    expect(r.spent_minor).toBe(0n); // floor: never negative
    expect(r.remaining_minor).toBe(10000n);
    expect(r.over).toBe(false);
    expect(r.pct).toBeCloseTo(0, 9);
  });

  test('GOLDEN: exactly at limit -> over=false, remaining 0', () => {
    const rows = computeCategoryBudgets({ food: 5000n }, [
      { posted_date: '2026-05-01', amount_minor: -5000n, category_id: 'food' }
    ]);
    const r = rows[0]!;
    expect(r.spent_minor).toBe(5000n);
    expect(r.remaining_minor).toBe(0n);
    expect(r.over).toBe(false); // strict: 5000 > 5000 is false
    expect(r.pct).toBeCloseTo(100, 9);
    cov.cover('R2: exactly at limit (spent==limit, over=false, remaining 0)');
  });

  test('GOLDEN: limit<=0 omitted; spend without limit omitted; limit without spend -> spent 0', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -3000n, category_id: 'gas' }, // no limit -> omitted
      { posted_date: '2026-05-01', amount_minor: -1000n, category_id: 'food' } // has limit
    ];
    const limits = { food: 5000n, rent: 4000n, neg: -100n, zero: 0n }; // rent has no spend
    const rows = computeCategoryBudgets(limits, txns);
    const ids = rows.map((r) => r.category_id).sort();
    expect(ids).toEqual(['food', 'rent']); // neg & zero omitted; gas has no limit
    const rent = rows.find((r) => r.category_id === 'rent')!;
    expect(rent.spent_minor).toBe(0n); // limit with no matching spend
    expect(rent.over).toBe(false);
    cov.cover('R2: limit<=0 omitted (negative)');
    cov.cover('R2: limit==0 omitted');
    cov.cover('R2: spend with NO limit -> omitted (no row)');
    cov.cover('R2: limit with NO matching spend -> spent 0n');
  });

  test('GOLDEN R3: sorted by pct desc, ties by category_id asc', () => {
    // food: 1000/2000 = 50%; fun: 1000/2000 = 50% (tie -> food before fun);
    // rent: 3000/2000 = 150% (top). Distinct middle: gas 1000/4000 = 25%.
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -1000n, category_id: 'food' },
      { posted_date: '2026-05-01', amount_minor: -1000n, category_id: 'fun' },
      { posted_date: '2026-05-01', amount_minor: -3000n, category_id: 'rent' },
      { posted_date: '2026-05-01', amount_minor: -1000n, category_id: 'gas' }
    ];
    const limits = { food: 2000n, fun: 2000n, rent: 2000n, gas: 4000n };
    const rows = computeCategoryBudgets(limits, txns);
    expect(rows.map((r) => r.category_id)).toEqual(['rent', 'food', 'fun', 'gas']);
    cov.cover('R3: >=2 rows present (ordering exercised)');
    cov.cover('R3: pct tie broken by category_id asc');
  });

  test('GOLDEN R3: 3-way all-equal-pct tie sorts STRICTLY by category_id asc (comparator kill pressure)', () => {
    // All three identical pct (5000/10000 = 50%): only the tie-break decides order.
    // Reverse-supplied so a no-op / reversed comparator would surface.
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -5000n, category_id: 'gamma' },
      { posted_date: '2026-05-01', amount_minor: -5000n, category_id: 'beta' },
      { posted_date: '2026-05-01', amount_minor: -5000n, category_id: 'alpha' }
    ];
    const limits = { gamma: 10000n, beta: 10000n, alpha: 10000n };
    const rows = computeCategoryBudgets(limits, txns);
    // strict ascending category_id under a pure tie
    expect(rows.map((r) => r.category_id)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('GOLDEN R4: budgetTotals sums limit & spent, remaining = limit - spent', () => {
    const rows: CategoryBudget[] = [
      {
        category_id: 'a',
        limit_minor: 5000n,
        spent_minor: 3000n,
        remaining_minor: 2000n,
        pct: 60,
        over: false
      },
      {
        category_id: 'b',
        limit_minor: 2000n,
        spent_minor: 5000n,
        remaining_minor: -3000n,
        pct: 250,
        over: true
      }
    ];
    const t = budgetTotals(rows);
    expect(t.limit_minor).toBe(7000n); // 5000+2000
    expect(t.spent_minor).toBe(8000n); // 3000+5000
    expect(t.remaining_minor).toBe(-1000n); // 7000-8000
    cov.cover('R4: budgetTotals over multiple rows');
  });

  test('GOLDEN R4: budgetTotals over empty rows -> 0n/0n/0n', () => {
    const t = budgetTotals([]);
    expect(t.limit_minor).toBe(0n);
    expect(t.spent_minor).toBe(0n);
    expect(t.remaining_minor).toBe(0n);
    cov.cover('R4: budgetTotals over empty rows -> 0n/0n/0n');
  });

  test('GOLDEN edge: empty txns -> spent 0 for every positive-limit category', () => {
    const rows = computeCategoryBudgets({ food: 5000n, rent: 3000n }, []);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.spent_minor).toBe(0n);
      expect(r.over).toBe(false);
      expect(r.pct).toBeCloseTo(0, 9);
    }
    expect(netSpendingByCategory([]).size).toBe(0);
    cov.cover('R1: empty txns -> empty map');
  });

  test('GOLDEN edge: empty limits -> no rows', () => {
    const rows = computeCategoryBudgets({}, [
      { posted_date: '2026-05-01', amount_minor: -1000n, category_id: 'food' }
    ]);
    expect(rows.length).toBe(0);
    cov.cover('edge: empty limits -> no rows');
  });

  test('GOLDEN edge: very large bigint amounts/limits stay exact (no float in money)', () => {
    const big = 9_000_000_000_000_000_000n; // > Number.MAX_SAFE_INTEGER
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -big, category_id: 'food' }
    ];
    const rows = computeCategoryBudgets({ food: big + 1n }, txns);
    const r = rows[0]!;
    expect(r.spent_minor).toBe(big); // exact bigint, no precision loss
    expect(r.remaining_minor).toBe(1n); // (big+1) - big
    expect(r.over).toBe(false);
    expect(Number.isFinite(r.pct)).toBe(true);
    cov.cover('edge: very large bigint amounts/limits');
  });

  test('GOLDEN edge: tiny limit vs huge spend -> large finite pct, no Infinity', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -1_000_000n, category_id: 'food' }
    ];
    const rows = computeCategoryBudgets({ food: 1n }, txns);
    const r = rows[0]!;
    expect(r.spent_minor).toBe(1_000_000n);
    expect(r.remaining_minor).toBe(-999_999n);
    expect(r.over).toBe(true);
    expect(Number.isFinite(r.pct)).toBe(true); // 1000000/1*100 = 1e8, finite
    expect(r.pct).toBeCloseTo(100_000_000, 0);
    cov.cover('edge: tiny limit vs huge spend (large finite pct, no Infinity)');
  });

  test('GOLDEN edge: integer-like category keys handled (no numeric-coercion bug)', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -1500n, category_id: '42' }
    ];
    const rows = computeCategoryBudgets({ '42': 1000n, '7': 2000n }, txns);
    const r42 = rows.find((r) => r.category_id === '42')!;
    expect(r42.spent_minor).toBe(1500n);
    expect(r42.over).toBe(true);
    const r7 = rows.find((r) => r.category_id === '7')!;
    expect(r7.spent_minor).toBe(0n);
    cov.cover('edge: integer-like category keys');
  });

  test('GOLDEN R1: null-category spending is tracked but never produces a budget row', () => {
    const txns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -2500n, category_id: null }
    ];
    const net = netSpendingByCategory(txns);
    expect(net.get(null)).toBe(2500n); // null spending tracked in R1
    const rows = computeCategoryBudgets({ food: 1000n }, txns);
    // null can never be a limit key -> never a row
    expect(rows.some((r) => r.category_id === null)).toBe(false);
    cov.cover('R1: null category present');
  });
});

// =============================================================================
// PHASE E — FAULT INJECTION (prove the bench has teeth: self-mutate the model)
//
// Confirms the scoreboard FAILS when the reference model is corrupted, so a
// green run is not vacuous. (Stryker is run separately per the report.)
// =============================================================================

describe('category-budget IV&V — bench teeth (reference-model self-mutation)', () => {
  const limits = { food: 8000n, rent: 4000n };
  const txns: SummaryTransaction[] = [
    { posted_date: '2026-05-01', amount_minor: -9000n, category_id: 'food' },
    { posted_date: '2026-05-01', amount_minor: -1000n, category_id: 'rent' }
  ];

  test('MUTANT A: off-by-one in remaining (limit - spent + 1) is caught by the exact scoreboard', () => {
    const mutantModel = (i: BudgetInput) =>
      rowsExact(
        refComputeCategoryBudgets(i.limits, i.txns).map((r) => ({
          ...r,
          remaining_minor: r.remaining_minor + 1n // injected fault
        }))
      );
    const sb = new Scoreboard<BudgetInput, ReturnType<typeof rowsExact>>({
      dut: (i) => rowsExact(computeCategoryBudgets(i.limits, i.txns)),
      model: mutantModel
    });
    sb.check({ limits, txns });
    expect(sb.mismatches.length).toBeGreaterThan(0); // bench has teeth
  });

  test('MUTANT B: dropped refund floor (allow negative spent) is caught by INV5/INV1', () => {
    // The faulty model uses signed sum directly (no max-with-0 floor).
    const faultyNet = (t: readonly SummaryTransaction[]) => {
      const m = new Map<string | null, bigint>();
      for (const x of t) m.set(x.category_id, (m.get(x.category_id) ?? 0n) - x.amount_minor); // -sum, NO floor
      return m;
    };
    const refundTxns: SummaryTransaction[] = [
      { posted_date: '2026-05-01', amount_minor: -2000n, category_id: 'food' },
      { posted_date: '2026-05-01', amount_minor: 5000n, category_id: 'food' } // net inflow
    ];
    // DUT must floor to 0; the faulty model would yield -3000.
    const dutSpent = computeCategoryBudgets({ food: 10000n }, refundTxns)[0]!.spent_minor;
    const faultySpent = faultyNet(refundTxns).get('food')!;
    expect(faultySpent).toBe(-3000n); // confirms the fault is real (negative)
    expect(dutSpent).toBe(0n); // DUT correctly floors -> mutant would diverge
    expect(dutSpent).not.toBe(faultySpent);
  });

  test('MUTANT C: flipped over comparison (>= instead of >) is caught at the boundary', () => {
    // At spent == limit, contract says over=false. A >= mutant would say true.
    const atLimit = computeCategoryBudgets({ food: 5000n }, [
      { posted_date: '2026-05-01', amount_minor: -5000n, category_id: 'food' }
    ])[0]!;
    expect(atLimit.over).toBe(false); // exact-at-limit boundary distinguishes > from >=
  });
});

// =============================================================================
// COVERAGE CLOSURE GATE  (run last; throws listing any unhit cover point)
// =============================================================================

describe('category-budget IV&V — functional coverage closure', () => {
  test('all planned cover points hit (sign-off gate)', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
