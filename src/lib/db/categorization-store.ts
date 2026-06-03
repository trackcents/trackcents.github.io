/**
 * Persistence for the categorization layer (US-P2-A), kept SEPARATE from the
 * synced vault (PersistedState) so it does not touch the IV&V-signed-off sync
 * merge. Stored as plaintext JSON via store-crypto's encode/decode (the
 * passphrase/encryption layer was removed at the user's request — see amended
 * Constitution Principle I).
 *
 * Cross-device sync (task #79, DONE): this store is now folded into the synced
 * blob by `sync/app-bundle.ts` — its categories, rules, annotations and pockets
 * union-merge across devices alongside the main vault. It still lives in its own
 * localStorage key (separate from the IV&V-signed PersistedState merge); the
 * bundle merges it as opaque JSON, so this file's read/write path is unchanged.
 */
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';
import type { Category, CategoryRule, TransactionAnnotation } from '../app/categorization';
import { DEFAULT_POCKETS, type Pocket } from '../app/pockets';

const LS_KEY = 'mtrb.categorization';

export interface CategorizationState {
  categories: Category[];
  rules: CategoryRule[];
  /** Keyed by the stable transaction key `<pdf_source_hash>#<txIndex>`. */
  annotations: Record<string, TransactionAnnotation>;
  /**
   * Income pockets (spec 002-income-pockets §2). `loadCategorization` always
   * populates this (defaulting to the two built-ins 💵 Paychecks / 🎁 Extra for any
   * state saved before this field existed). Optional on the type so the many
   * literal `{ categories, rules, annotations }` initialisers across the routes do
   * not all have to change; treat an absent value as `DEFAULT_POCKETS`.
   */
  pockets?: Pocket[];
}

function empty(): CategorizationState {
  return { categories: [], rules: [], annotations: {}, pockets: [...DEFAULT_POCKETS] };
}

/**
 * Bigint-safe JSON for the categorization blob. `TransactionSplit.amount_minor`
 * is a bigint (signed cents); a plain `JSON.stringify` THROWS on it, so before
 * this fix saving any split crashed silently. We round-trip bigints through a
 * tagged sentinel `{ "$bigint": "<decimal>" }`. Generic (handles any bigint),
 * and a no-op for the common split-free state, so existing data loads unchanged.
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { $bigint: value.toString() } : value;
}
function bigintReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    '$bigint' in value &&
    typeof (value as { $bigint: unknown }).$bigint === 'string'
  ) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

/** Load the categorization state; returns empty if absent, unparseable, or locked. */
export async function loadCategorization(): Promise<CategorizationState> {
  if (typeof localStorage === 'undefined') return empty();
  const stored = localStorage.getItem(LS_KEY);
  if (stored === null) return empty();
  const decoded = await decodeStateFromStorage(stored);
  if (decoded.kind === 'locked') return empty();
  try {
    const parsed = JSON.parse(decoded.json, bigintReviver) as Partial<CategorizationState>;
    return {
      categories: parsed.categories ?? [],
      rules: parsed.rules ?? [],
      annotations: parsed.annotations ?? {},
      pockets:
        parsed.pockets !== undefined && parsed.pockets.length > 0
          ? parsed.pockets
          : [...DEFAULT_POCKETS]
    };
  } catch {
    return empty();
  }
}

/** Persist the categorization state, encrypted at rest when a session key is loaded. */
export async function saveCategorization(state: CategorizationState): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  // Preserve the pocket list when the caller rebuilt state without it. Many call
  // sites still pass only `{ categories, rules, annotations }`; without this, each
  // such save would drop `pockets` and the user's boxes would reset on next load.
  let pockets = state.pockets;
  if (pockets === undefined) {
    pockets = (await loadCategorization()).pockets ?? [...DEFAULT_POCKETS];
  }
  const toSave: CategorizationState = { ...state, pockets };
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(toSave, bigintReplacer)));
}
