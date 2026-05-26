/**
 * Persistence for the categorization layer (US-P2-A), kept SEPARATE from the
 * synced vault (PersistedState) so it does not touch the IV&V-signed-off sync
 * merge. Encrypted at rest with the same session key as the main store
 * (Principle I) by reusing store-crypto's encode/decode.
 *
 * v1 limitation (documented): categorization is LOCAL-ONLY — it does not yet sync
 * across devices. Folding these fields into the synced blob (and re-running the
 * sync IV&V on the extended merge) is a deliberate later increment (task #79).
 */
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';
import type { Category, CategoryRule, TransactionAnnotation } from '../app/categorization';

const LS_KEY = 'mtrb.categorization';

export interface CategorizationState {
  categories: Category[];
  rules: CategoryRule[];
  /** Keyed by the stable transaction key `<pdf_source_hash>#<txIndex>`. */
  annotations: Record<string, TransactionAnnotation>;
}

function empty(): CategorizationState {
  return { categories: [], rules: [], annotations: {} };
}

/** Load the categorization state; returns empty if absent, unparseable, or locked. */
export async function loadCategorization(): Promise<CategorizationState> {
  if (typeof localStorage === 'undefined') return empty();
  const stored = localStorage.getItem(LS_KEY);
  if (stored === null) return empty();
  const decoded = await decodeStateFromStorage(stored);
  if (decoded.kind === 'locked') return empty();
  try {
    const parsed = JSON.parse(decoded.json) as Partial<CategorizationState>;
    return {
      categories: parsed.categories ?? [],
      rules: parsed.rules ?? [],
      annotations: parsed.annotations ?? {}
    };
  } catch {
    return empty();
  }
}

/** Persist the categorization state, encrypted at rest when a session key is loaded. */
export async function saveCategorization(state: CategorizationState): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(state)));
}
