// Unified-transactions service for the /transactions route (US-P1-E).
//
// Takes the in-memory ImportSuccess[] from the OPFS store and:
//   1. Flattens every transaction into a single chronological list with
//      provenance fields populated (bank name, account type, account last_4,
//      pdf hash, etc.) so the UI can render account context per row.
//   2. Exposes pure-function filter + sort utilities the route composes.
//
// Search/filter happens in-memory.  With our current dataset (<1000 txns)
// this is instant.  When wa-sqlite + FTS5 land (task #49) this module's
// surface should be ported to SQL queries — the function signatures here
// are designed to be a drop-in replacement target.

import type { ImportSuccess } from './import';
import type { AccountType, TransactionType } from '../adapters/types';

/**
 * One row in the unified transactions view, carrying ALL fields the UI needs
 * to render account context without re-joining against the imports array.
 */
export interface UnifiedRow {
  // Provenance — used for filtering, display, and drill-through.
  bank_name: string;
  account_type: AccountType;
  account_last_4: string | null;
  pdf_source_hash: string;
  adapter_name: string;
  adapter_version: string;

  // Transaction fields — flat copies.
  posted_date: string; // ISO YYYY-MM-DD
  description: string;
  amount_minor: bigint;
  currency: string;
  transaction_type: TransactionType;
  raw_text: string;

  // Source coordinates (lets the UI link back to the statement detail page).
  import_index: number;
  transaction_index: number;
}

/**
 * Convert all imports into a flat UnifiedRow[].  Stable order: sorted by
 * (posted_date ASC, then import_index ASC) so two transactions on the same
 * day from different statements have a deterministic relative order.
 */
export function toUnifiedRows(imports: ImportSuccess[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i]!;
    for (let j = 0; j < imp.transactions.length; j++) {
      const t = imp.transactions[j]!;
      rows.push({
        bank_name: imp.bank_name,
        account_type: imp.statement.account_type,
        account_last_4: imp.statement.account_last_4,
        pdf_source_hash: imp.pdf_source_hash,
        adapter_name: imp.adapter_name,
        adapter_version: imp.adapter_version,
        posted_date: t.posted_date,
        description: t.description,
        amount_minor: t.amount_minor,
        currency: t.currency,
        transaction_type: t.transaction_type,
        raw_text: t.raw_text,
        import_index: i,
        transaction_index: j
      });
    }
  }
  rows.sort((a, b) => {
    if (a.posted_date < b.posted_date) return -1;
    if (a.posted_date > b.posted_date) return 1;
    if (a.import_index !== b.import_index) return a.import_index - b.import_index;
    return a.transaction_index - b.transaction_index;
  });
  return rows;
}

/** A stable identifier for one account across imports.  Two statements
 *  with the same (bank, account_last_4) refer to the same account. */
export interface AccountKey {
  bank_name: string;
  account_type: AccountType;
  account_last_4: string | null;
}

export function accountKeyString(k: AccountKey): string {
  return `${k.bank_name}::${k.account_type}::${k.account_last_4 ?? '?'}`;
}

/**
 * Enumerate every distinct account present in the unified rows.  Used by
 * the FilterBar to populate the multi-select.  Sorted alphabetically by
 * bank name for stable UI ordering.
 */
export function listAccounts(rows: UnifiedRow[]): AccountKey[] {
  const seen = new Map<string, AccountKey>();
  for (const r of rows) {
    const key: AccountKey = {
      bank_name: r.bank_name,
      account_type: r.account_type,
      account_last_4: r.account_last_4
    };
    seen.set(accountKeyString(key), key);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.bank_name !== b.bank_name) return a.bank_name.localeCompare(b.bank_name);
    if (a.account_type !== b.account_type) return a.account_type.localeCompare(b.account_type);
    return (a.account_last_4 ?? '').localeCompare(b.account_last_4 ?? '');
  });
}

/**
 * Filter state.  All fields are optional — undefined / null / empty means
 * "no constraint on this dimension."  Conjunctive (AND) across dimensions.
 *
 * Each field's type is explicitly `T | undefined` (not just `T?`) because
 * the FilterBar component resets fields by setting them to undefined.  With
 * tsconfig.json's `exactOptionalPropertyTypes: true`, the bare `?` modifier
 * would reject `{ amount_min: undefined }`.
 */
export interface TransactionFilter {
  /** If non-empty, only rows whose (bank, account_type, last_4) is in the set. */
  account_keys?: string[] | undefined;
  /** ISO YYYY-MM-DD inclusive lower bound.  Empty/undefined → no lower bound. */
  date_from?: string | undefined;
  /** ISO YYYY-MM-DD inclusive upper bound.  Empty/undefined → no upper bound. */
  date_to?: string | undefined;
  /** Absolute-amount lower bound in dollars (the UI presents these in
   *  dollars; we convert to cents internally).  E.g., 10 means "show only
   *  transactions whose abs(amount) ≥ $10". */
  amount_min?: number | undefined;
  /** Absolute-amount upper bound in dollars. */
  amount_max?: number | undefined;
  /** Free-text search across description (case-insensitive substring).
   *  Multiple whitespace-separated tokens are AND'd. */
  search?: string | undefined;
  /** If non-empty, only rows whose transaction_type is in the set. */
  types?: TransactionType[] | undefined;
}

function absMinor(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/**
 * Apply a filter to a row set.  Pure function — does not mutate input.
 * Performance: O(N × tokens).  For N < 10,000 this is sub-millisecond on
 * modern hardware.  When N grows, port to SQL with FTS5 (deferred).
 */
export function applyFilter(rows: UnifiedRow[], filter: TransactionFilter): UnifiedRow[] {
  const fromMinor =
    filter.amount_min !== undefined ? BigInt(Math.round(filter.amount_min * 100)) : null;
  const toMinor =
    filter.amount_max !== undefined ? BigInt(Math.round(filter.amount_max * 100)) : null;
  const typesSet = filter.types && filter.types.length > 0 ? new Set(filter.types) : null;
  const accountsSet =
    filter.account_keys && filter.account_keys.length > 0 ? new Set(filter.account_keys) : null;

  // Pre-tokenize search.  Empty / whitespace-only search means no filter.
  const searchTokens =
    filter.search && filter.search.trim().length > 0
      ? filter.search
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0)
      : null;

  return rows.filter((r) => {
    if (accountsSet !== null) {
      const k = accountKeyString({
        bank_name: r.bank_name,
        account_type: r.account_type,
        account_last_4: r.account_last_4
      });
      if (!accountsSet.has(k)) return false;
    }
    if (filter.date_from && r.posted_date < filter.date_from) return false;
    if (filter.date_to && r.posted_date > filter.date_to) return false;
    if (fromMinor !== null && absMinor(r.amount_minor) < fromMinor) return false;
    if (toMinor !== null && absMinor(r.amount_minor) > toMinor) return false;
    if (typesSet !== null && !typesSet.has(r.transaction_type)) return false;
    if (searchTokens !== null) {
      const haystack = r.description.toLowerCase();
      for (const tok of searchTokens) {
        if (!haystack.includes(tok)) return false;
      }
    }
    return true;
  });
}

/** Sortable columns. */
export type SortKey = 'date' | 'description' | 'amount' | 'account' | 'type';

/** Sort direction. */
export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

/**
 * Sort rows by the given spec.  Stable — equal-keyed rows preserve relative
 * order via the toUnifiedRows base sort (date + import_index + txn_index).
 * Pure function — does not mutate input.
 */
export function sortRows(rows: UnifiedRow[], spec: SortSpec): UnifiedRow[] {
  const sign = spec.dir === 'asc' ? 1 : -1;
  const out = [...rows];
  out.sort((a, b) => {
    switch (spec.key) {
      case 'date':
        return sign * a.posted_date.localeCompare(b.posted_date);
      case 'description':
        return sign * a.description.toLowerCase().localeCompare(b.description.toLowerCase());
      case 'amount': {
        // Sort by signed amount (so big positives are at the top in desc).
        if (a.amount_minor === b.amount_minor) return 0;
        return sign * (a.amount_minor < b.amount_minor ? -1 : 1);
      }
      case 'account': {
        const ka = `${a.bank_name}::${a.account_last_4 ?? ''}`;
        const kb = `${b.bank_name}::${b.account_last_4 ?? ''}`;
        return sign * ka.localeCompare(kb);
      }
      case 'type':
        return sign * a.transaction_type.localeCompare(b.transaction_type);
    }
  });
  return out;
}
