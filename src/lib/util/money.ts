// Money utilities — integer cents only.  No floats anywhere.
//
// All values are bigint, signed.  Outflow is negative, inflow is positive.
// Constitution Principle II: floating-point arithmetic for money is FORBIDDEN.
// ESLint rule in eslint.config.js helps catch accidental float introduction in this file.

// The whole-dollar group is OPTIONAL because PDF.js sometimes emits sub-$1
// amounts as ".50" — the visible "$0" glyph cluster is split into separate
// text items and the leading "0" lands at a different X than the decimal.
// At least one of the whole part OR the fractional part must be present;
// that's enforced by the post-match check below, not the regex itself.
const MONEY_RE = /^\s*(-)?\s*\(?\s*\$?\s*(\d{1,3}(?:,\d{3})*|\d+)?(?:\.(\d{1,2}))?\s*\)?\s*$/;

const PARENS_NEGATIVE_RE = /^\s*\(\s*.+\s*\)\s*$/;

/**
 * Parse a money string into signed integer cents.
 *
 * Accepts a wide range of bank-statement formats:
 *   "$1,234.56"   → 123456n
 *   "1234.56"     → 123456n
 *   "($1,234.56)" → -123456n   (accounting parentheses = negative)
 *   "-1,234.56"   → -123456n
 *   "$0.05"       → 5n
 *   "$0"          → 0n
 *   "5"           → 500n        (whole dollars implied)
 *
 * Throws if the input is unparseable.  Never silently returns 0 on bad input —
 * that would violate Principle II (no silent parser failures).
 */
export function parseMoney(text: string): bigint {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new Error('parseMoney: empty string');
  }
  // Reject nested parens: "(($100))" could be an accidentally-double-wrapped
  // accounting value or layout corruption.  Either way, ambiguous → throw.
  // Single-pair parens (accounting negative) is fine and still parses below.
  if ((trimmed.match(/\(/g)?.length ?? 0) > 1 || (trimmed.match(/\)/g)?.length ?? 0) > 1) {
    throw new Error(`parseMoney: nested parens not allowed in ${JSON.stringify(text)}`);
  }

  const negative = PARENS_NEGATIVE_RE.test(trimmed);
  const cleaned = negative ? trimmed.replace(/^\s*\(/, '').replace(/\)\s*$/, '') : trimmed;
  const match = MONEY_RE.exec(cleaned);

  if (!match) {
    throw new Error(`parseMoney: unparseable input ${JSON.stringify(text)}`);
  }
  // Reject strings with neither a whole nor a fractional digit (e.g., "$",
  // "-", ".", or empty after the optional symbol).
  if (match[2] === undefined && match[3] === undefined) {
    throw new Error(`parseMoney: unparseable input ${JSON.stringify(text)}`);
  }

  const explicitNeg = match[1] === '-';
  const wholeRaw = (match[2] ?? '0').replace(/,/g, '');
  const fracRaw = (match[3] ?? '').padEnd(2, '0').slice(0, 2);

  const cents = BigInt(wholeRaw) * 100n + BigInt(fracRaw);
  return negative || explicitNeg ? -cents : cents;
}

/**
 * Format signed integer cents as a money string.
 *
 *   123456n  → "$1,234.56"
 *   -123456n → "-$1,234.56"
 *   5n       → "$0.05"
 *   0n       → "$0.00"
 */
export function formatMoney(cents: bigint, opts: { currency?: string } = {}): string {
  const symbol = opts.currency === 'USD' || opts.currency === undefined ? '$' : '';
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = frac.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${symbol}${wholeStr}.${fracStr}`;
}

/**
 * Sum an iterable of bigint cents.  Uses BigInt throughout — never overflows
 * for any realistic financial dataset.
 */
export function sumMoney(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/**
 * Absolute value as bigint.  Math.abs doesn't work on bigint.
 */
export function absMoney(cents: bigint): bigint {
  return cents < 0n ? -cents : cents;
}
