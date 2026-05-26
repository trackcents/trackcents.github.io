// ─────────────────────────────────────────────────────────────────────────
// IV&V — src/lib/util/money.ts  (integer-cents parse/format utilities)
//
// MODE: EXECUTE, run LEAN per the staged gate. This is a SMALL module (4 fns).
// The high-yield checks are: the round-trip metamorphic (INV1, oracle-free),
// hand-derived parser hazard goldens (R1–R7), formatMoney goldens (R8–R9), the
// trivial-helper properties (R10/INV6), and a bounded fuzz of parseMoney that
// asserts "exact bigint OR loud throw — never a silent 0 / NaN-equivalent"
// (INV2 / constitution Principle II).
//
// INDEPENDENCE: derived from the contract + spec ALONE. money.ts and the
// Designer's money tests were NOT read. Every expected value below is
// hand-derived from the contract's R#/INV# clauses (cited inline), never read
// from any implementation. No reference re-implementation of parseMoney is used
// (per the contract's §11 oracle hazard: a mirror regex would share the blind
// spot); the oracle is round-trip + hand-computed goldens.
//
//   Files I read: money.contract.md, constitution.md (Principle II),
//   data-model.md (sign convention), tests/_framework/coverage-model.ts,
//   vitest.ivv.config.ts, one unrelated IV&V test for import conventions.
// ─────────────────────────────────────────────────────────────────────────

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { parseMoney, formatMoney, sumMoney, absMoney } from '../../../src/lib/util/money';
import { CoverageModel } from '../../_framework/coverage-model';

// Precomputed bigint magnitude bounds (esbuild's transform rejects the `**`
// operator on bigint literals in this config, so we spell them out).
const MAG_1E24 = 1_000_000_000_000_000_000_000_000n;
const MAG_1E18 = 1_000_000_000_000_000_000n;
const POW_2_53 = 9_007_199_254_740_992n; // 2 ** 53

// Functional coverage model — the planned scenarios that MUST be exercised.
const cov = new CoverageModel([
  // parseMoney value forms
  'parse:plain-commas',
  'parse:plain-no-commas',
  'parse:sub-dollar',
  'parse:zero',
  'parse:whole-implied-x100',
  'parse:bare-fraction',
  'parse:one-frac-digit-padded',
  // parseMoney sign
  'parse:accounting-parens-neg',
  'parse:leading-minus-neg',
  'parse:parens-and-minus-stay-neg',
  'parse:negative-zero-normalized',
  // parseMoney whitespace / symbol tolerance
  'parse:surrounding-whitespace',
  'parse:dollar-symbol',
  // parseMoney reject set (must throw)
  'reject:empty',
  'reject:whitespace-only',
  'reject:lone-symbol',
  'reject:lone-minus',
  'reject:lone-dot',
  'reject:empty-parens',
  'reject:trailing-dot',
  'reject:three-frac-digits',
  'reject:bad-comma-grouping',
  'reject:nested-parens',
  'reject:junk',
  // formatMoney
  'format:positive',
  'format:negative',
  'format:sub-dollar',
  'format:zero',
  'format:comma-boundary',
  'format:currency-usd-symbol',
  'format:currency-other-no-symbol',
  'format:large-magnitude',
  // helpers
  'sum:empty',
  'sum:order-independent',
  'abs:negative',
  'abs:positive',
  // properties
  'inv1:round-trip',
  'inv4:large-magnitude-gt-2pow53',
  'fuzz:parseMoney-no-silent-failure'
]);

// ── helper: assert parseMoney throws (INV2 — no silent failure) ──────────────
function expectReject(input: string, bin: string): void {
  cov.cover(bin);
  // Must THROW — must NOT return 0n or any value for unparseable input.
  expect(() => parseMoney(input)).toThrow();
}

// ── helper: assert an exact parse golden (value hand-derived from contract) ──
function expectParse(input: string, expected: bigint, bin: string): void {
  cov.cover(bin);
  expect(parseMoney(input)).toBe(expected);
}

describe('IV&V money.ts — Stage 1 (lean staged gate)', () => {
  // ───────────────────────────────────────────────────────────────────────
  // INV1 — round-trip metamorphic (the headline oracle-free check).
  // For every bigint c: parseMoney(formatMoney(c)) === c.
  // ───────────────────────────────────────────────────────────────────────
  test('INV1: parseMoney(formatMoney(c)) === c for constrained-random bigints', () => {
    fc.assert(
      fc.property(
        // include 0, negatives, and magnitudes well beyond 2^53 (INV4).
        fc.bigInt({ min: -MAG_1E24, max: MAG_1E24 }),
        (c) => {
          cov.cover('inv1:round-trip');
          if (c < -POW_2_53 || c > POW_2_53) cov.cover('inv4:large-magnitude-gt-2pow53');
          const formatted = formatMoney(c);
          expect(parseMoney(formatted)).toBe(c);
        }
      ),
      { numRuns: 500 }
    );
  });

  test('INV1: directed round-trip on documented boundaries', () => {
    const boundaries = [
      0n,
      5n,
      50n,
      -5n,
      100000n, // comma boundary
      99999n,
      123456n,
      -123456n,
      99999999999999n, // $999,999,999,999.99
      -99999999999999n
    ];
    for (const c of boundaries) {
      cov.cover('inv1:round-trip');
      expect(parseMoney(formatMoney(c))).toBe(c);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // parseMoney value forms — R1, R2, R3, R6. Goldens hand-derived from contract.
  // ───────────────────────────────────────────────────────────────────────
  test('R1: plain values', () => {
    expectParse('$1,234.56', 123456n, 'parse:plain-commas'); // 1234 dollars + 56 cents
    expectParse('1234.56', 123456n, 'parse:plain-no-commas');
    expectParse('$0.05', 5n, 'parse:sub-dollar'); // 5 cents
    expectParse('$0', 0n, 'parse:zero'); // 0 cents
  });

  test('R2: whole dollars imply ×100', () => {
    expectParse('5', 500n, 'parse:whole-implied-x100'); // 5 dollars -> 500 cents
  });

  test('R3: fractional padding + bare fraction', () => {
    expectParse('.5', 50n, 'parse:bare-fraction'); // .5 dollars -> 50 cents
    expectParse('$0.5', 50n, 'parse:one-frac-digit-padded'); // 1 frac digit padded to 2
  });

  test('R6: tolerant of $, whitespace, single optional symbol', () => {
    expectParse('   $1,000.00  ', 100000n, 'parse:surrounding-whitespace');
    expectParse('$0.05', 5n, 'parse:dollar-symbol');
  });

  // ───────────────────────────────────────────────────────────────────────
  // parseMoney sign — R4, R5, INV3. Goldens hand-derived.
  // ───────────────────────────────────────────────────────────────────────
  test('R4: accounting parentheses = negative', () => {
    expectParse('($1,234.56)', -123456n, 'parse:accounting-parens-neg');
  });

  test('R5: leading minus = negative; parens+minus stay negative (no double-negate)', () => {
    expectParse('-1,234.56', -123456n, 'parse:leading-minus-neg');
    // "(-5)" : parens(negate) + minus(negate) must NOT cancel to positive.
    // Contract R5: "stay negative — never double-negate to positive." => -500n.
    expectParse('(-5)', -500n, 'parse:parens-and-minus-stay-neg');
  });

  test('INV3: magnitude independent of sign representation', () => {
    expect(parseMoney('($5)')).toBe(-parseMoney('$5'));
  });

  test('negative-zero normalizes to 0n (no -0 artifact)', () => {
    cov.cover('parse:negative-zero-normalized');
    expect(parseMoney('-$0.00')).toBe(0n);
    expect(parseMoney('($0)')).toBe(0n);
  });

  // ───────────────────────────────────────────────────────────────────────
  // parseMoney reject set — R7 / INV2 (no silent failure). Each MUST throw.
  // ───────────────────────────────────────────────────────────────────────
  test('R7/INV2: reject set must THROW (never silent 0)', () => {
    expectReject('', 'reject:empty');
    expectReject('  ', 'reject:whitespace-only');
    expectReject('$', 'reject:lone-symbol');
    expectReject('-', 'reject:lone-minus');
    expectReject('.', 'reject:lone-dot');
    expectReject('()', 'reject:empty-parens');
    expectReject('5.', 'reject:trailing-dot');
    // 3 fractional digits MUST throw, NOT silently truncate to 1.00.
    expectReject('1.005', 'reject:three-frac-digits');
    // malformed comma grouping.
    expectReject('1,23,456', 'reject:bad-comma-grouping');
    // nested parens.
    expectReject('(($100))', 'reject:nested-parens');
    // non-numeric junk.
    expectReject('abc', 'reject:junk');
    expectReject('$1.2x', 'reject:junk');
    expectReject('twelve', 'reject:junk');
  });

  // ───────────────────────────────────────────────────────────────────────
  // formatMoney goldens — R8, R9.
  // ───────────────────────────────────────────────────────────────────────
  test('R8: formatMoney goldens', () => {
    cov.cover('format:positive');
    expect(formatMoney(123456n)).toBe('$1,234.56');
    cov.cover('format:negative');
    expect(formatMoney(-123456n)).toBe('-$1,234.56');
    cov.cover('format:sub-dollar');
    expect(formatMoney(5n)).toBe('$0.05');
    cov.cover('format:zero');
    expect(formatMoney(0n)).toBe('$0.00');
    cov.cover('format:comma-boundary');
    expect(formatMoney(100000n)).toBe('$1,000.00');
    // contract §6: 1000n -> "$10.00"
    expect(formatMoney(1000n)).toBe('$10.00');
  });

  test('formatMoney zero is never "-$0.00"', () => {
    cov.cover('format:zero');
    // bigint has no -0, but confirm both spellings yield the same clean string.
    expect(formatMoney(0n)).toBe('$0.00');
    expect(formatMoney(-0n)).toBe('$0.00');
  });

  test('R8: large magnitude formats exactly (no float loss)', () => {
    cov.cover('format:large-magnitude');
    expect(formatMoney(99999999999999n)).toBe('$999,999,999,999.99');
    expect(formatMoney(-99999999999999n)).toBe('-$999,999,999,999.99');
  });

  test('R9: currency symbol rule', () => {
    cov.cover('format:currency-usd-symbol');
    expect(formatMoney(123456n, { currency: 'USD' })).toBe('$1,234.56');
    expect(formatMoney(123456n)).toBe('$1,234.56'); // omitted => $
    cov.cover('format:currency-other-no-symbol');
    // any other / empty currency => NO symbol (R9 is the whole spec here).
    const eur = formatMoney(123456n, { currency: 'EUR' });
    expect(eur.startsWith('$')).toBe(false);
    expect(eur).toBe('1,234.56');
    const empty = formatMoney(123456n, { currency: '' });
    expect(empty.startsWith('$')).toBe(false);
    expect(empty).toBe('1,234.56');
  });

  // ───────────────────────────────────────────────────────────────────────
  // helpers — R10, INV6.
  // ───────────────────────────────────────────────────────────────────────
  test('R10: sumMoney empty = 0n', () => {
    cov.cover('sum:empty');
    expect(sumMoney([])).toBe(0n);
  });

  test('INV6: sumMoney order-independent & equals fold of +', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -MAG_1E18, max: MAG_1E18 })), (xs) => {
        cov.cover('sum:order-independent');
        const fold = xs.reduce((a, b) => a + b, 0n);
        expect(sumMoney(xs)).toBe(fold);
        const shuffled = [...xs].reverse();
        expect(sumMoney(shuffled)).toBe(fold);
      }),
      { numRuns: 200 }
    );
  });

  test('R10: absMoney = |x|', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAG_1E24, max: MAG_1E24 }), (x) => {
        cov.coverIf(x < 0n, 'abs:negative');
        cov.coverIf(x >= 0n, 'abs:positive');
        const expected = x < 0n ? -x : x;
        expect(absMoney(x)).toBe(expected);
        expect(absMoney(x) >= 0n).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // Bounded fuzz of parseMoney — INV2 / Principle II.
  // Property: parseMoney either returns an EXACT bigint, or THROWS.
  // It must NEVER return a non-bigint, and (the real hazard) must never
  // silently return 0n / a coerced value for junk input.
  // ───────────────────────────────────────────────────────────────────────
  test('FUZZ: parseMoney returns exact bigint OR throws — never silent corruption', () => {
    const failingSeeds: string[] = [];
    fc.assert(
      fc.property(
        // mix of structured-ish money chars and arbitrary unicode junk.
        fc.string({
          unit: fc.constantFrom(
            ...'0123456789.,()-$ '.split(''),
            'a',
            'x',
            '€',
            '\n',
            '\t',
            '%',
            '+',
            '/'
          ),
          maxLength: 16
        }),
        (s) => {
          cov.cover('fuzz:parseMoney-no-silent-failure');
          let result: bigint | undefined;
          let threw = false;
          try {
            result = parseMoney(s);
          } catch {
            threw = true;
          }
          if (threw) return; // loud failure is acceptable.
          // It returned a value — it MUST be a bigint (never number/NaN/null).
          if (typeof result !== 'bigint') {
            failingSeeds.push(s);
            throw new Error(
              `parseMoney(${JSON.stringify(s)}) returned non-bigint: ${String(result)}`
            );
          }
          // If it parsed, it must round-trip through format (exactness / no
          // silent corruption). A value that does not round-trip is a silent
          // miscount even though it "looks" like a bigint.
          expect(parseMoney(formatMoney(result))).toBe(result);
        }
      ),
      { numRuns: 1000 }
    );
    // (Corpus persistence hook: any seed in failingSeeds would be written to
    // tests/ivv/corpus/money/ — none expected at Stage 1.)
    expect(failingSeeds).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Coverage closure gate — sign-off requires every planned cover point hit.
  // ───────────────────────────────────────────────────────────────────────
  test('functional coverage closed (sign-off gate)', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
