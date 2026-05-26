/**
 * Manual transaction entry (US-P3-B) — pure logic.
 *
 * Lets the user record a transaction that isn't on any statement (cash spend, a
 * loan to a friend, a reimbursement). Design decision D8 (reports/overnight-build/
 * DECISIONS.md): each manual transaction is represented as a SINGLE-transaction
 * synthetic `ImportRecord` under a "Cash" account, keyed by a STABLE id
 * (`manual-<id>`). Because every aggregation/categorization path already consumes
 * `ImportRecord[]` and addresses transactions by `<pdf_source_hash>#<index>`, a
 * manual entry instantly appears in spending, dashboards, the transactions view,
 * categorization, recurring detection, and merchant trends — with NO change to
 * those modules. A stable per-entry hash means deleting one manual txn never
 * reindexes another's annotation key.
 *
 * No checksum gate: there is no printed statement total to reconcile against
 * (constitution II's hard gate is a PDF-import concept). We still validate every
 * field and THROW with context on bad input — no silent failures (memory
 * `feedback_no_silent_failures`). Money stays bigint cents (constitution II).
 */
import type { ImportRecord } from '../db/store';
import type { ParsedStatement, ParsedTransaction, TransactionType } from '../adapters/types';

export const MANUAL_ADAPTER_NAME = 'manual';
export const MANUAL_ADAPTER_VERSION = '1.0.0';
export const CASH_BANK_NAME = 'Cash';

export interface ManualTxnInput {
  /** ISO YYYY-MM-DD. */
  posted_date: string;
  /** Human description; must be non-empty after trimming. */
  description: string;
  /** Signed cents: negative = expense/outflow, positive = income/inflow. Non-zero. */
  amount_minor: bigint;
  /** Display nickname for the account; defaults to "Cash". */
  account_nickname?: string;
  /** ISO 4217; defaults to "USD". */
  currency?: string;
  /** Optional explicit type; otherwise derived from the sign. */
  transaction_type?: TransactionType;
}

export class ManualEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualEntryError';
  }
}

/** The stable provenance hash for a manual transaction id. */
export function manualSourceHash(id: string): string {
  return `manual-${id}`;
}

/** Is this import a manually-entered transaction (vs a parsed PDF)? */
export function isManualImport(rec: Pick<ImportRecord, 'adapter_name'>): boolean {
  return rec.adapter_name === MANUAL_ADAPTER_NAME;
}

/** Split a mixed import list into PDF-parsed vs manually-entered. */
export function partitionManual(imports: ImportRecord[]): {
  pdf: ImportRecord[];
  manual: ImportRecord[];
} {
  const pdf: ImportRecord[] = [];
  const manual: ImportRecord[] = [];
  for (const i of imports) (isManualImport(i) ? manual : pdf).push(i);
  return { pdf, manual };
}

/** A new random id for a manual entry (crypto UUID, with a deterministic fallback). */
export function newManualId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (very old/test).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** True only for a real calendar date in ISO YYYY-MM-DD form. */
function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Build a schema-valid, single-transaction Cash `ImportRecord` from manual input.
 * `id` makes the provenance hash stable (the caller persists it); `importedAtIso`
 * is the creation timestamp. Throws `ManualEntryError` with context on bad input.
 */
export function makeManualImport(
  input: ManualTxnInput,
  id: string,
  importedAtIso: string
): ImportRecord {
  if (id.trim() === '') throw new ManualEntryError('manual entry: id must be non-empty');
  if (!isValidIsoDate(input.posted_date)) {
    throw new ManualEntryError(
      `manual entry: posted_date must be a real ISO YYYY-MM-DD date (got "${input.posted_date}")`
    );
  }
  const description = input.description.trim();
  if (description === '') {
    throw new ManualEntryError('manual entry: description must be non-empty');
  }
  if (typeof input.amount_minor !== 'bigint') {
    throw new ManualEntryError('manual entry: amount_minor must be a bigint (integer cents)');
  }
  if (input.amount_minor === 0n) {
    throw new ManualEntryError('manual entry: amount must be non-zero');
  }
  const currency = (input.currency ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ManualEntryError(`manual entry: currency must be ISO 4217 (got "${input.currency}")`);
  }
  const nickname = (input.account_nickname ?? CASH_BANK_NAME).trim() || CASH_BANK_NAME;
  const type: TransactionType =
    input.transaction_type ?? (input.amount_minor < 0n ? 'purchase' : 'deposit');

  const transaction: ParsedTransaction = {
    posted_date: input.posted_date,
    description,
    raw_text: `Manual entry: ${description}`,
    amount_minor: input.amount_minor,
    currency,
    transaction_type: type,
    status: 'posted'
  };

  const statement: ParsedStatement = {
    account_type: 'cash',
    account_last_4: null,
    period_start: input.posted_date,
    period_end: input.posted_date,
    currency,
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: 1,
    summary_lines: [],
    payment_due_date: null,
    statement_date: input.posted_date,
    minimum_payment_due_minor: null,
    // No real reconciliation data exists for a hand-entered row. The store schema
    // requires a non-empty array; 'D' (count) is the honest minimum. The checksum
    // GATE never runs on manual entries — they bypass the PDF import orchestrator.
    parser_provides: ['D']
  };

  return {
    bank_name: nickname,
    adapter_name: MANUAL_ADAPTER_NAME,
    adapter_version: MANUAL_ADAPTER_VERSION,
    pdf_source_hash: manualSourceHash(id),
    imported_at: importedAtIso,
    statement,
    transactions: [transaction],
    checksum_strategy_used: 'manual-entry (no checksum)'
  };
}
