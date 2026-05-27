// parseMoney / formatMoney / sumMoney / absMoney unit tests.
//
// The sub-$1 leading-zero-omitted form (".50") was discovered via the
// 20260314-statements-1797-.pdf smoke test: PDF.js emits "$0.50" as
// separate text items and the leading "0" ends up at a different X-position
// than the decimal, so the amount-column item is just ".50".  Earlier
// versions of parseMoney rejected this and the chase-credit-card adapter
// silently substituted 0n — masking $1.84 of real transactions.

import { describe, expect, test } from 'vitest';
import {
  absMoney,
  formatMoney,
  getDisplayCurrency,
  parseMoney,
  setDisplayCurrency,
  sumMoney
} from '../../../src/lib/util/money';

describe('parseMoney', () => {
  test('parses standard dollar amounts', () => {
    expect(parseMoney('$1,234.56')).toBe(123456n);
    expect(parseMoney('1234.56')).toBe(123456n);
    expect(parseMoney('$1')).toBe(100n);
    expect(parseMoney('$0')).toBe(0n);
    expect(parseMoney('$0.00')).toBe(0n);
  });

  test('parses negative amounts', () => {
    expect(parseMoney('-1,234.56')).toBe(-123456n);
    expect(parseMoney('-$50.43')).toBe(-5043n);
    expect(parseMoney('($1,234.56)')).toBe(-123456n);
    expect(parseMoney('(50.00)')).toBe(-5000n);
  });

  test('parses whole-dollar amounts without decimal', () => {
    expect(parseMoney('5')).toBe(500n);
    expect(parseMoney('1,000')).toBe(100000n);
  });

  test('parses single-digit cents (pads to 2)', () => {
    expect(parseMoney('$0.5')).toBe(50n);
    expect(parseMoney('1.5')).toBe(150n);
  });

  // Regression — sub-$1 amounts with leading zero omitted (PDF.js artifact)
  test('parses ".50" as 50n (no leading zero)', () => {
    expect(parseMoney('.50')).toBe(50n);
  });

  test('parses "-.50" as -50n', () => {
    expect(parseMoney('-.50')).toBe(-50n);
  });

  test('parses "$.34" as 34n', () => {
    expect(parseMoney('$.34')).toBe(34n);
  });

  test('parses ".5" (single-cent digit) as 50n', () => {
    expect(parseMoney('.5')).toBe(50n);
  });

  test('parses "(.50)" as -50n', () => {
    expect(parseMoney('(.50)')).toBe(-50n);
  });

  // Rejection cases — must throw, not silently return 0.
  test('rejects empty string', () => {
    expect(() => parseMoney('')).toThrow();
    expect(() => parseMoney('  ')).toThrow();
  });

  test('rejects bare punctuation with no digits', () => {
    expect(() => parseMoney('$')).toThrow();
    expect(() => parseMoney('-')).toThrow();
    expect(() => parseMoney('.')).toThrow();
    expect(() => parseMoney('-.')).toThrow();
    expect(() => parseMoney('$.')).toThrow();
  });

  test('rejects letters and gibberish', () => {
    expect(() => parseMoney('X.XX')).toThrow();
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseMoney('USD 50')).toThrow();
  });

  // ── Financial-domain edge cases ──────────────────────────────────────────
  // Sourced from accounting conventions (GAAP/FASB) and observed credit-card
  // statement formats.  parseMoney is the single-source-of-truth for money
  // strings — adapters must NOT do their own parsing.
  test('parens-negative is standard accounting format (GAAP/FASB)', () => {
    expect(parseMoney('($100)')).toBe(-10000n);
    expect(parseMoney('($1,234.56)')).toBe(-123456n);
    expect(parseMoney('(100.00)')).toBe(-10000n);
    expect(parseMoney('($0.50)')).toBe(-50n);
  });

  test('handles all zero forms', () => {
    expect(parseMoney('0')).toBe(0n);
    expect(parseMoney('0.00')).toBe(0n);
    expect(parseMoney('$0')).toBe(0n);
    expect(parseMoney('$0.00')).toBe(0n);
    expect(parseMoney('-$0.00')).toBe(0n);
  });

  test('handles whitespace and trims around amounts', () => {
    expect(parseMoney('  $100.00  ')).toBe(10000n);
    expect(parseMoney('$ 100.00')).toBe(10000n);
    expect(parseMoney('- $100.00')).toBe(-10000n);
  });

  test('handles million-dollar amounts (rare but valid)', () => {
    expect(parseMoney('$1,234,567.89')).toBe(123456789n);
    expect(parseMoney('-$1,234,567.89')).toBe(-123456789n);
  });

  test('rejects sub-cent precision (3+ decimal digits)', () => {
    // Sub-cent amounts on a USD bank statement indicate a parser bug, not a
    // valid amount.  Throw rather than silently truncate or round.
    expect(() => parseMoney('100.001')).toThrow();
    expect(() => parseMoney('$0.001')).toThrow();
  });

  test('rejects unsupported suffixes (CR, DR, trailing minus, currency code)', () => {
    // These formats DO exist on some statements but each requires per-adapter
    // normalization before reaching parseMoney.  Loudly rejecting them here
    // forces adapters to declare their intent.
    expect(() => parseMoney('$100.00 CR')).toThrow();
    expect(() => parseMoney('$100.00 DR')).toThrow();
    expect(() => parseMoney('100.00-')).toThrow();
    expect(() => parseMoney('USD 100.00')).toThrow();
    expect(() => parseMoney('EUR 100.00')).toThrow();
  });

  // ── Adversarial QA pass (2026-05-23) ───────────────────────────────────
  // Inputs a malicious bank-statement layout could plausibly produce, or a
  // copy-paste corruption a user might introduce.
  test('rejects nested parens (($100))', () => {
    expect(() => parseMoney('(($100))')).toThrow();
  });

  test('rejects multiple decimal points', () => {
    expect(() => parseMoney('1.2.3')).toThrow();
    expect(() => parseMoney('$1..50')).toThrow();
  });

  test('rejects internal whitespace between digits', () => {
    // "1 234.56" must not be treated as 1234.56 — that could mask a
    // parser-broken description that bled into the amount column.
    expect(() => parseMoney('1 234.56')).toThrow();
  });

  test('rejects double-negative ("--$50")', () => {
    expect(() => parseMoney('--$50.00')).toThrow();
  });

  test('rejects empty parens "()"', () => {
    expect(() => parseMoney('()')).toThrow();
  });

  test('parses negative zero as 0n (not throw)', () => {
    expect(parseMoney('-0')).toBe(0n);
    expect(parseMoney('-$0.00')).toBe(0n);
    expect(parseMoney('(0.00)')).toBe(0n);
  });

  test('parses smallest non-zero amount $0.01', () => {
    expect(parseMoney('$0.01')).toBe(1n);
    expect(parseMoney('.01')).toBe(1n);
    expect(parseMoney('-$0.01')).toBe(-1n);
  });

  test('handles tab characters as whitespace', () => {
    expect(parseMoney('\t$100.00\t')).toBe(10000n);
    expect(parseMoney('  -$50.00  ')).toBe(-5000n);
  });

  test('rejects newlines (suspicious — likely cross-row contamination)', () => {
    // If "\n" appears in the amount string, the layout parser likely fed it
    // two rows merged.  Reject loudly so the bug surfaces.
    expect(() => parseMoney('$100.00\n$50.00')).toThrow();
    expect(() => parseMoney('$100\n.00')).toThrow();
  });

  test('rejects unicode digits (e.g., Arabic-Indic digits)', () => {
    // PDFs CAN contain non-Latin digits in foreign-bank statements.  Adapters
    // for those banks would normalize first; parseMoney rejects them so a
    // missing-normalization step is loud.
    expect(() => parseMoney('$١٠٠.٠٠')).toThrow(); // Arabic-Indic 100.00
    expect(() => parseMoney('$１００.００')).toThrow(); // Fullwidth Latin
  });
});

describe('formatMoney', () => {
  test('formats positive amounts', () => {
    expect(formatMoney(123456n)).toBe('$1,234.56');
    expect(formatMoney(50n)).toBe('$0.50');
    expect(formatMoney(0n)).toBe('$0.00');
  });

  test('formats negative amounts with leading dash', () => {
    expect(formatMoney(-123456n)).toBe('-$1,234.56');
    expect(formatMoney(-50n)).toBe('-$0.50');
  });

  test('formats INR with ₹ and Indian digit grouping', () => {
    expect(formatMoney(12345678n, { currency: 'INR' })).toBe('₹1,23,456.78');
    expect(formatMoney(100000n, { currency: 'INR' })).toBe('₹1,000.00');
    expect(formatMoney(100000000n, { currency: 'INR' })).toBe('₹10,00,000.00');
    expect(formatMoney(-500n, { currency: 'INR' })).toBe('-₹5.00');
    expect(formatMoney(0n, { currency: 'INR' })).toBe('₹0.00');
  });

  test('unknown currency code renders no symbol, Western grouping', () => {
    expect(formatMoney(123456n, { currency: 'EUR' })).toBe('1,234.56');
  });
});

describe('display currency (module default)', () => {
  test('setDisplayCurrency changes no-arg formatMoney; default is USD; reset works', () => {
    expect(getDisplayCurrency()).toBe('USD');
    expect(formatMoney(123456n)).toBe('$1,234.56');
    try {
      setDisplayCurrency('INR');
      expect(getDisplayCurrency()).toBe('INR');
      expect(formatMoney(12345678n)).toBe('₹1,23,456.78');
    } finally {
      setDisplayCurrency('USD'); // reset so the rest of the suite sees the USD default
    }
    expect(getDisplayCurrency()).toBe('USD');
    expect(formatMoney(123456n)).toBe('$1,234.56');
  });
});

describe('sumMoney and absMoney', () => {
  test('sumMoney adds bigint values', () => {
    expect(sumMoney([100n, 200n, 50n])).toBe(350n);
    expect(sumMoney([])).toBe(0n);
    expect(sumMoney([-100n, 200n])).toBe(100n);
  });

  test('absMoney returns bigint absolute value', () => {
    expect(absMoney(-1234n)).toBe(1234n);
    expect(absMoney(1234n)).toBe(1234n);
    expect(absMoney(0n)).toBe(0n);
  });
});
