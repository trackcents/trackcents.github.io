/**
 * CSV import (US-IMP-CSV) — pure logic. Imports a transaction CSV for a bank we
 * have no PDF adapter for (or for the user's own export). Decision D9
 * (DECISIONS.md): a CSV carries NO printed statement total, so the checksum
 * invariant — a HARD gate for PDF imports (constitution II) — is ADVISORY here.
 * The resulting import is flagged `csv-import (no checksum)` so the UI can show it
 * as un-reconciled.
 *
 * No silent failures (memory `feedback_no_silent_failures`): a malformed row
 * THROWS `CsvImportError` with the 1-based row number and the offending cell.
 * Money is parsed to bigint cents with NO float (constitution II). Round-trips
 * with `export-csv.ts`.
 */
import type { ImportRecord } from '../db/store';
import type { ParsedStatement, ParsedTransaction, TransactionType } from '../adapters/types';

export const CSV_ADAPTER_NAME = 'csv-import';
export const CSV_ADAPTER_VERSION = '1.0.0';

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}

/**
 * RFC-4180 parser: handles quoted fields, escaped quotes (""), and embedded
 * commas / newlines inside quotes. Accepts CRLF or LF. Returns rows of cells.
 * Blank lines (outside quotes) are skipped.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // skip a row that is a single empty cell (blank line)
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
      i++;
      continue;
    }
    if (c === ',') {
      sawAny = true;
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      sawAny = true;
      endRow();
      if (text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    if (c === '\n') {
      sawAny = true;
      endRow();
      i++;
      continue;
    }
    field += c;
    sawAny = true;
    i++;
  }
  if (inQuotes) {
    throw new CsvImportError('CSV import: unterminated quoted field (a `"` was never closed)');
  }
  // flush trailing field/row if the file didn't end in a newline
  if (field !== '' || row.length > 0) endRow();
  if (!sawAny) return [];
  return rows;
}

/** Parse a signed decimal money string to bigint cents — no float. */
export function parseAmountToCents(raw: string, rowNum: number): bigint {
  let s = raw.trim();
  if (s === '') throw new CsvImportError(`CSV import: row ${rowNum}: amount is empty`);
  let neg = false;
  // Accounting parens: (12.34) = negative.
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  // Strip currency symbols, thousands separators, spaces.
  s = s.replace(/[$£€¥₹,\s]/g, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new CsvImportError(`CSV import: row ${rowNum}: "${raw}" is not a valid amount`);
  }
  const dot = s.indexOf('.');
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  const fracTwo = (frac + '00').slice(0, 2);
  let cents = BigInt(whole === '' ? '0' : whole) * 100n + BigInt(fracTwo);
  // round to nearest cent if more precision was given
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1n;
  return neg ? -cents : cents;
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ['date', 'posted', 'posted_date', 'posted date', 'transaction date', 'trans date'],
  description: ['description', 'name', 'memo', 'details', 'payee', 'narration'],
  amount: ['amount', 'value'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out'],
  credit: ['credit', 'deposit', 'deposits', 'money in'],
  currency: ['currency', 'ccy'],
  category: ['category']
};

function buildHeaderMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((cell, idx) => {
    const norm = cell.trim().toLowerCase();
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm) && map[canonical] === undefined) map[canonical] = idx;
    }
  });
  return map;
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface CsvImportOptions {
  /** Account nickname / bank label for the imported rows. */
  account_name: string;
  /** Account type; defaults to 'other'. */
  account_type?: ParsedStatement['account_type'];
  /** Default ISO 4217 when a row has no currency column. Defaults to 'USD'. */
  default_currency?: string;
  /** Provenance hash (stable id) for this import. */
  source_id: string;
  /** Creation timestamp (ISO). */
  imported_at: string;
}

/**
 * Parse a CSV document into a single `ImportRecord` (checksum advisory). Requires
 * a header row naming at least a date, a description, and either an `amount`
 * column or a `debit`/`credit` pair. Throws `CsvImportError` (with row context)
 * on any malformed row — never imports partial/garbled data silently.
 */
export function importCsv(text: string, opts: CsvImportOptions): ImportRecord {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new CsvImportError('CSV import: file is empty');
  const header = rows[0]!;
  const h = buildHeaderMap(header);

  if (h.date === undefined || h.description === undefined) {
    throw new CsvImportError(
      'CSV import: header must include a date column and a description column ' +
        `(saw: ${header.join(', ')})`
    );
  }
  const hasAmount = h.amount !== undefined;
  const hasDebitCredit = h.debit !== undefined || h.credit !== undefined;
  if (!hasAmount && !hasDebitCredit) {
    throw new CsvImportError(
      'CSV import: header must include an "amount" column, or a "debit"/"credit" pair'
    );
  }

  const currency = (opts.default_currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CsvImportError(`CSV import: default_currency must be ISO 4217 (got "${currency}")`);
  }

  const cell = (r: string[], idx: number | undefined): string =>
    idx === undefined ? '' : (r[idx] ?? '').trim();

  const transactions: ParsedTransaction[] = [];
  for (let r = 1; r < rows.length; r++) {
    const rowNum = r + 1; // 1-based, header is row 1
    const cols = rows[r]!;
    const date = cell(cols, h.date);
    if (!isValidIsoDate(date)) {
      throw new CsvImportError(
        `CSV import: row ${rowNum}: date "${date}" is not ISO YYYY-MM-DD ` +
          `(convert dates to e.g. 2026-05-20 before import)`
      );
    }
    const description = cell(cols, h.description);
    if (description === '') {
      throw new CsvImportError(`CSV import: row ${rowNum}: description is empty`);
    }

    let amount_minor: bigint;
    if (hasAmount) {
      amount_minor = parseAmountToCents(cell(cols, h.amount), rowNum);
    } else {
      const debit = cell(cols, h.debit);
      const credit = cell(cols, h.credit);
      if (debit !== '' && credit !== '') {
        throw new CsvImportError(
          `CSV import: row ${rowNum}: both debit and credit are filled — exactly one expected`
        );
      }
      if (debit !== '') amount_minor = -absCents(parseAmountToCents(debit, rowNum));
      else if (credit !== '') amount_minor = absCents(parseAmountToCents(credit, rowNum));
      else throw new CsvImportError(`CSV import: row ${rowNum}: neither debit nor credit is set`);
    }

    const rowCurrency = cell(cols, h.currency);
    const txCurrency = rowCurrency !== '' ? rowCurrency.toUpperCase() : currency;
    if (!/^[A-Z]{3}$/.test(txCurrency)) {
      throw new CsvImportError(`CSV import: row ${rowNum}: currency "${rowCurrency}" not ISO 4217`);
    }

    const type: TransactionType = amount_minor < 0n ? 'purchase' : 'deposit';
    transactions.push({
      posted_date: date,
      description,
      raw_text: cols.join(','),
      amount_minor,
      currency: txCurrency,
      transaction_type: type,
      status: 'posted'
    });
  }

  if (transactions.length === 0) {
    throw new CsvImportError('CSV import: no data rows found after the header');
  }

  const dates = transactions.map((t) => t.posted_date).sort();
  const statement: ParsedStatement = {
    account_type: opts.account_type ?? 'other',
    account_last_4: null,
    period_start: dates[0]!,
    period_end: dates[dates.length - 1]!,
    currency,
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: transactions.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: dates[dates.length - 1]!,
    minimum_payment_due_minor: null,
    parser_provides: ['D'] // count only; no printed total to reconcile (advisory)
  };

  return {
    bank_name: opts.account_name.trim() || 'Imported CSV',
    adapter_name: CSV_ADAPTER_NAME,
    adapter_version: CSV_ADAPTER_VERSION,
    pdf_source_hash: `csv-${opts.source_id}`,
    imported_at: opts.imported_at,
    statement,
    transactions,
    checksum_strategy_used: 'csv-import (no checksum)'
  };
}

function absCents(v: bigint): bigint {
  return v < 0n ? -v : v;
}
