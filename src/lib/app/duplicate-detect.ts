/**
 * Detect MANUAL transactions that look entered twice (Pushpa: "after sync every
 * transaction came 2 times, including salary and expenses").
 *
 * Root cause this addresses: a manual entry's `pdf_source_hash` is `manual-<random
 * id>`, so the SAME logical entry created on two devices gets two different hashes.
 * Cross-device sync (union-by-hash) then correctly keeps BOTH — it cannot safely
 * guess they're the same (two genuine ₹30 snacks must NOT be auto-merged). So we
 * never auto-delete; we only SURFACE likely duplicates and let the user delete the
 * extras themselves (via the row's existing Delete). PDF/statement imports are
 * excluded — those dedup correctly by content hash and must never be touched here.
 *
 * Two manual rows are "the same" when their posted_date, signed amount, account,
 * and time-stripped description (case-insensitive) all match.
 */
import type { UnifiedRow } from './transaction-view';
import { splitLeadingTime } from './transaction-view';
import { MANUAL_ADAPTER_NAME } from './manual-entry';

export interface DuplicateGroup {
  /** The shared content signature (opaque; stable for `{#each}` keys). */
  signature: string;
  /** Every manual row sharing that signature (length ≥ 2). Input order preserved
   *  so the UI can keep the first and offer to delete the rest. */
  rows: UnifiedRow[];
}

function signatureOf(r: UnifiedRow): string {
  const desc = splitLeadingTime(r.description).rest.trim().toLowerCase();
  return `${r.posted_date}|${r.amount_minor}|${r.bank_name.trim().toLowerCase()}|${desc}`;
}

/**
 * Group manually-entered rows that share an identical content signature, returning
 * only the groups with more than one member (the likely duplicates). Pure; input
 * order within each group is preserved. Statement imports are ignored.
 */
export function findManualDuplicates(rows: readonly UnifiedRow[]): DuplicateGroup[] {
  const groups = new Map<string, UnifiedRow[]>();
  for (const r of rows) {
    if (r.adapter_name !== MANUAL_ADAPTER_NAME) continue;
    const sig = signatureOf(r);
    const arr = groups.get(sig);
    if (arr === undefined) groups.set(sig, [r]);
    else arr.push(r);
  }
  const out: DuplicateGroup[] = [];
  for (const [signature, groupRows] of groups) {
    if (groupRows.length > 1) out.push({ signature, rows: groupRows });
  }
  return out;
}

/** Total number of EXTRA rows across all duplicate groups (everything beyond the
 *  one kept per group) — drives the summary count in the review card. */
export function duplicateExtraCount(groups: readonly DuplicateGroup[]): number {
  return groups.reduce((n, g) => n + (g.rows.length - 1), 0);
}
