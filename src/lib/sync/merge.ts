/**
 * State merge for sync (the OneNote/Simplenote model): a pull UNIONS the remote
 * into the local state rather than replacing it, so no import from either device
 * is ever lost (US-P2-C; resolves IV&V finding A1 — the old "replace" pull could
 * wipe an unsynced local import). The cloud accumulates the superset.
 *
 * Why union-by-hash is safe: an `ImportRecord` is uniquely identified by its
 * `pdf_source_hash`. PDF imports are append-only. MANUAL entries, however, are now
 * EDITABLE (the quick-add "Edit" reopens and rewrites a manual entry IN PLACE,
 * keeping its `manual-<id>` hash) — so the same hash can carry different content on
 * two devices. To avoid a cross-device edit being silently reverted, an exact-hash
 * collision keeps the record written most recently (newer `imported_at`), not a
 * blind first-writer-wins. When timestamps are equal/absent it falls back to
 * a-first, so dedup stays deterministic + idempotent and pure PDF imports are
 * unaffected. Union therefore still loses nothing and needs no user intervention.
 *
 * Subtlety: `ReconciliationLink` references imports by ARRAY INDEX. After the
 * imports arrays are unioned (and reordered), every link is re-indexed to point
 * at the merged imports array via the import's stable `pdf_source_hash`. A link
 * whose endpoints aren't both present after the merge is dropped (it dangles).
 */
import type { PersistedState, ImportRecord } from '../db/store';
import { STORE_VERSION } from '../db/store';
import type { ReconciliationLink } from '../app/reconciliation';

function linkKey(l: ReconciliationLink): string {
  return `${l.bank_import_index}:${l.bank_transaction_index}:${l.cc_import_index}:${l.cc_transaction_index}`;
}

/**
 * Union two persisted states. Deterministic in `a`-then-`b` order: `a`'s imports
 * keep their positions; `b`'s imports with a new `pdf_source_hash` are appended.
 * Idempotent (`merge(s, s)` ≡ `s`) and set-commutative (`merge(a, b)` and
 * `merge(b, a)` hold the same imports and links, possibly in a different order).
 */
/** True when `next` was written strictly later than `cur` (ISO timestamps sort
 *  lexicographically). Missing timestamps compare as '' → never newer, so the
 *  first-seen record wins (the historical a-first behaviour for PDF imports and
 *  the bare test stand-ins that carry no `imported_at`). */
function isNewerImport(next: ImportRecord, cur: ImportRecord): boolean {
  return (next.imported_at ?? '') > (cur.imported_at ?? '');
}

export function mergeState(a: PersistedState, b: PersistedState): PersistedState {
  // 1. Merged imports: dedup union by pdf_source_hash, a-first then new-from-b.
  //    On a hash collision (a manual entry edited on another device) keep the
  //    record with the newer imported_at, in place — so an edit propagates rather
  //    than being reverted, while position + idempotency are preserved.
  const mergedImports: ImportRecord[] = [];
  const newIndexByHash = new Map<string, number>();
  for (const imp of [...a.imports, ...b.imports]) {
    const at = newIndexByHash.get(imp.pdf_source_hash);
    if (at === undefined) {
      newIndexByHash.set(imp.pdf_source_hash, mergedImports.length);
      mergedImports.push(imp);
    } else if (isNewerImport(imp, mergedImports[at]!)) {
      mergedImports[at] = imp;
    }
  }

  // 2. Re-index a link from its source state's import order to the merged order.
  //    Transaction indices are unchanged — an import's own transactions array is
  //    carried over intact. Returns null if either endpoint no longer resolves.
  function reindex(link: ReconciliationLink, source: PersistedState): ReconciliationLink | null {
    const bankHash = source.imports[link.bank_import_index]?.pdf_source_hash;
    const ccHash = source.imports[link.cc_import_index]?.pdf_source_hash;
    if (bankHash === undefined || ccHash === undefined) return null;
    const newBank = newIndexByHash.get(bankHash);
    const newCc = newIndexByHash.get(ccHash);
    if (newBank === undefined || newCc === undefined) return null;
    return { ...link, bank_import_index: newBank, cc_import_index: newCc };
  }

  // 3. Union the re-indexed links, deduped by their full positional key
  //    (first writer wins on an exact-key collision — deterministic, a before b).
  const mergedLinks: ReconciliationLink[] = [];
  const seen = new Set<string>();
  for (const [links, source] of [
    [a.reconciliation_links, a],
    [b.reconciliation_links, b]
  ] as const) {
    for (const link of links) {
      const r = reindex(link, source);
      if (r === null) continue;
      const key = linkKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      mergedLinks.push(r);
    }
  }

  return {
    version: Math.max(a.version || STORE_VERSION, b.version || STORE_VERSION, STORE_VERSION),
    imports: mergedImports,
    reconciliation_links: mergedLinks
  };
}
