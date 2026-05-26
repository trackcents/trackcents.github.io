// Property-based tests for money.ts.  These complement the example-based
// tests in money.test.ts by exploring inputs neither of us thought of.
//
// Targets identified by mutation testing baseline (2026-05-23):
//   - 37 mutants survived on money.ts (mutation score 72.66%).
//   - Bulk of survivors: whitespace tolerance inside PARENS_NEGATIVE_RE
//     ("($100)" vs " ( $100 ) " vs "($ 100)").
//   - parseMoney/formatMoney round-trip not covered.

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseMoney, formatMoney } from '../../../src/lib/util/money';

// ── Arbitraries (input generators) ───────────────────────────────────────────

// Integer cents bigints in a realistic statement range.  ±1 billion cents
// covers anyone who isn't a hedge fund.
const realisticCents = (): fc.Arbitrary<bigint> =>
  fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n });

// ── Round-trip property ──────────────────────────────────────────────────────

describe('parseMoney ∘ formatMoney is the identity on realistic cents', () => {
  test('any bigint within ±$10M can be formatted and parsed back exactly', () => {
    fc.assert(
      fc.property(realisticCents(), (cents) => {
        const formatted = formatMoney(cents, { currency: 'USD' });
        const parsed = parseMoney(formatted);
        expect(parsed).toBe(cents);
      }),
      { numRuns: 500 }
    );
  });
});

// ── Whitespace tolerance ─────────────────────────────────────────────────────
//
// The mutation testing run flagged the inner `\s*` in PARENS_NEGATIVE_RE as
// not being exercised by any test.  These properties cover that surface.

describe('parseMoney handles arbitrary whitespace inside the value', () => {
  test('leading and trailing whitespace around a number is ignored', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 100_000_000n }),
        fc.string({ unit: fc.constantFrom(' ', '\t'), maxLength: 5 }),
        fc.string({ unit: fc.constantFrom(' ', '\t'), maxLength: 5 }),
        (cents, leftPad, rightPad) => {
          const formatted = formatMoney(cents, { currency: 'USD' });
          const padded = `${leftPad}${formatted}${rightPad}`;
          expect(parseMoney(padded)).toBe(cents);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('whitespace between paren and dollar sign and digits is tolerated', () => {
    // Examples: "($100)" "( $100 )" "($ 100)" "( $ 100.50 )"
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 100_000_000n }),
        fc.string({ unit: fc.constant(' '), maxLength: 3 }),
        fc.string({ unit: fc.constant(' '), maxLength: 3 }),
        fc.string({ unit: fc.constant(' '), maxLength: 3 }),
        fc.string({ unit: fc.constant(' '), maxLength: 3 }),
        (cents, ws1, ws2, ws3, ws4) => {
          const formatted = formatMoney(cents, { currency: 'USD' });
          // Strip the formatter's leading "$"+digits to rebuild inside parens
          const noDollar = formatted.replace(/^-?\$/, '');
          const candidate = `(${ws1}$${ws2}${noDollar}${ws3})${ws4}`;
          expect(parseMoney(candidate)).toBe(-cents);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── Sign invariants ──────────────────────────────────────────────────────────

describe('sign invariants', () => {
  test('negating cents flips the sign of the parsed value', () => {
    fc.assert(
      fc.property(
        realisticCents().filter((c) => c !== 0n),
        (cents) => {
          const positive = formatMoney(cents > 0n ? cents : -cents, { currency: 'USD' });
          const negative = formatMoney(cents > 0n ? -cents : cents, { currency: 'USD' });
          expect(parseMoney(positive)).toBe(parseMoney(negative) * -1n);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('accounting parens form (X) equals -X for the same X', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 100_000_000n }), (cents) => {
        const positive = formatMoney(cents, { currency: 'USD' });
        const parens = `(${positive})`;
        expect(parseMoney(parens)).toBe(-cents);
      }),
      { numRuns: 200 }
    );
  });

  test('"-" and "(...)" both produce the same negative value', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 100_000_000n }), (cents) => {
        const dashForm = `-${formatMoney(cents, { currency: 'USD' })}`;
        const parensForm = `(${formatMoney(cents, { currency: 'USD' })})`;
        expect(parseMoney(dashForm)).toBe(parseMoney(parensForm));
        expect(parseMoney(dashForm)).toBe(-cents);
      }),
      { numRuns: 200 }
    );
  });
});

// ── Throw-on-invalid invariants ──────────────────────────────────────────────

describe('parseMoney throws on inputs it cannot represent', () => {
  test('empty / whitespace-only inputs throw', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), maxLength: 8 }), (ws) => {
        expect(() => parseMoney(ws)).toThrow();
      }),
      { numRuns: 50 }
    );
  });

  test('nested parens are rejected', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 100_000n }), (cents) => {
        const formatted = formatMoney(cents, { currency: 'USD' });
        expect(() => parseMoney(`((${formatted}))`)).toThrow(/nested parens/);
      }),
      { numRuns: 50 }
    );
  });

  test('only a sign or symbol with no digits is rejected', () => {
    expect(() => parseMoney('$')).toThrow();
    expect(() => parseMoney('-')).toThrow();
    expect(() => parseMoney('-$')).toThrow();
    expect(() => parseMoney('.')).toThrow();
    expect(() => parseMoney('()')).toThrow();
    expect(() => parseMoney('($)')).toThrow();
  });

  test('random garbage strings throw (or produce something we can re-parse)', () => {
    // Property: if parseMoney accepts a string, the value it returns is one
    // that round-trips through formatMoney.  Anything else throws.
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        let parsed: bigint;
        try {
          parsed = parseMoney(s);
        } catch {
          return; // good — invalid input rejected
        }
        // If it parsed, the round-trip must be stable.
        const re = parseMoney(formatMoney(parsed, { currency: 'USD' }));
        expect(re).toBe(parsed);
      }),
      { numRuns: 500 }
    );
  });
});
