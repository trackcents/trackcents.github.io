/**
 * CSV export (US-P4-D) — pure logic. Renders transactions to RFC-4180 CSV for
 * taxes / backup / spreadsheets.
 *
 * Money is rendered from the bigint cents to a fixed 2-decimal string WITHOUT
 * any float arithmetic (constitution II): cents → `${whole}.${frac}`. Round-trips
 * with `csv-import.ts` (verified by IV&V).
 */

export interface CsvExportRow {
  posted_date: string; // ISO YYYY-MM-DD
  description: string;
  amount_minor: bigint; // signed cents
  currency: string;
  account: string; // bank/account nickname
  category?: string | null; // resolved category name (optional)
}

/** Fixed column order. Importer recognises these header names. */
export const CSV_COLUMNS = [
  'date',
  'description',
  'amount',
  'currency',
  'account',
  'category'
] as const;

/** bigint cents → signed 2-decimal string, no float. e.g. -1234n → "-12.34". */
export function centsToDecimal(amount_minor: bigint): string {
  const neg = amount_minor < 0n;
  const abs = neg ? -amount_minor : amount_minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/** RFC-4180 field quoting: wrap in quotes (doubling internal quotes) when needed. */
export function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** Serialize rows to a CSV document (CRLF line endings, header row first). */
export function exportTransactionsCsv(rows: readonly CsvExportRow[]): string {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.posted_date,
        r.description,
        centsToDecimal(r.amount_minor),
        r.currency,
        r.account,
        r.category ?? ''
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}
