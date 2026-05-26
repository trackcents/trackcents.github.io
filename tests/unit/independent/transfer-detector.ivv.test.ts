// ============================================================================
// IV&V verification environment — transfer-detector (US-P3-D)
// ============================================================================
//
// INDEPENDENT verification. The author of this file has NEVER read
// src/lib/app/transfer-detector.ts nor the Designer's test for it. Everything
// below is derived from the verification contract
//   specs/001-money-tracker-mvp/verification/transfer-detector.contract.md
// and the cited spec sources (spec.md US-P3-D, constitution Principle II).
//
// UVM-style components built here:
//   - Generator(s)      : constrained-random TransferTxn arbitraries (multi-account,
//                         planted equal-and-opposite pairs, same-account decoys,
//                         off-by-1-cent decoys, gap-boundary cases, descriptor hints)
//   - Reference model   : refDetectTransfers — an INDEPENDENT from-contract
//                         re-implementation of the greedy closest-gap matcher
//   - Scoreboard        : Scoreboard{dut, model} judged on every transaction
//   - Assertions        : INV1..INV6 properties, checked every run
//   - Coverage model    : CoverageModel over R1..R7 + INV1..INV6 + every §6 edge
//   - Fault injection   : reference-model self-mutation gate (proves the bench
//                         has teeth) + Stryker run reported in the sign-off text
//
// Oracle discipline: the load-bearing checks are STRUCTURAL / oracle-free
// (INV2 disjoint keys, INV4 cross-account, INV6 count bound, INV1 permutation
// invariance) per contract §11. The greedy choice (R5) is the one spot the
// reference model must replicate exactly, so it is ALSO pinned with directed
// competing-candidate cases carrying hand-computed expectations.
// ============================================================================

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  detectTransfers,
  type TransferTxn,
  type TransferPair,
  type TransferOptions
} from '../../../src/lib/app/transfer-detector';
import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ────────────────────────────────────────────────────────────────────────────
// Functional coverage plan (declared up front; gated at the end)
// ────────────────────────────────────────────────────────────────────────────
const cov = new CoverageModel([
  // R1 — pair definition
  'R1.pair-formed',
  'R1.cross-account-equal-magnitude-in-window',
  // R2 — same account never pairs
  'R2.same-account-equal-opposite-rejected',
  // R3 — magnitude exactness
  'R3.off-by-1-cent-rejected',
  'R3.exact-magnitude-paired',
  // R4 — window
  'R4.gap-eq-max-accepted',
  'R4.gap-eq-max-plus-1-rejected',
  'R4.gap-zero-same-day',
  // R5 — used at most once + greedy
  'R5.two-inflows-compete-closest-wins',
  'R5.two-outflows-compete-one-pairs',
  'R5.inflow-consumed-unavailable-later',
  'R5.tie-broken-deterministically',
  // R6 — confidence
  'R6.confidence-high-hint',
  'R6.confidence-medium-no-hint',
  // R7 — output order
  'R7.sorted-out-date-asc',
  'R7.ties-by-outflow-key',
  // INV
  'INV1.permutation-invariant',
  'INV1.input-not-mutated',
  'INV2.disjoint-keys',
  'INV3.magnitude-positive-bigint',
  'INV4.cross-account',
  'INV5.window-respected',
  'INV6.count-bound',
  // §6 edges
  'E.empty-input',
  'E.only-outflows',
  'E.only-inflows',
  'E.zero-amount-ignored',
  'E.maxGapDays-0-only-same-day',
  'E.no-pairs-possible'
]);

// ────────────────────────────────────────────────────────────────────────────
// INDEPENDENT REFERENCE MODEL (golden) — written from the contract alone.
//
// Algorithm (greedy, deterministic, from §4 R1/R4/R5 + §5 INV1 + §7 R7):
//   1. Split into outflows (amount<0) and inflows (amount>0). Zero-amount
//      txns are NEITHER (R: "neither outflow nor inflow → ignored", §6).
//   2. Process outflows in a deterministic order. INV1 (determinism regardless
//      of input order) + R7 (output sorted by out_date asc, ties by outflow_key)
//      force the outflow processing order to be (out_date asc, outflow_key asc):
//      any input-order-dependent processing would violate INV1, and processing
//      in output order is the only stable choice consistent with R7.
//   3. For each outflow, among all still-available inflows that are
//      cross-account (R2/INV4), equal-magnitude (|out|===in, R3), and within
//      the gap window (gap<=maxGapDays, R4), choose the SMALLEST-gap one;
//      ties broken by inflow key ascending (R5). Mark that inflow consumed so
//      it is unavailable to later outflows (R5 used-once / INV2).
//   4. Confidence: 'high' iff EITHER leg's description matches a transfer hint
//      (case-insensitive), else 'medium' (R6).
//   5. Output sorted by (out_date asc, outflow_key asc) (R7).
//
// NOTE: input order independence (step 2) means we must SORT a copy of the
// inputs; we never read or mutate the caller's array (INV1 purity).
// ────────────────────────────────────────────────────────────────────────────

const HINTS = [
  'transfer',
  'xfer',
  'to savings',
  'to checking',
  'wire',
  'zelle',
  'move to',
  'online banking transfer'
];

function isHint(desc: string): boolean {
  const d = desc.toLowerCase();
  return HINTS.some((h) => d.includes(h));
}

function absBig(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/** Whole-day absolute difference between two ISO YYYY-MM-DD dates (UTC). */
function gapDays(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  const ms = Math.abs(da - db);
  return Math.round(ms / 86_400_000);
}

function refDetectTransfers(txns: readonly TransferTxn[], opts?: TransferOptions): TransferPair[] {
  const maxGap = opts?.maxGapDays ?? 5;

  // Deterministic ordering helpers (do NOT mutate the input array).
  const byDateThenKey = (a: TransferTxn, b: TransferTxn): number => {
    if (a.posted_date < b.posted_date) return -1;
    if (a.posted_date > b.posted_date) return 1;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  };

  const outflows = txns
    .filter((t) => t.amount_minor < 0n)
    .slice()
    .sort(byDateThenKey);
  const inflows = txns.filter((t) => t.amount_minor > 0n).slice();

  const consumed = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const out of outflows) {
    const mag = absBig(out.amount_minor);
    // Eligible inflows for this outflow.
    let best: { inflow: TransferTxn; gap: number } | null = null;
    for (const inf of inflows) {
      if (consumed.has(inf.key)) continue;
      if (inf.account_id === out.account_id) continue; // R2 / INV4
      if (inf.amount_minor !== mag) continue; // R3 exact magnitude
      const g = gapDays(inf.posted_date, out.posted_date);
      if (g > maxGap) continue; // R4 window
      if (
        best === null ||
        g < best.gap ||
        (g === best.gap && inf.key < best.inflow.key) // R5 tie-break by inflow key asc
      ) {
        best = { inflow: inf, gap: g };
      }
    }
    if (best !== null) {
      consumed.add(best.inflow.key);
      const conf: 'high' | 'medium' =
        isHint(out.description) || isHint(best.inflow.description) ? 'high' : 'medium';
      pairs.push({
        outflow_key: out.key,
        inflow_key: best.inflow.key,
        amount_minor: mag,
        out_account_id: out.account_id,
        in_account_id: best.inflow.account_id,
        out_date: out.posted_date,
        in_date: best.inflow.posted_date,
        gap_days: best.gap,
        confidence: conf
      });
    }
  }

  // R7 output order: by out_date asc, ties by outflow_key asc.
  pairs.sort((a, b) => {
    if (a.out_date < b.out_date) return -1;
    if (a.out_date > b.out_date) return 1;
    if (a.outflow_key < b.outflow_key) return -1;
    if (a.outflow_key > b.outflow_key) return 1;
    return 0;
  });

  return pairs;
}

// ────────────────────────────────────────────────────────────────────────────
// Monitor — normalize a TransferPair list to comparable, bigint-safe facts.
// ────────────────────────────────────────────────────────────────────────────
function normalize(pairs: TransferPair[]): unknown {
  return pairs.map((p) => ({
    outflow_key: p.outflow_key,
    inflow_key: p.inflow_key,
    amount_minor: p.amount_minor,
    out_account_id: p.out_account_id,
    in_account_id: p.in_account_id,
    out_date: p.out_date,
    in_date: p.in_date,
    gap_days: p.gap_days,
    confidence: p.confidence
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Constrained-random generators (the sequencer)
// ────────────────────────────────────────────────────────────────────────────

const ACCOUNTS = ['acctA', 'acctB', 'acctC', 'acctD'];
const DAY0 = Date.parse('2024-01-01T00:00:00Z');

function isoDate(dayOffset: number): string {
  const d = new Date(DAY0 + dayOffset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const DESCRIPTORS = [
  'TRANSFER TO SAVINGS',
  'xfer out',
  'Zelle payment',
  'WIRE 12345',
  'move to brokerage',
  'Online Banking Transfer',
  'Coffee shop',
  'GROCERY STORE',
  'Amazon purchase',
  'paycheck deposit',
  'to checking acct'
];

const arbAmountCents = fc
  .integer({ min: 1, max: 500_000 }) // up to $5000.00, in cents
  .map((n) => BigInt(n));

let keyCounter = 0;
function freshKey(): string {
  keyCounter += 1;
  return `k${keyCounter}`;
}

/** A single random txn (may be inflow, outflow, or zero). */
const arbTxn: fc.Arbitrary<TransferTxn> = fc
  .record({
    account_id: fc.constantFrom(...ACCOUNTS),
    dayOffset: fc.integer({ min: 0, max: 40 }),
    sign: fc.constantFrom(-1n, 1n, 0n),
    mag: arbAmountCents,
    description: fc.constantFrom(...DESCRIPTORS)
  })
  .map((r) => ({
    key: freshKey(),
    account_id: r.account_id,
    posted_date: isoDate(r.dayOffset),
    amount_minor: r.sign * r.mag,
    description: r.description
  }));

/**
 * A "planted-pairs" scenario: deliberately seeds several equal-and-opposite
 * cross-account candidates (some pairable, some sabotaged into same-account /
 * off-by-cent / out-of-window decoys) among random noise. This drives the
 * INTERESTING coverage bins far more reliably than pure noise.
 */
const arbPlantedScenario: fc.Arbitrary<TransferTxn[]> = fc
  .array(
    fc.record({
      acctOut: fc.constantFrom(...ACCOUNTS),
      acctInSame: fc.boolean(), // make inflow same-account decoy?
      offByCent: fc.boolean(), // sabotage magnitude by 1 cent?
      outDay: fc.integer({ min: 0, max: 30 }),
      gap: fc.integer({ min: 0, max: 8 }), // straddles the default window (5)
      mag: arbAmountCents,
      desc: fc.constantFrom(...DESCRIPTORS),
      extraInflow: fc.boolean() // add a SECOND competing inflow?
    }),
    { minLength: 1, maxLength: 6 }
  )
  .chain((specs) => {
    const txns: TransferTxn[] = [];
    for (const s of specs) {
      const acctIn = s.acctInSame
        ? s.acctOut
        : ACCOUNTS[(ACCOUNTS.indexOf(s.acctOut) + 1) % ACCOUNTS.length]!;
      txns.push({
        key: freshKey(),
        account_id: s.acctOut,
        posted_date: isoDate(s.outDay),
        amount_minor: -s.mag,
        description: s.desc
      });
      const inMag = s.offByCent ? s.mag + 1n : s.mag;
      txns.push({
        key: freshKey(),
        account_id: acctIn,
        posted_date: isoDate(s.outDay + s.gap),
        amount_minor: inMag,
        description: s.desc
      });
      if (s.extraInflow) {
        // a second cross-account equal-magnitude inflow at a different gap
        txns.push({
          key: freshKey(),
          account_id: acctIn,
          posted_date: isoDate(s.outDay + ((s.gap + 1) % 6)),
          amount_minor: s.mag,
          description: 'TRANSFER TO SAVINGS'
        });
      }
    }
    // shuffle so input order is arbitrary (exercises INV1 indirectly)
    return fc.shuffledSubarray(txns, { minLength: txns.length, maxLength: txns.length });
  });

const arbNoise: fc.Arbitrary<TransferTxn[]> = fc.array(arbTxn, { minLength: 0, maxLength: 12 });

const arbScenario: fc.Arbitrary<TransferTxn[]> = fc
  .tuple(arbPlantedScenario, arbNoise)
  .map(([planted, noise]) => [...planted, ...noise]);

const arbMaxGap = fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined });

/**
 * ORDER-STRESS generator. Guarantees MANY simultaneous pairs whose out_dates
 * frequently TIE, with distinct/shuffled keys, so the output-ordering
 * comparator (R7: out_date asc, ties by outflow_key) is exercised on every
 * branch. Each "pair spec" is constructed to be definitely pairable (distinct
 * cross-account, equal magnitude, within the default 5-day window). This is the
 * stimulus that exposes sort-comparator faults the noisy generator misses.
 */
const arbOrderStress: fc.Arbitrary<TransferTxn[]> = fc
  .array(
    fc.record({
      outDay: fc.integer({ min: 0, max: 4 }), // small range → frequent date ties
      gap: fc.integer({ min: 0, max: 5 }), // always within default window
      acctIdx: fc.integer({ min: 0, max: 3 }),
      mag: fc.integer({ min: 1, max: 9_999 }).map((n) => BigInt(n))
    }),
    { minLength: 2, maxLength: 8 } // always ≥2 pairs
  )
  .chain((specs) => {
    const txns: TransferTxn[] = [];
    let uniq = 0;
    for (const s of specs) {
      uniq += 1;
      const out = ACCOUNTS[s.acctIdx % ACCOUNTS.length]!;
      const inn = ACCOUNTS[(s.acctIdx + 1) % ACCOUNTS.length]!;
      // make each magnitude unique-ish so pairs don't cross-contend, isolating ordering
      const mag = s.mag + BigInt(uniq) * 100_000n;
      txns.push({
        key: `o-${String(uniq).padStart(2, '0')}`,
        account_id: out,
        posted_date: isoDate(s.outDay),
        amount_minor: -mag,
        description: 'plain'
      });
      txns.push({
        key: `i-${String(uniq).padStart(2, '0')}`,
        account_id: inn,
        posted_date: isoDate(s.outDay + s.gap),
        amount_minor: mag,
        description: 'plain'
      });
    }
    return fc.shuffledSubarray(txns, { minLength: txns.length, maxLength: txns.length });
  });

// Helper: build a frozen copy to detect mutation (INV1 purity).
function deepFreezeClone(txns: readonly TransferTxn[]): TransferTxn[] {
  return txns.map((t) => Object.freeze({ ...t }));
}

// ============================================================================
// PHASE: scoreboard + structural assertions over constrained-random stimulus
// ============================================================================
describe('transfer-detector IV&V — scoreboard + structural invariants', () => {
  test('DUT agrees with independent reference model over constrained-random stimulus', () => {
    const sb = new Scoreboard<{ txns: TransferTxn[]; opts?: TransferOptions }, unknown>({
      dut: ({ txns, opts }) => normalize(detectTransfers(txns, opts)),
      model: ({ txns, opts }) => normalize(refDetectTransfers(txns, opts)),
      show: ({ txns, opts }) =>
        JSON.stringify({
          opts,
          txns: txns.map((t) => ({
            ...t,
            amount_minor: `${t.amount_minor}n`
          }))
        })
    });

    fc.assert(
      fc.property(arbScenario, arbMaxGap, (txns, maxGapDays) => {
        const opts: TransferOptions | undefined =
          maxGapDays === undefined ? undefined : { maxGapDays };
        sb.check({ txns, ...(opts ? { opts } : {}) });
      }),
      { numRuns: 600 }
    );

    sb.assertClean();
    expect(sb.comparisons).toBeGreaterThanOrEqual(600);
  });

  test('structural invariants hold on every DUT output (oracle-free, contract §11)', () => {
    fc.assert(
      fc.property(arbScenario, arbMaxGap, (txns, maxGapDays) => {
        const maxGap = maxGapDays ?? 5;
        const opts: TransferOptions | undefined =
          maxGapDays === undefined ? undefined : { maxGapDays };
        const out = detectTransfers(txns, opts);

        const nOut = txns.filter((t) => t.amount_minor < 0n).length;
        const nIn = txns.filter((t) => t.amount_minor > 0n).length;
        const byKey = new Map(txns.map((t) => [t.key, t]));

        // INV6 — count bound
        expect(out.length).toBeLessThanOrEqual(Math.min(nOut, nIn));
        cov.coverIf(out.length > 0, 'INV6.count-bound');

        // INV2 — disjoint keys (no key used twice, no key both roles)
        const outKeys = new Set<string>();
        const inKeys = new Set<string>();
        for (const p of out) {
          expect(outKeys.has(p.outflow_key)).toBe(false);
          expect(inKeys.has(p.inflow_key)).toBe(false);
          outKeys.add(p.outflow_key);
          inKeys.add(p.inflow_key);
        }
        for (const k of outKeys) expect(inKeys.has(k)).toBe(false);
        cov.coverIf(out.length > 0, 'INV2.disjoint-keys');

        const prevSort: { date: string; key: string } | null = { date: '', key: '' };
        let prev = prevSort;
        for (const p of out) {
          const o = byKey.get(p.outflow_key);
          const i = byKey.get(p.inflow_key);
          expect(o).toBeDefined();
          expect(i).toBeDefined();

          // INV4 — cross-account
          expect(p.out_account_id).not.toBe(p.in_account_id);
          cov.cover('INV4.cross-account');

          // INV3 — positive bigint magnitude == both legs
          expect(typeof p.amount_minor).toBe('bigint');
          expect(p.amount_minor > 0n).toBe(true);
          expect(p.amount_minor).toBe(absBig(o!.amount_minor));
          expect(p.amount_minor).toBe(i!.amount_minor);
          cov.cover('INV3.magnitude-positive-bigint');

          // R1 — legs really are an outflow / inflow
          expect(o!.amount_minor < 0n).toBe(true);
          expect(i!.amount_minor > 0n).toBe(true);

          // INV5 — window respected
          expect(p.gap_days).toBeGreaterThanOrEqual(0);
          expect(p.gap_days).toBeLessThanOrEqual(maxGap);
          // gap_days actually equals the computed whole-day diff
          expect(p.gap_days).toBe(gapDays(p.in_date, p.out_date));
          cov.cover('INV5.window-respected');

          // R7 — output dates/accounts come from the legs
          expect(p.out_date).toBe(o!.posted_date);
          expect(p.in_date).toBe(i!.posted_date);
          expect(p.out_account_id).toBe(o!.account_id);
          expect(p.in_account_id).toBe(i!.account_id);

          // R7 — sorted by out_date asc, ties by outflow_key asc
          if (prev && prev.date !== '') {
            const ordered =
              prev.date < p.out_date || (prev.date === p.out_date && prev.key <= p.outflow_key);
            expect(ordered).toBe(true);
          }
          prev = { date: p.out_date, key: p.outflow_key };
        }
        cov.coverIf(out.length >= 2, 'R7.sorted-out-date-asc');
      }),
      { numRuns: 600 }
    );
  });

  test('INV1 — permutation invariance: output independent of input order', () => {
    fc.assert(
      fc.property(
        arbScenario,
        arbMaxGap,
        fc.integer({ min: 0, max: 1_000_000 }),
        (txns, mg, seed) => {
          const opts: TransferOptions | undefined =
            mg === undefined ? undefined : { maxGapDays: mg };
          const base = normalize(detectTransfers(txns, opts));
          // deterministic shuffle by seed
          const shuffled = txns
            .map((t, i) => ({ t, r: (i * 2654435761 + seed) % 4294967296 }))
            .sort((a, b) => a.r - b.r)
            .map((x) => x.t);
          const permuted = normalize(detectTransfers(shuffled, opts));
          expect(permuted).toEqual(base);
          cov.cover('INV1.permutation-invariant');
        }
      ),
      { numRuns: 300 }
    );
  });

  test('INV1 — purity: input array and its elements are not mutated', () => {
    fc.assert(
      fc.property(arbScenario, arbMaxGap, (txns, mg) => {
        const opts: TransferOptions | undefined = mg === undefined ? undefined : { maxGapDays: mg };
        const frozen = deepFreezeClone(txns);
        const snapshot = JSON.stringify(frozen, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
        // If detectTransfers mutates a frozen element it throws; if it mutates the
        // array length we detect via snapshot.
        expect(() => detectTransfers(frozen, opts)).not.toThrow();
        const after = JSON.stringify(frozen, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
        expect(after).toBe(snapshot);
        cov.cover('INV1.input-not-mutated');
      }),
      { numRuns: 200 }
    );
  });
});

// ============================================================================
// PHASE: DIRECTED competing-candidate cases with HAND-COMPUTED expectations
// (R5 greedy is the one spot a reference model must replicate exactly — §11)
// ============================================================================
describe('transfer-detector IV&V — directed greedy / R5 cases (hand-computed)', () => {
  function txn(
    key: string,
    account_id: string,
    posted_date: string,
    amount_minor: bigint,
    description = 'plain'
  ): TransferTxn {
    return { key, account_id, posted_date, amount_minor, description };
  }

  test('R5: two inflows compete for one outflow — closest gap wins, other stays free', () => {
    // Outflow on day 10 in A, magnitude 10000.
    // Inflow X in B on day 12 (gap 2). Inflow Y in B on day 14 (gap 4).
    // Hand-computed: closest gap (X, gap 2) wins. Y is NOT in any other pair.
    const txns = [
      txn('OUT', 'A', '2024-01-10', -10000n),
      txn('INX', 'B', '2024-01-12', 10000n),
      txn('INY', 'B', '2024-01-14', 10000n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.outflow_key).toBe('OUT');
    expect(out[0]!.inflow_key).toBe('INX');
    expect(out[0]!.gap_days).toBe(2);
    cov.cover('R5.two-inflows-compete-closest-wins');
    cov.cover('R1.pair-formed');
    cov.cover('R1.cross-account-equal-magnitude-in-window');
    cov.cover('R3.exact-magnitude-paired');
  });

  test('R5: two outflows compete for one inflow — only ONE pairs (used-once)', () => {
    // Two outflows in A on day 10 (mag 5000). One inflow in B on day 11 (gap 1).
    // Hand-computed: only one outflow can claim the single inflow. The other
    // outflow has NO available inflow → stays unpaired. Exactly 1 pair.
    // Which outflow wins? Processing order is (out_date asc, outflow_key asc) →
    // outflow 'O1' is processed before 'O2', claims the inflow.
    const txns = [
      txn('O1', 'A', '2024-01-10', -5000n),
      txn('O2', 'A', '2024-01-10', -5000n),
      txn('IN', 'B', '2024-01-11', 5000n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.inflow_key).toBe('IN');
    expect(out[0]!.outflow_key).toBe('O1'); // deterministic: smallest outflow key
    cov.cover('R5.two-outflows-compete-one-pairs');
    cov.cover('R5.inflow-consumed-unavailable-later');
  });

  test('R5: inflow consumed by closest outflow is unavailable to a later outflow', () => {
    // OUT1 in A day10 mag 7000. OUT2 in A day10 mag 7000.
    // INA in B day11 (gap to both = 1). INB in B day20 (gap to OUT2 = 10 > 5 reject).
    // Hand-computed: OUT1 (smaller key) claims INA (gap1). OUT2 then has only INB,
    // which is out of window (gap 10 > 5) → OUT2 unpaired. 1 pair total.
    const txns = [
      txn('OUT1', 'A', '2024-01-10', -7000n),
      txn('OUT2', 'A', '2024-01-10', -7000n),
      txn('INA', 'B', '2024-01-11', 7000n),
      txn('INB', 'B', '2024-01-20', 7000n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.outflow_key).toBe('OUT1');
    expect(out[0]!.inflow_key).toBe('INA');
    cov.cover('R5.inflow-consumed-unavailable-later');
  });

  test('R5: outflow processing order — earliest-date outflow claims the shared inflow', () => {
    // Two outflows compete for ONE inflow, BOTH within window, but with DIFFERENT
    // dates so the processing order (out_date asc) decides the winner.
    // OUT_EARLY day10 (gap to inflow day12 = 2). OUT_LATE day13 (gap = 1).
    // The single inflow day12 mag 8000 in B is eligible for BOTH.
    // Per the deterministic greedy (process outflows by out_date asc), OUT_EARLY
    // is processed first and claims the inflow; OUT_LATE then has none → 1 pair,
    // winner = OUT_EARLY. (A reversed processing order would pick OUT_LATE.)
    const txns = [
      txn('OUT_LATE', 'A', '2024-01-13', -8000n),
      txn('OUT_EARLY', 'A', '2024-01-10', -8000n),
      txn('IN', 'B', '2024-01-12', 8000n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.outflow_key).toBe('OUT_EARLY');
    cov.cover('R5.two-outflows-compete-one-pairs');
  });

  test('R5: same-date outflow contention broken by outflow KEY ascending', () => {
    // Two outflows SAME date day10, same magnitude, one inflow day10 in B.
    // Processing order ties on date → broken by outflow key asc → 'Oa' wins.
    const txns = [
      txn('Oz', 'A', '2024-01-10', -2500n),
      txn('Oa', 'A', '2024-01-10', -2500n),
      txn('IN', 'B', '2024-01-10', 2500n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.outflow_key).toBe('Oa');
  });

  test('R5: gap STRICTLY-smaller wins (not <=) — first-seen smallest gap holds', () => {
    // One outflow day10 in A, mag 4000. Inflow CLOSE in B day11 (gap 1).
    // Inflow FAR in B day14 (gap 4). The strictly-smaller gap (CLOSE) must win.
    // A `gap <= bestGap` mutant would let a later EQUAL gap overwrite, but here
    // gaps differ; combined with the equal-gap tie test below this distinguishes
    // `<` from `<=`.
    const txns = [
      txn('O', 'A', '2024-01-10', -4000n),
      txn('CLOSE', 'B', '2024-01-11', 4000n),
      txn('FAR', 'B', '2024-01-14', 4000n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.inflow_key).toBe('CLOSE');
    expect(out[0]!.gap_days).toBe(1);
  });

  test('R5: THREE inflows at equal gap — lowest inflow key wins (tie-break chain)', () => {
    // OUT day10 in A, mag 9100. THREE inflows in B all at gap 2 (day12), keys
    // I_c, I_b, I_a in input order. Equal gaps across all three → tie-break must
    // select the lexicographically-smallest inflow key (I_a). This forces the
    // (inf.key < best.key) sub-condition to be load-bearing across multiple
    // updates: a `<=` or `>=` or dropped tie-break picks a different inflow.
    const txns = [
      txn('OUT', 'A', '2024-01-10', -9100n),
      txn('I_c', 'B', '2024-01-12', 9100n),
      txn('I_b', 'B', '2024-01-12', 9100n),
      txn('I_a', 'B', '2024-01-12', 9100n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.inflow_key).toBe('I_a');
  });

  test('R5: equal-gap, FIRST-seen lower key must NOT be overwritten by later higher key', () => {
    // OUT day10 in A. Inflow I_a day9 (gap1, lower key, seen first), I_z day11
    // (gap1, higher key, seen later). Equal gaps. The correct result keeps I_a;
    // a `gap <= bestGap` mutant would overwrite the equal-gap best with the
    // later I_z, and a flipped tie-break (inf.key >= best.key) would pick I_z.
    const txns = [
      txn('OUT', 'A', '2024-01-10', -7700n),
      txn('I_a', 'B', '2024-01-09', 7700n),
      txn('I_z', 'B', '2024-01-11', 7700n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.inflow_key).toBe('I_a');
  });

  test('R5: equal-gap tie — LOWER inflow key wins even when seen later', () => {
    // OUT day10 in A. Two inflows BOTH at gap 1: one day9 one day11, in B.
    // Equal gap → tie-break by inflow key ascending. Construct keys so the
    // KEY-ascending winner is the one encountered LATER in input order, which
    // forces the tie-break condition (inf.key < best.key) to be load-bearing:
    // a `<=` or dropped tie-break would pick the wrong inflow.
    const txns = [
      txn('OUT', 'A', '2024-01-10', -3300n),
      txn('IN_z', 'B', '2024-01-09', 3300n), // gap 1, higher key, seen first
      txn('IN_a', 'B', '2024-01-11', 3300n) // gap 1, lower key, seen later
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.inflow_key).toBe('IN_a'); // lower key wins the tie
    cov.cover('R5.tie-broken-deterministically');
  });

  test('R5: tie in gap broken deterministically (by inflow key asc, per contract e.g.)', () => {
    // OUT in A day10 mag 3000. Two inflows in B BOTH at gap 1 (day 9 and day 11).
    // |9-10| = 1, |11-10| = 1 → tie. Contract R5: "ties broken deterministically,
    // e.g. by inflow key". Reference model picks inflow-key ascending → 'INa'.
    // (If DUT uses a different deterministic tiebreak the scoreboard flags it as
    //  SPEC AMBIGUOUS, not a bug — the contract says "e.g.".)
    const txns = [
      txn('OUT', 'A', '2024-01-10', -3000n),
      txn('INb', 'B', '2024-01-11', 3000n),
      txn('INa', 'B', '2024-01-09', 3000n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.gap_days).toBe(1);
    // Deterministic: same output regardless of input order (checked elsewhere).
    cov.cover('R5.tie-broken-deterministically');
  });
});

// ============================================================================
// PHASE: directed boundary / window / magnitude / account cases
// ============================================================================
describe('transfer-detector IV&V — directed boundary cases (hand-computed)', () => {
  function txn(
    key: string,
    account_id: string,
    posted_date: string,
    amount_minor: bigint,
    description = 'plain'
  ): TransferTxn {
    return { key, account_id, posted_date, amount_minor, description };
  }

  test('R4: gap exactly maxGapDays is ACCEPTED', () => {
    // OUT day10, IN day15, default maxGapDays=5 → gap 5 === 5 → accept.
    const txns = [txn('O', 'A', '2024-01-10', -2000n), txn('I', 'B', '2024-01-15', 2000n)];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    expect(out[0]!.gap_days).toBe(5);
    cov.cover('R4.gap-eq-max-accepted');
  });

  test('R4: gap maxGapDays+1 is REJECTED', () => {
    // OUT day10, IN day16 → gap 6 > 5 → no pair.
    const txns = [txn('O', 'A', '2024-01-10', -2000n), txn('I', 'B', '2024-01-16', 2000n)];
    const out = detectTransfers(txns);
    expect(out.length).toBe(0);
    cov.cover('R4.gap-eq-max-plus-1-rejected');
  });

  test('R4 / §6: maxGapDays = 0 → only same-day pairs', () => {
    const sameDay = [txn('O', 'A', '2024-01-10', -100n), txn('I', 'B', '2024-01-10', 100n)];
    const nextDay = [txn('O', 'A', '2024-01-10', -100n), txn('I', 'B', '2024-01-11', 100n)];
    expect(detectTransfers(sameDay, { maxGapDays: 0 }).length).toBe(1);
    expect(detectTransfers(sameDay, { maxGapDays: 0 })[0]!.gap_days).toBe(0);
    expect(detectTransfers(nextDay, { maxGapDays: 0 }).length).toBe(0);
    cov.cover('R4.gap-zero-same-day');
    cov.cover('E.maxGapDays-0-only-same-day');
  });

  test('R2 / §6: equal-and-opposite SAME account never pairs (even same-day)', () => {
    const txns = [txn('O', 'A', '2024-01-10', -4242n), txn('I', 'A', '2024-01-10', 4242n)];
    const out = detectTransfers(txns);
    expect(out.length).toBe(0);
    cov.cover('R2.same-account-equal-opposite-rejected');
  });

  test('R3 / §6: magnitude off by 1 cent does NOT pair', () => {
    const txns = [txn('O', 'A', '2024-01-10', -5000n), txn('I', 'B', '2024-01-11', 5001n)];
    const out = detectTransfers(txns);
    expect(out.length).toBe(0);
    cov.cover('R3.off-by-1-cent-rejected');
  });

  test('§6: zero-amount txns are neither outflow nor inflow → ignored', () => {
    const txns = [
      txn('Z1', 'A', '2024-01-10', 0n),
      txn('Z2', 'B', '2024-01-10', 0n),
      txn('O', 'A', '2024-01-10', -700n),
      txn('I', 'B', '2024-01-10', 700n)
    ];
    const out = detectTransfers(txns);
    // The zero txns must not participate; the real pair must still form.
    expect(out.length).toBe(1);
    expect([out[0]!.outflow_key, out[0]!.inflow_key]).toEqual(['O', 'I']);
    cov.cover('E.zero-amount-ignored');
  });

  test('§6: empty input → []', () => {
    expect(detectTransfers([])).toEqual([]);
    cov.cover('E.empty-input');
  });

  test('§6: only outflows → no pairs', () => {
    const txns = [txn('O1', 'A', '2024-01-10', -100n), txn('O2', 'B', '2024-01-10', -200n)];
    expect(detectTransfers(txns)).toEqual([]);
    cov.cover('E.only-outflows');
    cov.cover('E.no-pairs-possible');
  });

  test('§6: only inflows → no pairs', () => {
    const txns = [txn('I1', 'A', '2024-01-10', 100n), txn('I2', 'B', '2024-01-10', 200n)];
    expect(detectTransfers(txns)).toEqual([]);
    cov.cover('E.only-inflows');
  });
});

// ============================================================================
// PHASE: R6 confidence (descriptor hints, case-insensitive)
// ============================================================================
describe('transfer-detector IV&V — R6 confidence', () => {
  function pairWith(outDesc: string, inDesc: string): TransferPair {
    const txns: TransferTxn[] = [
      {
        key: 'O',
        account_id: 'A',
        posted_date: '2024-01-10',
        amount_minor: -1000n,
        description: outDesc
      },
      {
        key: 'I',
        account_id: 'B',
        posted_date: '2024-01-11',
        amount_minor: 1000n,
        description: inDesc
      }
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(1);
    return out[0]!;
  }

  test('high confidence when EITHER leg matches a hint (case-insensitive)', () => {
    expect(pairWith('TRANSFER to savings', 'plain').confidence).toBe('high');
    expect(pairWith('plain', 'zelle PAYMENT').confidence).toBe('high');
    expect(pairWith('Online Banking Transfer', 'plain').confidence).toBe('high');
    expect(pairWith('WIRE 999', 'plain').confidence).toBe('high');
    expect(pairWith('move TO brokerage', 'plain').confidence).toBe('high');
    expect(pairWith('xfer', 'plain').confidence).toBe('high');
    expect(pairWith('plain', 'TO CHECKING acct').confidence).toBe('high');
    cov.cover('R6.confidence-high-hint');
  });

  test('medium confidence when NEITHER leg matches a hint', () => {
    expect(pairWith('grocery store', 'coffee shop').confidence).toBe('medium');
    expect(pairWith('amazon', 'paycheck deposit').confidence).toBe('medium');
    cov.cover('R6.confidence-medium-no-hint');
  });
});

// ============================================================================
// PHASE: R7 output ordering (directed, hand-computed)
// ============================================================================
describe('transfer-detector IV&V — R7 output order', () => {
  function txn(
    key: string,
    account_id: string,
    posted_date: string,
    amount_minor: bigint
  ): TransferTxn {
    return { key, account_id, posted_date, amount_minor, description: 'plain' };
  }

  test('sorted by out_date ascending', () => {
    const txns = [
      txn('O2', 'A', '2024-01-20', -100n),
      txn('I2', 'B', '2024-01-21', 100n),
      txn('O1', 'A', '2024-01-10', -200n),
      txn('I1', 'B', '2024-01-11', 200n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(2);
    expect(out.map((p) => p.out_date)).toEqual(['2024-01-10', '2024-01-20']);
    cov.cover('R7.sorted-out-date-asc');
  });

  test('ties on out_date broken by outflow_key ascending', () => {
    // Two pairs both with out_date 2024-01-10; outflow keys Ob > Oa.
    const txns = [
      txn('Ob', 'A', '2024-01-10', -100n),
      txn('Ib', 'B', '2024-01-10', 100n),
      txn('Oa', 'C', '2024-01-10', -200n),
      txn('Ia', 'D', '2024-01-10', 200n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(2);
    expect(out.map((p) => p.outflow_key)).toEqual(['Oa', 'Ob']);
    cov.cover('R7.ties-by-outflow-key');
  });

  test('R7: full ordering pinned across mixed dates AND ties (hand-computed)', () => {
    // Pairs with out_dates: 01-10(Ob), 01-10(Oa), 01-05(Oc), 01-20(Od).
    // Expected order: 01-05(Oc), then 01-10 tie → Oa before Ob, then 01-20(Od).
    const txns = [
      txn('Ob', 'A', '2024-01-10', -100n),
      txn('Ib', 'B', '2024-01-10', 100n),
      txn('Oa', 'A', '2024-01-10', -200n),
      txn('Ia', 'C', '2024-01-10', 200n),
      txn('Oc', 'A', '2024-01-05', -300n),
      txn('Ic', 'D', '2024-01-05', 300n),
      txn('Od', 'B', '2024-01-20', -400n),
      txn('Id', 'C', '2024-01-20', 400n)
    ];
    const out = detectTransfers(txns);
    expect(out.length).toBe(4);
    expect(out.map((p) => [p.out_date, p.outflow_key])).toEqual([
      ['2024-01-05', 'Oc'],
      ['2024-01-10', 'Oa'],
      ['2024-01-10', 'Ob'],
      ['2024-01-20', 'Od']
    ]);
  });

  test('R7: outflow keys ANTI-correlated with out_dates forces date-vs-key comparator branches', () => {
    // CRITICAL ordering test: out_dates ASCEND while outflow_keys DESCEND, so the
    // output sort MUST order by DATE (not key). A comparator whose date "<" / ">"
    // branch is dropped (→ falls through to key tie-break) would order by KEY and
    // produce the REVERSE order → caught here. Also includes a same-date tie whose
    // keys disambiguate (exercising the key branch where dates ARE equal).
    const txns: TransferTxn[] = [];
    // 12 distinct dates 2024-01-04..15 (ascending), with keys O12..O01 (descending)
    for (let i = 0; i < 12; i++) {
      const date = `2024-01-${String(i + 4).padStart(2, '0')}`; // 04..15 ascending
      const ok = `O${String(12 - i).padStart(2, '0')}`; // O12..O01 descending
      const ik = `I${String(12 - i).padStart(2, '0')}`;
      const mag = BigInt(i + 1) * 1000n;
      txns.push(txn(ok, 'A', date, -mag));
      txns.push(txn(ik, 'B', date, mag));
    }
    // same-date tie on 2024-01-20: keys decide → Oaa before Ozz
    txns.push(txn('Ozz', 'A', '2024-01-20', -90_000n));
    txns.push(txn('Izz', 'C', '2024-01-20', 90_000n));
    txns.push(txn('Oaa', 'A', '2024-01-20', -91_000n));
    txns.push(txn('Iaa', 'D', '2024-01-20', 91_000n));

    const out = detectTransfers(txns);
    expect(out.length).toBe(14);

    // Independent expectation: strictly ascending out_date; within equal date,
    // ascending outflow_key. Built without reference to DUT output.
    const dates = out.map((p) => p.out_date);
    const sortedDates = [...dates].sort();
    expect(dates).toEqual(sortedDates); // strictly date-ascending despite desc keys
    // pin the same-date tie ordering explicitly
    const tie = out.filter((p) => p.out_date === '2024-01-20').map((p) => p.outflow_key);
    expect(tie).toEqual(['Oaa', 'Ozz']);
    // pin the first few: date ascending must give descending keys O01,O02,...
    expect(out.slice(0, 3).map((p) => [p.out_date, p.outflow_key])).toEqual([
      ['2024-01-04', 'O12'],
      ['2024-01-05', 'O11'],
      ['2024-01-06', 'O10']
    ]);
  });
});

// ============================================================================
// PHASE: ORDER-STRESS scoreboard — guarantees multi-pair, frequently-tied
// out_dates so the R7 sort comparator is exercised on every branch. (Closes
// the coverage hole the noisy generator misses; kills sort-comparator mutants.)
// ============================================================================
describe('transfer-detector IV&V — order-stress scoreboard (R7 comparator)', () => {
  test('DUT output order matches reference model over multi-pair stimulus', () => {
    const sb = new Scoreboard<{ txns: TransferTxn[] }, unknown>({
      dut: ({ txns }) => normalize(detectTransfers(txns)),
      model: ({ txns }) => normalize(refDetectTransfers(txns)),
      show: ({ txns }) =>
        JSON.stringify(txns.map((t) => ({ ...t, amount_minor: `${t.amount_minor}n` })))
    });
    let sawMultiPair = false;
    fc.assert(
      fc.property(arbOrderStress, (txns) => {
        sb.check({ txns });
        const out = detectTransfers(txns);
        if (out.length >= 2) {
          sawMultiPair = true;
          // independently re-assert strict R7 ordering on the DUT output:
          // for every adjacent pair, (out_date,outflow_key) is strictly increasing.
          for (let k = 1; k < out.length; k++) {
            const prev = out[k - 1]!;
            const cur = out[k]!;
            const strictlyOrdered =
              prev.out_date < cur.out_date ||
              (prev.out_date === cur.out_date && prev.outflow_key < cur.outflow_key);
            expect(strictlyOrdered).toBe(true);
          }
          cov.cover('R7.sorted-out-date-asc');
          cov.cover('R7.ties-by-outflow-key');
        }
      }),
      { numRuns: 500 }
    );
    sb.assertClean();
    expect(sawMultiPair).toBe(true);
  });
});

// ============================================================================
// PHASE: fault injection — prove the bench has teeth.
// Self-mutate a COPY of the reference model and confirm the scoreboard FAILS.
// (This is the local proof; Stryker mutation score reported in the sign-off text.)
// ============================================================================
describe('transfer-detector IV&V — reference-model self-mutation (bench teeth)', () => {
  // A deliberately BROKEN reference model: off-by-one window (uses < instead of <=),
  // which should disagree with the DUT on at least one boundary case.
  function brokenRefStrictWindow(
    txns: readonly TransferTxn[],
    opts?: TransferOptions
  ): TransferPair[] {
    const maxGap = opts?.maxGapDays ?? 5;
    return refDetectTransfers(txns, opts).filter((p) => p.gap_days < maxGap); // BUG: drops gap===max
  }

  test('scoreboard FAILS when the reference model is mutated (proves it is not vacuous)', () => {
    const sb = new Scoreboard<{ txns: TransferTxn[]; opts?: TransferOptions }, unknown>({
      dut: ({ txns, opts }) => normalize(detectTransfers(txns, opts)),
      model: ({ txns, opts }) => normalize(brokenRefStrictWindow(txns, opts))
    });
    // a case at the boundary: gap === maxGapDays should pair in the DUT but the
    // broken model drops it.
    sb.check({
      txns: [
        {
          key: 'O',
          account_id: 'A',
          posted_date: '2024-01-10',
          amount_minor: -2000n,
          description: 'plain'
        },
        {
          key: 'I',
          account_id: 'B',
          posted_date: '2024-01-15',
          amount_minor: 2000n,
          description: 'plain'
        }
      ]
    });
    expect(sb.mismatches.length).toBeGreaterThan(0);
    expect(() => sb.assertClean()).toThrow();
  });
});

// ============================================================================
// FINAL GATE: functional-coverage closure
// ============================================================================
describe('transfer-detector IV&V — coverage closure gate', () => {
  test('all planned cover points were exercised', () => {
    console.log(cov.report());
    cov.assertClosed();
  });
});
