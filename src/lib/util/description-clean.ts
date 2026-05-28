/**
 * Description normalization (REQ-B0.3).
 *
 * Real bank/CC PDFs are riddled with ACH plumbing — `PPD ID:`, `Web ID:`,
 * trailing reference numbers, leading "MM/DD" prefixes that duplicate the row's
 * own posted_date.  These tokens are useless to a human, AND they split a single
 * merchant into N separate "recurring" streams because each instance has a
 * different reference number.  We strip them once, at the boundary, and use the
 * cleaned form everywhere downstream (categorization, recurring detection,
 * spending trends, statement display).
 *
 * Provenance: the raw description survives in `ParsedTransaction.raw_text` and
 * (when present) `ParsedTransaction.description`.  This module is a DISPLAY
 * normalizer; it never mutates the source.
 *
 * Pure.  Tested in tests/unit/util/description-clean.test.ts against real
 * descriptions from temp3.
 */

const PATTERNS_TO_STRIP: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // ── Pass 1: explicit ACH metadata labels (strip BEFORE the generic tail
  // pattern below, otherwise the tail eats the metadata's number first and
  // leaves the dangling "Reference#:"). ────────────────────────────────────
  { pattern: /\s*Web ID:\s*\d+\b/gi, replacement: '' },
  { pattern: /\s*PPD ID:\s*\d+\b/gi, replacement: '' },
  { pattern: /\s*Transaction#:\s*\S*/gi, replacement: '' },
  { pattern: /\s*Reference#:\s*\S*/gi, replacement: '' },

  // Leading "MM/DD " prefix on descriptions that already have a posted_date
  // column.  Chase uses this for cross-account online-banking transactions,
  // e.g. "04/04 Payment To Chase Card Ending IN 1797".
  { pattern: /^\s*\d{2}\/\d{2}\s+/, replacement: '' },

  // ── Pass 2: trailing reference-number tail.  9+ chars AND must contain
  // ≥3 digits TOTAL — so we strip "Pwbs8157638769", "Ckf148086844POS",
  // "Jpm99Caskoo2", "2401134FA2X82QT3V" but PRESERVE pure-letter trailers
  // like "GEORGETOWN" / "POPSTROKE" / "AUSTIN TX" that are part of merchant
  // names.  The lookahead enforces both length and digit-density.
  {
    pattern: /\s+(?=\S{9,}\s*$)(?=(?:\D*\d){3,})\S+\s*$/,
    replacement: ''
  },

  // Trailing pure-numeric tails (6+ digits) — covers shorter all-digit IDs
  // like "Capture 1050187" where the prefix is the descriptor.
  { pattern: /\s+\d{6,}\s*$/, replacement: '' },

  // Whitespace collapse + edge trim (must be last).
  { pattern: /\s+/g, replacement: ' ' }
];

/**
 * Strip ACH metadata + reference numbers + leading date prefixes from a
 * transaction description.  Empty string in → empty string out.  Idempotent:
 * `cleanDescription(cleanDescription(x)) === cleanDescription(x)`.
 *
 * Preserves merchant name + city/state/country suffix (Chase / Amex / BofA
 * format).
 */
export function cleanDescription(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw;
  for (const { pattern, replacement } of PATTERNS_TO_STRIP) {
    s = s.replace(pattern, replacement);
  }
  return s.trim();
}

/**
 * Like cleanDescription but uppercases + collapses internal whitespace, so
 * `"COSTCO WHSE #1152"` and `"Costco  Whse  #1152"` produce the same key.  Used
 * for merchant grouping in recurring detection + most-frequent-merchants
 * aggregation.
 */
export function descriptorKey(raw: string): string {
  return cleanDescription(raw).toUpperCase();
}
