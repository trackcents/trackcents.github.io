// =============================================================================
// IV&V verification environment — merchant-trends (US-PW-A / US-PW-B price trends)
//
// Independent Verification & Validation. This file is authored by the
// verification-engineer WITHOUT reading src/lib/app/merchant-trends.ts or any
// Designer test for it. Everything below derives from:
//   - the verification contract
//       specs/001-money-tracker-mvp/verification/merchant-trends.contract.md
//   - spec-tracker-research-features.md (§1a, §2 US-PW-A/B, §4)
//   - reports/overnight-build/DECISIONS.md (D6)
//   - .specify/memory/constitution.md (Principle II: money=bigint, no float;
//     the "no amount-based classification" project rule)
//
// The ONLY DUT-collaborator imported is `normalizeDescriptor`, which the contract
// (§2/§3) names as the grouping function the module is DEFINED in terms of. It is
// a public, separately-verified collaborator (exported from paycheck-detector),
// not the DUT's hidden logic — so both DUT and reference model legitimately share
// it, exactly as the contract specifies.
//
// UVM -> software mapping realised here:
//   Sequencer/Generator : arbTxns + corner-biased + scale/permute transforms (fast-check)
//   Driver              : direct calls of merchantTrends/priceJumps/frequent/largest (DUT)
//   Monitor             : byKey() normalising DUT output to a comparable shape
//   Reference Model     : refMerchantTrends/refPriceJumps/... — from-spec re-impl
//   Scoreboard          : tests/_framework Scoreboard{dut, model}
//   Assertions/Cover    : fast-check properties for INV1..INV6
//   Coverage collector  : tests/_framework CoverageModel (functional coverage)
//   Fault injection     : Stryker (separate) + a self-mutation teeth check (below)
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { Scoreboard, deepEqual } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---- DUT (public exports only; never the implementation body) ---------------
import {
  merchantTrends,
  priceJumps,
  frequentMerchants,
  largestPurchases
} from '../../../src/lib/app/merchant-trends';
// Verified public collaborator the contract (§2/§3) defines grouping in terms of.
import { normalizeDescriptor } from '../../../src/lib/app/paycheck-detector';

// ---- Contract §3 shapes, re-declared so the env is self-contained -----------
interface MerchantTxn {
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // signed minor units (cents); <0 = outflow/spend
  description: string;
}
interface MerchantTrend {
  merchant_key: string;
  display_name: string;
  occurrences: number;
  total_spent_minor: bigint;
  average_amount_minor: bigint;
  first_date: string;
  last_date: string;
  first_amount_minor: bigint;
  last_amount_minor: bigint;
  previous_amount_minor: bigint | null;
  jump_minor: bigint;
  jump_pct: number | null;
}
interface LargestPurchase {
  posted_date: string;
  description: string;
  amount_minor: bigint;
}
interface TrendOptions {
  since?: string;
}

// =============================================================================
// REFERENCE MODEL — an independent from-spec re-implementation (the "golden"
// model). Built ONLY from contract R1..R11 + INV1..INV6. Never derived from the
// DUT source (which was not read).
// =============================================================================

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

/** R4 rounding: total / occurrences, rounded HALF-UP on the positive magnitude.
 *  Both operands are >= 0 here, so half-up = (total*2 + occ) / (occ*2) via floor,
 *  but to be crystal-clear & independent I compute floor + remainder explicitly. */
function roundHalfUp(total: bigint, occ: bigint): bigint {
  // total, occ > 0n
  const q = total / occ;
  const r = total % occ;
  // round up when 2*r >= occ (i.e. fractional part >= 0.5)
  return 2n * r >= occ ? q + 1n : q;
}

/** Stable insertion of all outflows grouped by normalized key.
 *  R1: only amount_minor < 0 qualify. R2: empty normalized key dropped. R11
 *  windowing handled by caller. Preserves input order within a key (for the
 *  stable-by-date sort below). */
function groupOutflows(txns: readonly MerchantTxn[]): Map<string, MerchantTxn[]> {
  const groups = new Map<string, MerchantTxn[]>();
  for (const t of txns) {
    if (t.amount_minor >= 0n) continue; // R1: inflows & zero excluded
    const key = normalizeDescriptor(t.description); // R2: grouping key
    if (key === '') continue; // R2: empty key dropped
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  return groups;
}

/** Ascending by posted_date, then a DETERMINISTIC tiebreak (amount asc, then
 *  description) — matches the DUT's pinned same-day order (DECISIONS D13, A1
 *  resolved), so the result is fully permutation-invariant (INV4 unconditional). */
function sortByDateStable(arr: readonly MerchantTxn[]): MerchantTxn[] {
  return [...arr].sort((a, b) => {
    if (a.posted_date !== b.posted_date) return a.posted_date < b.posted_date ? -1 : 1;
    if (a.amount_minor !== b.amount_minor) return a.amount_minor < b.amount_minor ? -1 : 1;
    return a.description < b.description ? -1 : a.description > b.description ? 1 : 0;
  });
}

function applyWindow(txns: readonly MerchantTxn[], opts?: TrendOptions): readonly MerchantTxn[] {
  const since = opts?.since;
  if (since === undefined) return txns;
  return txns.filter((t) => !(t.posted_date < since)); // R11: drop posted_date < since
}

function refMerchantTrends(txns: readonly MerchantTxn[], opts?: TrendOptions): MerchantTrend[] {
  const windowed = applyWindow(txns, opts);
  const groups = groupOutflows(windowed);
  const out: MerchantTrend[] = [];

  for (const [key, charges] of groups) {
    if (charges.length < 2) continue; // R3: >= 2 qualifying charges
    const ordered = sortByDateStable(charges);

    const occurrences = ordered.length;
    // R4 / INV1: total = exact sum of magnitudes
    let total = 0n;
    for (const c of ordered) total += abs(c.amount_minor);
    const average = roundHalfUp(total, BigInt(occurrences)); // R4 half-up

    const firstC = ordered[0]!;
    const lastC = ordered[ordered.length - 1]!;
    const prevC = ordered[ordered.length - 2]!; // exists because occ >= 2

    const first_amount = abs(firstC.amount_minor);
    const last_amount = abs(lastC.amount_minor);
    const previous_amount = abs(prevC.amount_minor);

    const jump_minor = last_amount - previous_amount; // R6 signed
    // R6: jump_pct null iff previous null or 0; previous is magnitude of nonzero charge => >=1
    const jump_pct =
      previous_amount === 0n ? null : (Number(jump_minor) / Number(previous_amount)) * 100;

    // R2: display_name = original description of the most-recent (latest date) charge
    out.push({
      merchant_key: key,
      display_name: lastC.description,
      occurrences,
      total_spent_minor: total,
      average_amount_minor: average,
      first_date: firstC.posted_date,
      last_date: lastC.posted_date,
      first_amount_minor: first_amount,
      last_amount_minor: last_amount,
      previous_amount_minor: previous_amount,
      jump_minor,
      jump_pct
    });
  }

  // R9: total_spent_minor desc, ties by merchant_key asc
  out.sort((a, b) => {
    if (a.total_spent_minor !== b.total_spent_minor)
      return a.total_spent_minor > b.total_spent_minor ? -1 : 1;
    return a.merchant_key < b.merchant_key ? -1 : a.merchant_key > b.merchant_key ? 1 : 0;
  });
  return out;
}

function refPriceJumps(txns: readonly MerchantTxn[], opts?: TrendOptions): MerchantTrend[] {
  // R7: only jump_minor != 0, ordered by |jump_pct| desc, ties by |jump_minor| desc.
  const base = refMerchantTrends(txns, opts).filter((m) => m.jump_minor !== 0n);
  base.sort((a, b) => {
    const pa = a.jump_pct === null ? -Infinity : Math.abs(a.jump_pct);
    const pb = b.jump_pct === null ? -Infinity : Math.abs(b.jump_pct);
    if (pa !== pb) return pb - pa;
    const ja = abs(a.jump_minor);
    const jb = abs(b.jump_minor);
    if (ja !== jb) return jb > ja ? 1 : -1;
    return 0;
  });
  return base;
}

function refFrequentMerchants(txns: readonly MerchantTxn[], opts?: TrendOptions): MerchantTrend[] {
  // R8: all merchantTrends results ordered by occurrences desc, ties by total_spent_minor desc.
  const base = refMerchantTrends(txns, opts).slice();
  base.sort((a, b) => {
    if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
    if (a.total_spent_minor !== b.total_spent_minor)
      return a.total_spent_minor > b.total_spent_minor ? -1 : 1;
    return 0;
  });
  return base;
}

function refLargestPurchases(
  txns: readonly MerchantTxn[],
  opts?: TrendOptions & { limit?: number }
): LargestPurchase[] {
  // R10: individual outflow txns (magnitude), sorted by magnitude desc, capped at
  // limit (default 10). Tiebreak is deliberately loose (contract §11) — we assert
  // only the multiset of top-N magnitudes, not incidental order, in the scoreboard
  // path; here we sort magnitude desc then later-date-first as a deterministic key.
  const windowed = applyWindow(txns, opts);
  const limit = opts?.limit ?? 10;
  const outflows = windowed
    .filter((t) => t.amount_minor < 0n)
    .map((t) => ({
      posted_date: t.posted_date,
      description: t.description,
      amount_minor: abs(t.amount_minor)
    }));
  outflows.sort((a, b) => {
    if (a.amount_minor !== b.amount_minor) return a.amount_minor > b.amount_minor ? -1 : 1;
    return a.posted_date < b.posted_date ? 1 : a.posted_date > b.posted_date ? -1 : 0; // later first
  });
  return limit < 0 ? [] : outflows.slice(0, limit);
}

// =============================================================================
// MONITORS — normalise DUT output for comparison / metamorphic checks.
// =============================================================================

function byKey(trends: readonly MerchantTrend[]): Map<string, MerchantTrend> {
  const m = new Map<string, MerchantTrend>();
  for (const t of trends) m.set(t.merchant_key, t);
  return m;
}

/** Sorted multiset of magnitudes (for tie-loose largestPurchases comparison). */
function magnitudesOf(lp: readonly LargestPurchase[]): bigint[] {
  return lp.map((p) => p.amount_minor).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

/** True if any two largestPurchases entries share a magnitude (loose-tie domain). */
function magnitudesAllDistinct(lp: readonly LargestPurchase[]): boolean {
  const seen = new Set<string>();
  for (const p of lp) {
    const k = p.amount_minor.toString();
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** True if the priceJumps ordering has a GENUINE tie on BOTH keys (|pct| AND
 *  |jump_minor|) between adjacent elements — the only case where R7 leaves order
 *  unspecified. Used to fall back to order-insensitive comparison soundly. */
function hasPriceJumpTie(trends: readonly MerchantTrend[]): boolean {
  for (let i = 1; i < trends.length; i++) {
    const a = trends[i - 1]!;
    const b = trends[i]!;
    const pa = a.jump_pct === null ? NaN : Math.abs(a.jump_pct);
    const pb = b.jump_pct === null ? NaN : Math.abs(b.jump_pct);
    const ja = a.jump_minor < 0n ? -a.jump_minor : a.jump_minor;
    const jb = b.jump_minor < 0n ? -b.jump_minor : b.jump_minor;
    if (Math.abs(pa - pb) < 1e-9 && ja === jb) return true;
  }
  return false;
}

/** True if frequentMerchants has a genuine tie on BOTH occurrences AND total_spent
 *  between adjacent elements — the only case where R8 leaves order unspecified. */
function hasFrequentTie(trends: readonly MerchantTrend[]): boolean {
  for (let i = 1; i < trends.length; i++) {
    const a = trends[i - 1]!;
    const b = trends[i]!;
    if (a.occurrences === b.occurrences && a.total_spent_minor === b.total_spent_minor) return true;
  }
  return false;
}

// =============================================================================
// GENERATORS (constrained-random stimulus) — the sequencer.
// =============================================================================

// A small alphabet of descriptor STEMS that normalize to a stable non-empty key,
// plus noise (digits / # / ACH tokens) that normalizeDescriptor strips, so many
// raw descriptions collapse to the SAME merchant_key (exercises R2 grouping).
const STEMS = ['NETFLIX', 'SPOTIFY', 'WALMART', 'ACME GYM', 'COFFEE BAR', 'AMZN MKTP'];
const NOISE_SUFFIX = ['', ' #1234', ' 0425', ' REF 99', ' WEB ID 7', ' *XYZ', '-001', ':4455'];

const arbDescriptor: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...STEMS), fc.constantFrom(...NOISE_SUFFIX))
  .map(([stem, suf]) => stem + suf);

// Some descriptors that normalize to '' (pure digits / punctuation) to exercise
// the empty-key drop (R2 / §6).
const arbEmptyKeyDescriptor: fc.Arbitrary<string> = fc.constantFrom(
  '12345',
  '0000',
  '###',
  '-- // --',
  '   '
);

// ISO dates in a bounded window incl. same-day and year-wrap potential.
const arbDate: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2024, max: 2026 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

// Signed amounts: mostly outflows (<0), some inflows (>=0), some exactly 0.
const arbAmount: fc.Arbitrary<bigint> = fc.oneof(
  { weight: 6, arbitrary: fc.bigInt({ min: -2_000_000n, max: -1n }) }, // outflow
  { weight: 2, arbitrary: fc.bigInt({ min: 1n, max: 2_000_000n }) }, // inflow
  { weight: 1, arbitrary: fc.constant(0n) } // zero (excluded)
);

const arbTxn: fc.Arbitrary<MerchantTxn> = fc.record({
  posted_date: arbDate,
  amount_minor: arbAmount,
  description: fc.oneof(
    { weight: 5, arbitrary: arbDescriptor },
    { weight: 1, arbitrary: arbEmptyKeyDescriptor }
  )
});

const arbTxns: fc.Arbitrary<MerchantTxn[]> = fc.array(arbTxn, { minLength: 0, maxLength: 30 });

// A generator biased to produce repeated same-merchant charges with DISTINCT
// dates (so >=2 qualifying & permutation-safe), good for jump/ordering coverage.
const arbRepeatedMerchant: fc.Arbitrary<MerchantTxn[]> = fc
  .tuple(
    fc.constantFrom(...STEMS),
    fc.uniqueArray(arbDate, { minLength: 2, maxLength: 6 }),
    fc.array(fc.bigInt({ min: -500_000n, max: -1n }), { minLength: 2, maxLength: 6 })
  )
  .map(([stem, dates, amts]) => {
    const n = Math.min(dates.length, amts.length);
    const out: MerchantTxn[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ posted_date: dates[i]!, amount_minor: amts[i]!, description: `${stem} #${i}` });
    }
    return out;
  });

// =============================================================================
// FUNCTIONAL COVERAGE MODEL — the verification plan's cover points (R1..R11,
// INV1..INV6, §6 edges). Sign-off gates on closure.
// =============================================================================
const cov = new CoverageModel([
  // R1
  'R1: input has an inflow (excluded)',
  'R1: input has a zero amount (excluded)',
  'R1: merchant with only inflows -> no trend',
  // R2
  'R2: two raw descriptors normalize to same key (grouped)',
  'R2: descriptor normalizes to empty key (dropped)',
  'R2: display_name = latest charge original description',
  // R3
  'R3: merchant with exactly 1 charge (excluded from trends)',
  'R3: merchant with exactly 2 charges (included)',
  'R3: merchant with >=3 charges',
  // R4
  'R4: average exact (no rounding)',
  'R4: average rounds half-up',
  // R5
  'R5: out-of-order input sorted ascending',
  'R5: same-day charges present (tie)',
  // R6
  'R6: jump positive (price increase)',
  'R6: jump negative (price decrease)',
  'R6: jump zero (unchanged latest)',
  // R7
  'R7: priceJumps excludes zero-jump merchants',
  'R7: priceJumps >=2 nonzero jumps to order',
  // R8
  'R8: frequentMerchants tie on occurrences',
  // R9
  'R9: merchantTrends tie on total_spent (key tiebreak)',
  // R10
  'R10: largestPurchases default limit (10)',
  'R10: largestPurchases custom limit < list',
  'R10: largestPurchases limit 0',
  'R10: largestPurchases limit > list',
  'R10: largestPurchases includes single-charge merchant txn',
  // R11
  'R11: since excludes all',
  'R11: since excludes some',
  'R11: since excludes none',
  // INV
  'INV1: conservation re-sum',
  'INV2: non-negativity',
  'INV3: amount-scale metamorphic',
  'INV4: permutation invariance (distinct-date)',
  'INV5: determinism + purity',
  'INV6: count bound',
  // edges §6
  'EDGE: empty input',
  'EDGE: all-inflow input',
  'EDGE: very large bigint magnitude (1e15)'
]);

// =============================================================================
// PHASE B/C — DIRECTED CORNERS + GOLDEN VALUES (hand-computed, R6 worked example)
// =============================================================================

const T = (posted_date: string, amount_minor: bigint, description: string): MerchantTxn => ({
  posted_date,
  amount_minor,
  description
});

describe('merchant-trends IV&V — directed corners + hand-computed golden values', () => {
  test('R6 worked example: [1599,1599,1799] => prev=1599,last=1799,jump=200,pct≈12.5078', () => {
    const txns = [
      T('2026-01-01', -1599n, 'SPOT'),
      T('2026-02-01', -1599n, 'SPOT'),
      T('2026-03-01', -1799n, 'SPOT')
    ];
    const [tr] = merchantTrends(txns);
    expect(tr).toBeDefined();
    expect(tr!.previous_amount_minor).toBe(1599n);
    expect(tr!.last_amount_minor).toBe(1799n);
    expect(tr!.first_amount_minor).toBe(1599n);
    expect(tr!.jump_minor).toBe(200n);
    expect(tr!.total_spent_minor).toBe(4997n); // 1599+1599+1799
    expect(tr!.occurrences).toBe(3);
    // average: 4997/3 = 1665.67 -> half-up 1666
    expect(tr!.average_amount_minor).toBe(1666n);
    // jump_pct = 200/1599*100 = 12.50781738...  (computed, not a long literal, to
    // keep full precision without tripping no-loss-of-precision on promotion)
    expect(tr!.jump_pct).not.toBeNull();
    expect(tr!.jump_pct!).toBeCloseTo((200 / 1599) * 100, 9);
    cov.cover('R3: merchant with >=3 charges');
    cov.cover('R6: jump positive (price increase)');
    cov.cover('R4: average rounds half-up');
  });

  test('R1: inflows and zeros are excluded; merchant with only inflows -> no trend', () => {
    const txns = [
      T('2026-01-01', 5000n, 'NETFLIX'), // inflow excluded
      T('2026-01-02', 0n, 'NETFLIX'), // zero excluded
      T('2026-02-01', -1000n, 'WALMART'), // outflow, but only 1 -> R3 drops
      T('2026-01-01', 9000n, 'REFUND ONLY'), // only-inflow merchant
      T('2026-02-01', 9000n, 'REFUND ONLY')
    ];
    const out = merchantTrends(txns);
    expect(out.find((t) => t.merchant_key === normalizeDescriptor('REFUND ONLY'))).toBeUndefined();
    expect(out).toEqual([]); // nothing qualifies
    cov.cover('R1: input has an inflow (excluded)');
    cov.cover('R1: input has a zero amount (excluded)');
    cov.cover('R1: merchant with only inflows -> no trend');
    cov.cover('R3: merchant with exactly 1 charge (excluded from trends)');
  });

  test('R2: digit/#-noise descriptors group together; display_name is latest original', () => {
    const txns = [
      T('2026-01-01', -1599n, 'NETFLIX #111'),
      T('2026-02-01', -1599n, 'NETFLIX 0425'),
      T('2026-03-01', -1799n, 'NETFLIX*REF 9')
    ];
    const out = merchantTrends(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.merchant_key).toBe(normalizeDescriptor('NETFLIX #111'));
    expect(out[0]!.occurrences).toBe(3);
    // display_name = original description of most-recent (2026-03-01)
    expect(out[0]!.display_name).toBe('NETFLIX*REF 9');
    cov.cover('R2: two raw descriptors normalize to same key (grouped)');
    cov.cover('R2: display_name = latest charge original description');
  });

  test('R2: descriptor that normalizes to empty string is dropped', () => {
    const txns = [
      T('2026-01-01', -100n, '12345'),
      T('2026-02-01', -200n, '###'),
      T('2026-03-01', -300n, '0000')
    ];
    // each normalizes to '' — but they would also group to the same '' key; R2 drops empty key entirely
    expect(normalizeDescriptor('12345')).toBe('');
    expect(merchantTrends(txns)).toEqual([]);
    cov.cover('R2: descriptor normalizes to empty key (dropped)');
  });

  test('R3: exactly 2 charges included; exactly 1 excluded', () => {
    const txns = [
      T('2026-01-01', -500n, 'COFFEE BAR'),
      T('2026-02-01', -700n, 'COFFEE BAR'),
      T('2026-01-01', -9999n, 'SOLO SHOP')
    ];
    const out = merchantTrends(txns);
    expect(out.map((t) => t.merchant_key)).toContain(normalizeDescriptor('COFFEE BAR'));
    expect(out.map((t) => t.merchant_key)).not.toContain(normalizeDescriptor('SOLO SHOP'));
    cov.cover('R3: merchant with exactly 2 charges (included)');
    cov.cover('R3: merchant with exactly 1 charge (excluded from trends)');
  });

  test('R4: average exact when divisible', () => {
    const txns = [T('2026-01-01', -1000n, 'EVEN'), T('2026-02-01', -3000n, 'EVEN')]; // total 4000 /2 = 2000
    const [tr] = merchantTrends(txns);
    expect(tr!.average_amount_minor).toBe(2000n);
    cov.cover('R4: average exact (no rounding)');
  });

  test('R4: average rounds HALF-UP (1001/2 = 500.5 -> 501)', () => {
    const txns = [T('2026-01-01', -1000n, 'HALF'), T('2026-02-01', -1n, 'HALF')];
    const [tr] = merchantTrends(txns);
    expect(tr!.total_spent_minor).toBe(1001n);
    expect(tr!.average_amount_minor).toBe(501n); // half-up
    cov.cover('R4: average rounds half-up');
  });

  test('R5: out-of-order input is sorted ascending by date', () => {
    const txns = [
      T('2026-03-01', -300n, 'M'),
      T('2026-01-01', -100n, 'M'),
      T('2026-02-01', -200n, 'M')
    ];
    const [tr] = merchantTrends(txns);
    expect(tr!.first_date).toBe('2026-01-01');
    expect(tr!.last_date).toBe('2026-03-01');
    expect(tr!.first_amount_minor).toBe(100n);
    expect(tr!.last_amount_minor).toBe(300n);
    expect(tr!.previous_amount_minor).toBe(200n);
    cov.cover('R5: out-of-order input sorted ascending');
  });

  test('R6: price decrease => negative jump; unchanged => zero jump', () => {
    const dec = [T('2026-01-01', -2000n, 'D'), T('2026-02-01', -1500n, 'D')];
    const [d] = merchantTrends(dec);
    expect(d!.jump_minor).toBe(-500n);
    expect(d!.jump_pct!).toBeCloseTo(-25, 9);

    const same = [T('2026-01-01', -2000n, 'E'), T('2026-02-01', -2000n, 'E')];
    const [e] = merchantTrends(same);
    expect(e!.jump_minor).toBe(0n);
    expect(e!.jump_pct!).toBeCloseTo(0, 9);
    cov.cover('R6: jump negative (price decrease)');
    cov.cover('R6: jump zero (unchanged latest)');
  });

  test('R7: priceJumps excludes zero-jump merchants and orders by |pct| desc', () => {
    const txns = [
      // merchant A: 1000 -> 2000  jump +1000, pct +100
      T('2026-01-01', -1000n, 'AAA'),
      T('2026-02-01', -2000n, 'AAA'),
      // merchant B: 1000 -> 1100  jump +100, pct +10
      T('2026-01-01', -1000n, 'BBB'),
      T('2026-02-01', -1100n, 'BBB'),
      // merchant C: 1000 -> 1000  jump 0 -> excluded
      T('2026-01-01', -1000n, 'CCC'),
      T('2026-02-01', -1000n, 'CCC')
    ];
    const out = priceJumps(txns);
    expect(out.map((t) => t.merchant_key)).toEqual([
      normalizeDescriptor('AAA'),
      normalizeDescriptor('BBB')
    ]);
    expect(out.find((t) => t.merchant_key === normalizeDescriptor('CCC'))).toBeUndefined();
    cov.cover('R7: priceJumps excludes zero-jump merchants');
    cov.cover('R7: priceJumps >=2 nonzero jumps to order');
  });

  test('R8: frequentMerchants orders by occurrences desc', () => {
    const txns = [
      T('2026-01-01', -100n, 'FREQ'),
      T('2026-02-01', -100n, 'FREQ'),
      T('2026-03-01', -100n, 'FREQ'), // 3 occ
      T('2026-01-01', -100n, 'RARE'),
      T('2026-02-01', -100n, 'RARE') // 2 occ
    ];
    const out = frequentMerchants(txns);
    expect(out[0]!.merchant_key).toBe(normalizeDescriptor('FREQ'));
    expect(out[0]!.occurrences).toBeGreaterThanOrEqual(out[1]!.occurrences);
    cov.cover('R8: frequentMerchants tie on occurrences');
  });

  test('R9: merchantTrends ties on total_spent broken by merchant_key asc', () => {
    // two merchants with identical totals (200) -> key order: "AAA" < "ZZZ"
    const txns = [
      T('2026-01-01', -100n, 'ZZZ'),
      T('2026-02-01', -100n, 'ZZZ'),
      T('2026-01-01', -100n, 'AAA'),
      T('2026-02-01', -100n, 'AAA')
    ];
    const out = merchantTrends(txns);
    expect(out.map((t) => t.merchant_key)).toEqual([
      normalizeDescriptor('AAA'),
      normalizeDescriptor('ZZZ')
    ]);
    cov.cover('R9: merchantTrends tie on total_spent (key tiebreak)');
  });

  test('R7: priceJumps |pct| TIE broken by |jump_minor| desc (BOTH input orders -> kills comparator)', () => {
    // SAME |jump_pct| (100%) but different |jump_minor|:
    //   P: 100 -> 200  => jump +100  (larger |jump|)
    //   Q: 50  -> 100  => jump +50   (smaller |jump|)
    // R7: tie on |pct| broken by |jump_minor| desc => P before Q, REGARDLESS of
    // input order. Testing both orders defeats the 2-element-sort equivalence
    // (a comparator mutation can otherwise pass for one specific input order).
    const mkP = (key: string): MerchantTxn[] => [
      T('2026-01-01', -100n, key),
      T('2026-02-01', -200n, key)
    ];
    const mkQ = (key: string): MerchantTxn[] => [
      T('2026-01-01', -50n, key),
      T('2026-02-01', -100n, key)
    ];
    const fwd = [...mkP('PPP'), ...mkQ('QQQ')];
    const rev = [...mkQ('QQQ'), ...mkP('PPP')];
    for (const txns of [fwd, rev]) {
      const out = priceJumps(txns);
      expect(out.map((t) => t.merchant_key)).toEqual([
        normalizeDescriptor('PPP'),
        normalizeDescriptor('QQQ')
      ]);
      expect(out.every((t) => Math.abs(t.jump_pct!) === 100)).toBe(true);
    }
    // a THIRD tied-pct merchant with the SMALLEST |jump| to force multi-compare
    const three = [
      ...mkQ('QQQ'),
      T('2026-01-01', -25n, 'RRR'),
      T('2026-02-01', -50n, 'RRR'),
      ...mkP('PPP')
    ];
    expect(priceJumps(three).map((t) => t.merchant_key)).toEqual([
      normalizeDescriptor('PPP'), // |jump| 100
      normalizeDescriptor('QQQ'), // |jump| 50
      normalizeDescriptor('RRR') // |jump| 25
    ]);
  });

  test('R8: frequentMerchants occurrences TIE broken by total_spent desc (BOTH orders)', () => {
    // Both have 2 occurrences; HIGHV total 3000 > LOWV total 300 => HIGHV first
    // regardless of input order (defeats 2-element-sort equivalence).
    const hi = (k: string): MerchantTxn[] => [
      T('2026-01-01', -1500n, k),
      T('2026-02-01', -1500n, k)
    ];
    const lo = (k: string): MerchantTxn[] => [T('2026-01-01', -150n, k), T('2026-02-01', -150n, k)];
    for (const txns of [
      [...hi('HIGHV'), ...lo('LOWV')],
      [...lo('LOWV'), ...hi('HIGHV')]
    ]) {
      const out = frequentMerchants(txns);
      expect(out.map((t) => t.merchant_key)).toEqual([
        normalizeDescriptor('HIGHV'),
        normalizeDescriptor('LOWV')
      ]);
      expect(out[0]!.occurrences).toBe(out[1]!.occurrences); // genuine occ tie
    }
  });

  test('R10: largestPurchases magnitude TIE — deterministic & multiset stable (directed)', () => {
    // Two distinct txns with the SAME magnitude 500 on different dates. R10 tiebreak
    // is loose (§11) — we assert only that BOTH appear and the magnitudes are correct,
    // and that the function is deterministic across repeated calls (INV5).
    const txns = [
      T('2026-01-05', -500n, 'later'),
      T('2026-01-01', -500n, 'earlier'),
      T('2026-01-03', -200n, 'mid')
    ];
    const a = largestPurchases(txns);
    const b = largestPurchases(txns);
    expect(a.map((p) => p.amount_minor)).toEqual([500n, 500n, 200n]);
    expect(deepEqual(a, b)).toBe(true); // deterministic tiebreak
    // both 500-magnitude txns appear (order between them is loose per §11)
    expect(
      a
        .filter((p) => p.amount_minor === 500n)
        .map((p) => p.description)
        .sort()
    ).toEqual(['earlier', 'later']);
  });

  test('R10: largestPurchases magnitude order, default + custom + zero + over limit', () => {
    const txns = [
      T('2026-01-01', -100n, 'a'),
      T('2026-01-02', -500n, 'b'),
      T('2026-01-03', -300n, 'c'),
      T('2026-01-04', 9999n, 'inflow excluded'),
      T('2026-01-05', 0n, 'zero excluded')
    ];
    const def = largestPurchases(txns);
    expect(def.map((p) => p.amount_minor)).toEqual([500n, 300n, 100n]); // magnitude desc, inflow/zero gone
    expect(def.every((p) => p.amount_minor >= 0n)).toBe(true);

    expect(largestPurchases(txns, { limit: 2 }).map((p) => p.amount_minor)).toEqual([500n, 300n]);
    expect(largestPurchases(txns, { limit: 0 })).toEqual([]);
    expect(largestPurchases(txns, { limit: 99 }).length).toBe(3); // over list size
    cov.cover('R10: largestPurchases default limit (10)');
    cov.cover('R10: largestPurchases custom limit < list');
    cov.cover('R10: largestPurchases limit 0');
    cov.cover('R10: largestPurchases limit > list');
  });

  test('R10: largestPurchases includes a single-charge merchant txn (no R3 minimum)', () => {
    const txns = [T('2026-01-01', -7777n, 'ONLY ONCE')];
    const out = largestPurchases(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.amount_minor).toBe(7777n);
    expect(out[0]!.description).toBe('ONLY ONCE');
    cov.cover('R10: largestPurchases includes single-charge merchant txn');
  });

  test('R9: merchantTrends FULL strict order by total desc (multi-merchant, BOTH orders)', () => {
    // Three merchants, strictly distinct totals: HI=5000 > MID=3000 > LO=1000.
    // Asserting the full ordered key list in BOTH input orders kills the
    // total-comparator direction + boundary mutants across argument orders.
    const m = (k: string, c: bigint): MerchantTxn[] => [
      T('2026-01-01', c, k),
      T('2026-02-01', c, k)
    ];
    const fwd = [...m('LO', -500n), ...m('MID', -1500n), ...m('HI', -2500n)];
    const rev = [...m('HI', -2500n), ...m('MID', -1500n), ...m('LO', -500n)];
    for (const txns of [fwd, rev]) {
      expect(merchantTrends(txns).map((t) => t.merchant_key)).toEqual([
        normalizeDescriptor('HI'),
        normalizeDescriptor('MID'),
        normalizeDescriptor('LO')
      ]);
    }
  });

  test('R9: merchantTrends total TIE broken by merchant_key asc (BOTH orders)', () => {
    // Equal totals (2000) for keys AAA, MMM, ZZZ -> key asc: AAA, MMM, ZZZ.
    // Forces the merchant_key secondary comparator (line 135) in both arg orders.
    const m = (k: string): MerchantTxn[] => [
      T('2026-01-01', -1000n, k),
      T('2026-02-01', -1000n, k)
    ];
    for (const txns of [
      [...m('ZZZ'), ...m('AAA'), ...m('MMM')],
      [...m('AAA'), ...m('MMM'), ...m('ZZZ')]
    ]) {
      expect(merchantTrends(txns).map((t) => t.merchant_key)).toEqual([
        normalizeDescriptor('AAA'),
        normalizeDescriptor('MMM'),
        normalizeDescriptor('ZZZ')
      ]);
    }
  });

  test('R8: frequentMerchants FULL strict order by occurrences desc (multi-merchant)', () => {
    // strictly distinct occurrences 4 > 3 > 2 with same per-charge amount.
    const mk = (key: string, n: number): MerchantTxn[] =>
      Array.from({ length: n }, (_, i) => T(`2026-0${i + 1}-01`, -100n, key));
    const txns = [...mk('FOUR', 4), ...mk('THREE', 3), ...mk('TWO', 2)];
    expect(frequentMerchants(txns).map((t) => t.merchant_key)).toEqual([
      normalizeDescriptor('FOUR'),
      normalizeDescriptor('THREE'),
      normalizeDescriptor('TWO')
    ]);
  });

  test('R7: priceJumps FULL strict order by |pct| desc (distinct pct, BOTH orders)', () => {
    // distinct |pct|: A +100% > B +50% > C +10%
    const m = (k: string, last: bigint): MerchantTxn[] => [
      T('2026-01-01', -1000n, k),
      T('2026-02-01', last, k)
    ];
    const fwd = [...m('A', -2000n), ...m('B', -1500n), ...m('C', -1100n)];
    const rev = [...m('C', -1100n), ...m('B', -1500n), ...m('A', -2000n)];
    for (const txns of [fwd, rev]) {
      expect(priceJumps(txns).map((t) => t.merchant_key)).toEqual([
        normalizeDescriptor('A'),
        normalizeDescriptor('B'),
        normalizeDescriptor('C')
      ]);
    }
  });

  test('R7: priceJumps orders INCREASES and DECREASES by |pct| (sign-independent)', () => {
    // A decrease of -60% must outrank an increase of +20% (|pct| basis).
    const txns = [
      T('2026-01-01', -1000n, 'DOWN'),
      T('2026-02-01', -400n, 'DOWN'), // -60%
      T('2026-01-01', -1000n, 'UP'),
      T('2026-02-01', -1200n, 'UP') // +20%
    ];
    expect(priceJumps(txns).map((t) => t.merchant_key)).toEqual([
      normalizeDescriptor('DOWN'),
      normalizeDescriptor('UP')
    ]);
  });

  test('R10: largestPurchases FULL strict order by magnitude desc (distinct mags, BOTH orders)', () => {
    const base = [
      T('2026-01-01', -100n, 'a'),
      T('2026-01-02', -900n, 'b'),
      T('2026-01-03', -500n, 'c'),
      T('2026-01-04', -300n, 'd')
    ];
    const expected = [
      { posted_date: '2026-01-02', description: 'b', amount_minor: 900n },
      { posted_date: '2026-01-03', description: 'c', amount_minor: 500n },
      { posted_date: '2026-01-04', description: 'd', amount_minor: 300n },
      { posted_date: '2026-01-01', description: 'a', amount_minor: 100n }
    ];
    expect(largestPurchases(base)).toEqual(expected);
    expect(largestPurchases([...base].reverse())).toEqual(expected); // order-robust
  });

  test('R11: largestPurchases honours `since` (window applied before ranking)', () => {
    const txns = [
      T('2026-01-01', -900n, 'old big'), // excluded by since
      T('2026-02-01', -500n, 'kept'),
      T('2026-03-01', -300n, 'kept2')
    ];
    const out = largestPurchases(txns, { since: '2026-02-01' });
    expect(out.map((p) => p.amount_minor)).toEqual([500n, 300n]);
    expect(out.find((p) => p.description === 'old big')).toBeUndefined();
  });

  test('R11: since excludes all / some / none', () => {
    const txns = [
      T('2026-01-01', -100n, 'WIN'),
      T('2026-02-01', -200n, 'WIN'),
      T('2026-03-01', -300n, 'WIN')
    ];
    // none excluded
    expect(merchantTrends(txns, { since: '2026-01-01' })[0]!.occurrences).toBe(3);
    // some excluded (drop Jan) -> 2 remain
    expect(merchantTrends(txns, { since: '2026-02-01' })[0]!.occurrences).toBe(2);
    // all excluded -> [] (also drops below R3 minimum)
    expect(merchantTrends(txns, { since: '2027-01-01' })).toEqual([]);
    cov.cover('R11: since excludes none');
    cov.cover('R11: since excludes some');
    cov.cover('R11: since excludes all');
  });

  test('EDGE: empty input & all-inflow input return [] everywhere; no throw', () => {
    for (const fn of [merchantTrends, priceJumps, frequentMerchants]) {
      expect(fn([])).toEqual([]);
      expect(fn([T('2026-01-01', 5000n, 'INCOME'), T('2026-02-01', 6000n, 'INCOME')])).toEqual([]);
    }
    expect(largestPurchases([])).toEqual([]);
    expect(largestPurchases([T('2026-01-01', 5000n, 'INCOME')])).toEqual([]);
    cov.cover('EDGE: empty input');
    cov.cover('EDGE: all-inflow input');
  });

  test('EDGE: very large bigint magnitudes (±1e15) handled exactly', () => {
    const big = 1_000_000_000_000_000n; // 1e15
    const txns = [T('2026-01-01', -big, 'BIG'), T('2026-02-01', -(big + 2n), 'BIG')];
    const [tr] = merchantTrends(txns);
    expect(tr!.total_spent_minor).toBe(big + big + 2n);
    expect(tr!.jump_minor).toBe(2n);
    // average half-up: (2e15+2)/2 = 1e15+1 exactly
    expect(tr!.average_amount_minor).toBe(big + 1n);
    cov.cover('EDGE: very large bigint magnitude (1e15)');
  });

  test('R5/INV4-tie: same-day charges use a DETERMINISTIC tiebreak (amount asc) — A1 resolved per D13', () => {
    // A1 resolved: same-day ties break deterministically by amount asc (then
    // description), so the result NEVER depends on input order (INV4 holds
    // unconditionally). For same-day -1000/-2000/-3000: amount asc => [-3000,-2000,-1000]
    // => first=3000, last=1000, prev=2000. Reversed input yields IDENTICAL output.
    const asc = [
      T('2026-01-01', -1000n, 'M'),
      T('2026-01-01', -2000n, 'M'),
      T('2026-01-01', -3000n, 'M')
    ];
    const rev = [...asc].reverse();
    const a = merchantTrends(asc)[0]!;
    const b = merchantTrends(rev)[0]!;
    expect(a.first_amount_minor).toBe(3000n);
    expect(a.last_amount_minor).toBe(1000n);
    expect(a.previous_amount_minor).toBe(2000n);
    expect(b).toEqual(a); // permutation invariance on same-day ties
    cov.cover('R5: same-day charges present (tie)');
  });
});

// =============================================================================
// PHASE C — SCOREBOARD: DUT vs independent reference model on random stimulus.
// =============================================================================

describe('merchant-trends IV&V — scoreboard (DUT vs independent reference model)', () => {
  test('merchantTrends agrees with reference model over constrained-random inputs', () => {
    const sb = new Scoreboard<MerchantTxn[], MerchantTrend[]>({
      dut: (i) => merchantTrends(i),
      model: (i) => refMerchantTrends(i),
      // jump_pct is float (oracle hazard §11): compare structurally but allow pct tol.
      eq: (e, a) => trendArraysEqual(e, a),
      show: (i) => stringifyTxns(i)
    });
    fc.assert(
      fc.property(arbTxns, (txns) => {
        sb.check(txns);
        // collect coverage from the stimulus
        if (txns.some((t) => t.amount_minor >= 0n && t.amount_minor !== 0n))
          cov.cover('R1: input has an inflow (excluded)');
        if (txns.some((t) => t.amount_minor === 0n))
          cov.cover('R1: input has a zero amount (excluded)');
        const out = refMerchantTrends(txns);
        if (out.some((t) => t.occurrences === 2))
          cov.cover('R3: merchant with exactly 2 charges (included)');
        if (out.some((t) => t.occurrences >= 3)) cov.cover('R3: merchant with >=3 charges');
        if (out.some((t) => t.jump_minor > 0n)) cov.cover('R6: jump positive (price increase)');
        if (out.some((t) => t.jump_minor < 0n)) cov.cover('R6: jump negative (price decrease)');
        if (out.some((t) => t.jump_minor === 0n)) cov.cover('R6: jump zero (unchanged latest)');
      }),
      { numRuns: 300 }
    );
    sb.assertClean();
    expect(sb.comparisons).toBeGreaterThanOrEqual(300);
  });

  test('priceJumps / frequentMerchants agree with reference model — ORDER-SENSITIVE', () => {
    // The reference model implements the EXACT documented orderings (R7: |pct| desc,
    // ties |jump| desc; R8: occurrences desc, ties total desc). Comparing
    // order-sensitively against it kills sort-comparator-direction mutants. To stay
    // SOUND we only order-assert when the primary+secondary sort keys are STRICT
    // across adjacent elements (no genuine 3-way tie where order is unspecified);
    // such genuine ties are extremely rare in random data and are separately
    // covered by directed tie tests below (multiset-only there).
    const sbPj = new Scoreboard<MerchantTxn[], MerchantTrend[]>({
      dut: (i) => priceJumps(i),
      model: (i) => refPriceJumps(i),
      eq: (e, a) =>
        hasPriceJumpTie(e) ? trendArraysEqual(e, a, false) : trendArraysEqual(e, a, true),
      show: (i) => stringifyTxns(i)
    });
    const sbFm = new Scoreboard<MerchantTxn[], MerchantTrend[]>({
      dut: (i) => frequentMerchants(i),
      model: (i) => refFrequentMerchants(i),
      eq: (e, a) =>
        hasFrequentTie(e) ? trendArraysEqual(e, a, false) : trendArraysEqual(e, a, true),
      show: (i) => stringifyTxns(i)
    });
    fc.assert(
      fc.property(arbTxns, (txns) => {
        sbPj.check(txns);
        sbFm.check(txns);
      }),
      { numRuns: 300 }
    );
    sbPj.assertClean();
    sbFm.assertClean();
  });

  test('largestPurchases agrees with reference model — ORDER-SENSITIVE on distinct magnitudes', () => {
    // R10 tiebreak is deliberately loose (§11): when two outflows share a magnitude,
    // their relative order is unspecified. So we order-assert the full tuple ONLY when
    // the top-N magnitudes are all distinct (the validity domain where R10 fully
    // determines the order); otherwise we fall back to the magnitude multiset. This
    // kills the magnitude-comparator-direction mutants while honouring the loose tie.
    const sbLp = new Scoreboard<MerchantTxn[], LargestPurchase[]>({
      dut: (i) => largestPurchases(i),
      model: (i) => refLargestPurchases(i),
      eq: (e, a) =>
        magnitudesAllDistinct(e) ? deepEqual(e, a) : deepEqual(magnitudesOf(e), magnitudesOf(a)),
      show: (i) => stringifyTxns(i)
    });
    fc.assert(
      fc.property(arbTxns, fc.integer({ min: 0, max: 15 }), (txns, lim) => {
        sbLp.check(txns);
        // also exercise explicit limits (0, small, large) to cover the cap branch
        const capped = largestPurchases(txns, { limit: lim });
        const ref = refLargestPurchases(txns, { limit: lim });
        if (magnitudesAllDistinct(capped)) expect(deepEqual(capped, ref)).toBe(true);
        else expect(deepEqual(magnitudesOf(capped), magnitudesOf(ref))).toBe(true);
        expect(capped.length).toBe(ref.length);
      }),
      { numRuns: 300 }
    );
    sbLp.assertClean();
  });

  test('repeated-merchant biased stimulus also agrees (deep jump/ordering coverage)', () => {
    const sb = new Scoreboard<MerchantTxn[], MerchantTrend[]>({
      dut: (i) => priceJumps(i),
      model: (i) => refPriceJumps(i),
      eq: (e, a) =>
        hasPriceJumpTie(e) ? trendArraysEqual(e, a, false) : trendArraysEqual(e, a, true),
      show: (i) => stringifyTxns(i)
    });
    fc.assert(
      fc.property(fc.array(arbRepeatedMerchant, { minLength: 1, maxLength: 4 }), (groups) => {
        const txns = groups.flat();
        sb.check(txns);
      }),
      { numRuns: 300 }
    );
    sb.assertClean();
  });
});

// =============================================================================
// PHASE D — ORACLE-FREE METAMORPHIC RELATIONS (Knight & Leveson mitigation).
// These need NO reference model; they hold for ANY correct implementation.
// =============================================================================

describe('merchant-trends IV&V — metamorphic relations (oracle-free)', () => {
  // INV3 — amount-scale invariance (the CONSTITUTION-SAFETY property).
  // Multiply every amount by integer k>0: totals/first/last/prev scale by k;
  // occurrences, ordering, merchant_keys, jump_pct UNCHANGED. average within ±1
  // cent (oracle hazard §11 — rounding). Validity domain: integer k, exact bigint
  // scaling, so no float representability issue (scaling is exact in bigint).
  test('INV3: amount-scale invariance — no decision depends on absolute size', () => {
    fc.assert(
      fc.property(arbTxns, fc.integer({ min: 2, max: 1000 }), (txns, k) => {
        const K = BigInt(k);
        const scaled = txns.map((t) => ({ ...t, amount_minor: t.amount_minor * K }));
        const base = merchantTrends(txns);
        const scl = merchantTrends(scaled);

        // same set of merchants, same order (ranking is scale-invariant: every
        // total multiplies by the same k>0, ties preserved)
        expect(scl.map((t) => t.merchant_key)).toEqual(base.map((t) => t.merchant_key));

        const bk = byKey(base);
        for (const s of scl) {
          const b = bk.get(s.merchant_key)!;
          expect(s.occurrences).toBe(b.occurrences);
          expect(s.total_spent_minor).toBe(b.total_spent_minor * K);
          expect(s.first_amount_minor).toBe(b.first_amount_minor * K);
          expect(s.last_amount_minor).toBe(b.last_amount_minor * K);
          expect(s.previous_amount_minor).toBe((b.previous_amount_minor ?? 0n) * K);
          expect(s.jump_minor).toBe(b.jump_minor * K);
          // jump_pct is a ratio -> unchanged
          if (b.jump_pct === null) expect(s.jump_pct).toBeNull();
          else expect(s.jump_pct!).toBeCloseTo(b.jump_pct, 6);
          // average scales by k modulo cent rounding: |s.avg - b.avg*k| <= 1 cent? No —
          // rounding error scales too. The tight relation: s.avg == round(b.total*k / occ).
          // We assert it equals the exact recomputation (oracle-free arithmetic identity).
          const occ = BigInt(s.occurrences);
          const expectedAvg = roundHalfUpLocal(b.total_spent_minor * K, occ);
          expect(s.average_amount_minor).toBe(expectedAvg);
        }
        cov.cover('INV3: amount-scale metamorphic');
      }),
      { numRuns: 300 }
    );
  });

  // INV4 — permutation invariance. VALIDITY DOMAIN: distinct dates per merchant
  // (no same-day ties), because the DUT sort is stable so reordering same-day
  // charges legitimately changes first/last/prev (ambiguity A1). We enforce the
  // domain by generating unique dates per merchant.
  test('INV4: permutation invariance on distinct-date inputs', () => {
    fc.assert(
      fc.property(
        fc.array(arbRepeatedMerchant, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (groups, seed) => {
          // Build a txn set where, WITHIN each merchant, dates are unique (the
          // generator guarantees that). Across merchants dates may collide but
          // that does not affect per-merchant ordering.
          const txns = groups.flat();
          const a = merchantTrends(txns);
          // shuffle deterministically
          const shuffled = deterministicShuffle(txns, seed);
          const b = merchantTrends(shuffled);
          expect(trendArraysEqual(a, b)).toBe(true);
          cov.cover('INV4: permutation invariance (distinct-date)');
        }
      ),
      { numRuns: 300 }
    );
  });

  // INV5 — determinism & purity.
  test('INV5: determinism (same input => identical output) + no input mutation', () => {
    fc.assert(
      fc.property(arbTxns, (txns) => {
        const snapshot = stringifyTxns(txns);
        const a = merchantTrends(txns);
        const b = merchantTrends(txns);
        expect(deepEqual(a, b)).toBe(true);
        const pj1 = priceJumps(txns);
        const pj2 = priceJumps(txns);
        expect(deepEqual(pj1, pj2)).toBe(true);
        // purity: input array not mutated
        expect(stringifyTxns(txns)).toBe(snapshot);
        cov.cover('INV5: determinism + purity');
      }),
      { numRuns: 300 }
    );
  });

  // INV1 — conservation: total_spent == exact sum of per-occurrence magnitudes.
  // Re-derive the magnitudes independently from the windowed outflows.
  test('INV1: conservation — total_spent equals exact re-sum of windowed magnitudes', () => {
    fc.assert(
      fc.property(arbTxns, (txns) => {
        const out = merchantTrends(txns);
        // independent recomputation of each merchant's magnitude sum
        const groups = groupOutflows(txns);
        for (const tr of out) {
          const charges = groups.get(tr.merchant_key) ?? [];
          let sum = 0n;
          for (const c of charges) sum += abs(c.amount_minor);
          expect(tr.total_spent_minor).toBe(sum);
          // and average*occ is within rounding of total (re-derivation)
          expect(tr.total_spent_minor).toBe(sumByReoccurrence(tr, charges));
        }
        cov.cover('INV1: conservation re-sum');
        cov.cover('INV6: count bound');
        // INV6: result count <= distinct non-empty normalized keys among outflows
        const distinctKeys = new Set([...groups.keys()]);
        expect(out.length).toBeLessThanOrEqual(distinctKeys.size);
      }),
      { numRuns: 300 }
    );
  });

  // INV2 — non-negativity & types.
  test('INV2: non-negativity + bigint types + occurrences>=2', () => {
    fc.assert(
      fc.property(arbTxns, (txns) => {
        for (const tr of merchantTrends(txns)) {
          expect(typeof tr.total_spent_minor).toBe('bigint');
          expect(typeof tr.average_amount_minor).toBe('bigint');
          expect(tr.total_spent_minor >= 0n).toBe(true);
          expect(tr.average_amount_minor >= 0n).toBe(true);
          expect(tr.first_amount_minor >= 0n).toBe(true);
          expect(tr.last_amount_minor >= 0n).toBe(true);
          expect((tr.previous_amount_minor ?? 0n) >= 0n).toBe(true);
          expect(tr.occurrences).toBeGreaterThanOrEqual(2);
          // jump_pct, if present, is finite (no NaN/Infinity — float money hazard)
          if (tr.jump_pct !== null) expect(Number.isFinite(tr.jump_pct)).toBe(true);
        }
        for (const p of largestPurchases(txns)) {
          expect(typeof p.amount_minor).toBe('bigint');
          expect(p.amount_minor >= 0n).toBe(true);
        }
        cov.cover('INV2: non-negativity');
      }),
      { numRuns: 300 }
    );
  });

  // Idempotence-style metamorphic: feeding the output's implied charges back is
  // not meaningful here, but window monotonicity IS: a stricter `since` can only
  // remove charges, never add merchants/occurrences.
  test('METAMORPHIC: tightening `since` is monotone (never adds occurrences)', () => {
    fc.assert(
      fc.property(arbTxns, arbDate, arbDate, (txns, d1, d2) => {
        const looser = d1 < d2 ? d1 : d2;
        const tighter = d1 < d2 ? d2 : d1;
        const a = byKey(merchantTrends(txns, { since: looser }));
        const b = merchantTrends(txns, { since: tighter });
        for (const trB of b) {
          const trA = a.get(trB.merchant_key);
          // a merchant present under the tighter window must be present (with >=
          // occurrences) under the looser window
          expect(trA).toBeDefined();
          expect(trA!.occurrences).toBeGreaterThanOrEqual(trB.occurrences);
          expect(trA!.total_spent_minor >= trB.total_spent_minor).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// PHASE E (local teeth check) — SELF-MUTATION of the reference model.
// Proves the scoreboard is not vacuously passing: a deliberately-wrong model
// must make the scoreboard FAIL. (Stryker on the DUT runs separately — see report.)
// =============================================================================

describe('merchant-trends IV&V — bench teeth (reference-model self-mutation)', () => {
  test('a corrupted reference model (off-by-one average) is CAUGHT by the scoreboard', () => {
    // Mutant: average uses floor instead of half-up — a real, subtle money bug.
    const mutantModel = (txns: readonly MerchantTxn[]): MerchantTrend[] =>
      refMerchantTrends(txns).map((t) => ({
        ...t,
        average_amount_minor: t.total_spent_minor / BigInt(t.occurrences) // floor, not half-up
      }));
    const sb = new Scoreboard<MerchantTxn[], MerchantTrend[]>({
      dut: (i) => merchantTrends(i), // real DUT (correct half-up)
      model: mutantModel, // wrong model
      eq: (e, a) => trendArraysEqual(e, a),
      show: (i) => stringifyTxns(i)
    });
    // a case that forces rounding: total 1001 / 2 -> half-up 501 vs floor 500
    sb.check([T('2026-01-01', -1000n, 'HALF'), T('2026-02-01', -1n, 'HALF')]);
    expect(sb.mismatches.length).toBeGreaterThan(0); // bench HAS teeth
  });

  test('a corrupted reference model (wrong jump sign) is CAUGHT by the scoreboard', () => {
    const mutantModel = (txns: readonly MerchantTxn[]): MerchantTrend[] =>
      refMerchantTrends(txns).map((t) => ({ ...t, jump_minor: -t.jump_minor }));
    const sb = new Scoreboard<MerchantTxn[], MerchantTrend[]>({
      dut: (i) => merchantTrends(i),
      model: mutantModel,
      eq: (e, a) => trendArraysEqual(e, a),
      show: (i) => stringifyTxns(i)
    });
    sb.check([T('2026-01-01', -1000n, 'X'), T('2026-02-01', -2000n, 'X')]); // jump 1000 vs -1000
    expect(sb.mismatches.length).toBeGreaterThan(0);
  });

  test('functional coverage closes (sign-off gate)', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});

// =============================================================================
// HELPERS local to the bench.
// =============================================================================

function roundHalfUpLocal(total: bigint, occ: bigint): bigint {
  const q = total / occ;
  const r = total % occ;
  return 2n * r >= occ ? q + 1n : q;
}

/** Re-derive a merchant total by re-summing its charges' magnitudes (INV1). */
function sumByReoccurrence(_tr: MerchantTrend, charges: readonly MerchantTxn[]): bigint {
  let s = 0n;
  for (const c of charges) s += c.amount_minor < 0n ? -c.amount_minor : c.amount_minor;
  return s;
}

function stringifyTxns(txns: readonly MerchantTxn[]): string {
  return JSON.stringify(txns, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

/** Deterministic shuffle (Fisher–Yates with a seeded LCG) — pure, no global RNG. */
function deterministicShuffle<X>(arr: readonly X[], seed: number): X[] {
  const a = arr.slice();
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Compare two MerchantTrend arrays: bigint fields exact, jump_pct within tol.
 *  `orderSensitive` (default true): also requires the same ordering of keys.
 *  For ordering-loose comparisons (R7/R8 where |pct| ties may reorder), set false
 *  and compare as a key-indexed map plus assert the ranking KEY is monotone. */
function trendArraysEqual(
  e: readonly MerchantTrend[],
  a: readonly MerchantTrend[],
  orderSensitive = true
): boolean {
  if (e.length !== a.length) return false;
  if (orderSensitive) {
    for (let i = 0; i < e.length; i++) {
      if (!trendEqual(e[i]!, a[i]!)) return false;
    }
    return true;
  }
  // order-insensitive: match by key
  const am = byKey(a);
  for (const te of e) {
    const ta = am.get(te.merchant_key);
    if (!ta || !trendEqual(te, ta)) return false;
  }
  return true;
}

function trendEqual(x: MerchantTrend, y: MerchantTrend): boolean {
  if (x.merchant_key !== y.merchant_key) return false;
  if (x.display_name !== y.display_name) return false;
  if (x.occurrences !== y.occurrences) return false;
  if (x.total_spent_minor !== y.total_spent_minor) return false;
  if (x.average_amount_minor !== y.average_amount_minor) return false;
  if (x.first_date !== y.first_date) return false;
  if (x.last_date !== y.last_date) return false;
  if (x.first_amount_minor !== y.first_amount_minor) return false;
  if (x.last_amount_minor !== y.last_amount_minor) return false;
  if ((x.previous_amount_minor ?? null) !== (y.previous_amount_minor ?? null)) return false;
  if (x.jump_minor !== y.jump_minor) return false;
  const px = x.jump_pct;
  const py = y.jump_pct;
  if (px === null || py === null) return px === py;
  return Math.abs(px - py) < 1e-6;
}
