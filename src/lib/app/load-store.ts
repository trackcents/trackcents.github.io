// Helper used by every route that needs to render imported statements.
// Reads the OPFS JSON store and adapts each ImportRecord to the in-memory
// ImportSuccess shape the UI components expect.
//
// Why this exists: routes can't share component state across navigation, so
// each route re-reads from the OPFS store on mount.  Centralizing the read +
// adapt step here keeps the routes thin and makes a future swap to wa-sqlite
// (task #49) a one-file change.

import { loadState, type ImportRecord } from '../db/store';
import type { ImportSuccess } from './import';

/**
 * Adapt a persisted ImportRecord (the store's row shape) to ImportSuccess
 * (the shape the UI components and reconciliation matcher consume).
 *
 * The store doesn't persist the per-checksum-level results array (only the
 * strategy used) so we synthesize an empty `level_results` here.  No
 * downstream component renders per-level diagnostics for already-saved
 * imports — that detail is only shown for the in-flight import.
 */
export function recordToSuccess(r: ImportRecord): ImportSuccess {
  return {
    ok: true,
    adapter_name: r.adapter_name,
    adapter_version: r.adapter_version,
    bank_name: r.bank_name,
    pdf_source_hash: r.pdf_source_hash,
    statement: r.statement,
    transactions: r.transactions,
    checksum: {
      ok: true,
      strategy_used: r.checksum_strategy_used,
      level_results: []
    }
  };
}

export interface LoadedImports {
  imports: ImportSuccess[];
}

/** Hydrate all persisted imports as ImportSuccess[] ready for the UI. */
export async function loadImports(): Promise<LoadedImports> {
  const state = await loadState();
  return { imports: state.imports.map(recordToSuccess) };
}
