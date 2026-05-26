// ISO date helpers.  We store all dates as YYYY-MM-DD strings (not Date objects)
// to keep the schema and JSON serialization clean and avoid timezone surprises.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const SHORT_US_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;
const ISO_LIKE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;

/**
 * Normalize a bank-statement date string to ISO YYYY-MM-DD.
 *
 * Accepted formats (without ambiguous DD/MM — adapters must convert that before calling):
 *   "2026-05-23"  → "2026-05-23"
 *   "05/23/2026"  → "2026-05-23"
 *   "5/23/2026"   → "2026-05-23"
 *   "05/23/26"    → "2026-05-23"   (2-digit year → 20XX if XX < 80, else 19XX)
 *   "2026/05/23"  → "2026-05-23"
 *
 * Throws on ambiguous or unparseable input.
 */
export function normalizeDate(input: string): string {
  const s = input.trim();

  if (ISO_DATE_RE.test(s)) return s;

  const us = US_DATE_RE.exec(s);
  if (us && us[1] !== undefined && us[2] !== undefined && us[3] !== undefined) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }

  const isoLike = ISO_LIKE_RE.exec(s);
  if (isoLike && isoLike[1] !== undefined && isoLike[2] !== undefined && isoLike[3] !== undefined) {
    return `${isoLike[1]}-${isoLike[2].padStart(2, '0')}-${isoLike[3].padStart(2, '0')}`;
  }

  const shortUs = SHORT_US_RE.exec(s);
  if (shortUs && shortUs[1] !== undefined && shortUs[2] !== undefined && shortUs[3] !== undefined) {
    const yearNum = Number.parseInt(shortUs[3], 10);
    const fullYear = yearNum < 80 ? 2000 + yearNum : 1900 + yearNum;
    return `${fullYear}-${shortUs[1].padStart(2, '0')}-${shortUs[2].padStart(2, '0')}`;
  }

  throw new Error(`normalizeDate: unparseable input ${JSON.stringify(input)}`);
}

/**
 * Number of days between two ISO dates.  Positive if `b` is later than `a`.
 */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(
    Number.parseInt(a.slice(0, 4), 10),
    Number.parseInt(a.slice(5, 7), 10) - 1,
    Number.parseInt(a.slice(8, 10), 10)
  );
  const tb = Date.UTC(
    Number.parseInt(b.slice(0, 4), 10),
    Number.parseInt(b.slice(5, 7), 10) - 1,
    Number.parseInt(b.slice(8, 10), 10)
  );
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Whether two ISO dates are within `days` of each other (absolute).
 * Used by the reconciliation matcher (research.md §R12, default ±10 days).
 */
export function isWithinDays(a: string, b: string, days: number): boolean {
  return Math.abs(daysBetween(a, b)) <= days;
}

/**
 * Today's date as ISO YYYY-MM-DD (local time, midnight).
 */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
