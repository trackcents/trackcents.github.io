// Runtime invariant guards for the OPFS-JSON store (UVM assertion-equivalent).
//
// TypeScript's `exactOptionalPropertyTypes` plus `strict` mode catches a lot
// at compile time, but NOTHING at runtime — a corrupted JSON blob on disk,
// a bug in serializeState, or a downgraded build could put a JavaScript
// `number` where the type says `bigint`.  Constitution Principle II says
// money is integer cents only, never a float.  We assert that at the
// PERSISTENCE BOUNDARY so corruption can't propagate.
//
// Zod 4.4.3 is used because it's 2 KB gzipped, has zero deps, and supports
// bigint natively.  Validation runs ONCE at load/save — no per-call cost.

import { z } from 'zod';

// ── Reusable primitives ─────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO YYYY-MM-DD');

const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z?$/, 'must be ISO 8601 UTC');

const moneyMinor = z.bigint({
  message: 'money values must be bigint integer cents per Constitution Principle II'
});
const moneyMinorOrNull = z.union([moneyMinor, z.null()]);

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'must be ISO 4217 (e.g., USD)');

const transactionType = z.enum([
  'purchase',
  'refund',
  'transfer',
  'fee',
  'interest',
  'payment_to_card',
  'deposit',
  'withdrawal',
  'other'
]);

const accountType = z.enum(['checking', 'savings', 'credit_card', 'loan', 'cash', 'other']);

const transactionStatus = z.enum(['pending', 'posted', 'disputed', 'reversed']);

const checksumLevel = z.enum(['A', 'B', 'C', 'D']);

// ── Composite schemas ──────────────────────────────────────────────────────

const summaryLineSchema = z.object({
  label: z.string().min(1),
  amount_minor: moneyMinor
});

const parsedTransactionSchema = z.object({
  posted_date: isoDate,
  description: z.string(),
  raw_text: z.string(),
  amount_minor: moneyMinor,
  currency: currencyCode,
  transaction_type: transactionType,
  status: transactionStatus.optional()
});

const parsedStatementSchema = z.object({
  account_type: accountType,
  account_last_4: z.union([z.string().regex(/^\d{3,5}$/), z.null()]),
  period_start: isoDate,
  period_end: isoDate,
  currency: currencyCode,
  opening_balance_minor: moneyMinorOrNull,
  closing_balance_minor: moneyMinorOrNull,
  total_debits_minor: moneyMinorOrNull,
  total_credits_minor: moneyMinorOrNull,
  previous_balance_minor: moneyMinorOrNull,
  statement_balance_minor: moneyMinorOrNull,
  printed_transaction_count: z.union([z.number().int().nonnegative(), z.null()]),
  summary_lines: z.array(summaryLineSchema),
  payment_due_date: z.union([isoDate, z.null()]),
  statement_date: z.union([isoDate, z.null()]),
  minimum_payment_due_minor: moneyMinorOrNull,
  parser_provides: z.array(checksumLevel).min(1)
});

const importRecordSchema = z.object({
  bank_name: z.string().min(1),
  adapter_name: z.string().min(1),
  adapter_version: z.string().min(1),
  // Production hashes are 64-char SHA-256 hex.  Synthetic fixtures use
  // short identifiers like "h-a"; we accept any non-empty string rather
  // than impose a synthetic-incompatible minimum length.  The cryptographic
  // assumption is enforced at WRITE time (pdfSourceHash) not at READ time.
  pdf_source_hash: z.string().min(1),
  imported_at: isoTimestamp,
  statement: parsedStatementSchema,
  transactions: z.array(parsedTransactionSchema),
  checksum_strategy_used: z.string().min(1)
});

const reconciliationLinkSchema = z.object({
  bank_import_index: z.number().int().nonnegative(),
  bank_transaction_index: z.number().int().nonnegative(),
  cc_import_index: z.number().int().nonnegative(),
  cc_transaction_index: z.union([z.number().int().nonnegative(), z.null()]),
  link_type: z.enum(['auto', 'manual']),
  confidence_score: z.number().min(0).max(1),
  matched_amount_minor: moneyMinor,
  matched_date: isoDate
});

/**
 * The top-level schema for everything persisted to OPFS / localStorage.
 * Validated at every load (deserializeState) and every save (serializeState).
 */
export const persistedStateSchema = z.object({
  version: z.number().int().nonnegative(),
  imports: z.array(importRecordSchema),
  reconciliation_links: z.array(reconciliationLinkSchema)
});

/**
 * Validate a parsed-JSON object as a PersistedState.  Throws a verbose
 * ZodError with the exact failing path on invalid input.  Returns the
 * input cast to its inferred type on success.
 */
export function validatePersistedState(raw: unknown): z.infer<typeof persistedStateSchema> {
  return persistedStateSchema.parse(raw);
}

/**
 * Returns null if the input is valid; otherwise a list of human-readable
 * messages.  Used by the boundary code that needs to LOG the failure
 * before deciding what to do with the corrupt data (e.g., quarantine the
 * blob and start fresh).
 */
export function diagnosePersistedState(raw: unknown): string[] | null {
  const result = persistedStateSchema.safeParse(raw);
  if (result.success) return null;
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}
