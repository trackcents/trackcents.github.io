/**
 * Persistence for per-category monthly budget limits (US-P4-A), kept SEPARATE
 * from the categorization store and the synced vault (DECISIONS D14) so it does
 * not touch the IV&V-signed-off merge/backup schemas. Encrypted at rest with the
 * session key by reusing store-crypto. Local-only for now (cross-device sync of
 * budgets folds into the future synced-blob task, like categorization #79).
 *
 * Limits are bigint cents (constitution II), serialized as decimal strings.
 */
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';

const LS_KEY = 'mtrb.budgets';

/** category_id → monthly limit in cents (positive). */
export type CategoryLimits = Record<string, bigint>;

/** Load saved limits; empty if absent, unparseable, or locked. */
export async function loadBudgets(): Promise<CategoryLimits> {
  if (typeof localStorage === 'undefined') return {};
  const stored = localStorage.getItem(LS_KEY);
  if (stored === null) return {};
  const decoded = await decodeStateFromStorage(stored);
  if (decoded.kind === 'locked') return {};
  try {
    const parsed = JSON.parse(decoded.json) as Record<string, string>;
    const out: CategoryLimits = {};
    for (const [k, v] of Object.entries(parsed)) {
      try {
        out[k] = BigInt(v);
      } catch {
        // skip a corrupt entry rather than failing the whole load
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist limits, encrypted at rest when a session key is loaded. */
export async function saveBudgets(limits: CategoryLimits): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(limits)) obj[k] = v.toString();
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(obj)));
}
