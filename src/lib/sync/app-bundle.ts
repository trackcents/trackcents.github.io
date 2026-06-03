/**
 * Cross-device sync BUNDLE (task #79).
 *
 * Until now sync carried only the main vault (`db/store` — imported statements +
 * transactions). The user's CATEGORIES, paycheck/income setup, splits, BILLS &
 * SUBSCRIPTIONS, budgets and savings goals live in separate localStorage stores
 * that sync never touched, so a second device saw the raw statements but none of
 * that — "5 transactions need a category", "we found 7 paychecks", "found in your
 * statements — Add all 8". This module folds ALL of those stores into one synced
 * payload so every device sees the same picture.
 *
 * Merge model — additive, never destructive:
 *   - main vault: union imports by `pdf_source_hash` (the existing `mergeState`).
 *   - id-keyed collections (categories, rules, pockets, recurring items/sections,
 *     goals): union by `id`; on an id collision the REMOTE value wins.
 *   - string-keyed maps (annotations, budgets): shallow union; remote wins.
 *   - the paycheck anchor (a single {year,month}): remote wins when present.
 * Union never deletes, so no device's additions are ever lost. The only lossy
 * case is a genuine CONCURRENT edit of the SAME id/key on two devices since their
 * last sync, resolved last-(remote)-writer-wins — acceptable for a small family
 * app, and far better than the previous "side stores never sync at all".
 *
 * Bigint safety: the side stores are merged as PLAIN parsed JSON — their
 * `{ "$bigint": "<decimal>" }` sentinels and decimal-string amounts ride along as
 * opaque values — so no bigint revive/replace happens here and the re-stringified
 * value is byte-identical to what each store itself writes. The main vault is
 * round-tripped through the store's own `serializeState`/`deserializeState`.
 */
import {
  loadState,
  saveState,
  serializeState,
  deserializeState,
  type PersistedState
} from '../db/store';
import { mergeState } from './merge';

export const SYNC_BUNDLE_SCHEMA = 'mtrb-sync-bundle/1';

/**
 * Side stores (all localStorage JSON) that must travel with the vault. NOTE the
 * deliberate exclusions: `mtrb.device`, `mtrb.sync.*`, `mtrb.budget.anchor`'s
 * sibling per-device flags and `mtrb.onboarded` are PER-DEVICE and are NOT synced.
 */
const SIDE_STORE_KEYS = [
  'mtrb.categorization',
  'mtrb.recurring',
  'mtrb.budgets',
  'mtrb.goals',
  'mtrb.budget.anchor'
] as const;
type SideKey = (typeof SIDE_STORE_KEYS)[number];

interface SyncBundle {
  schema: typeof SYNC_BUNDLE_SCHEMA;
  /** `serializeState(...)` output — main-vault JSON with bigint sentinels. */
  main: string;
  /** Parsed JSON per side store; a key is omitted when that store is absent. */
  stores: Partial<Record<SideKey, unknown>>;
}

function lsGet(key: string): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
}
function lsSet(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
}

/**
 * Build the canonical bundle JSON string — used both as the push payload and as
 * the input to the push fingerprint, so a change in ANY store (not just the
 * vault) now triggers a push. Deterministic for unchanged data.
 */
export async function buildBundleString(): Promise<string> {
  const stores: Partial<Record<SideKey, unknown>> = {};
  for (const key of SIDE_STORE_KEYS) {
    const raw = lsGet(key);
    if (raw === null) continue;
    try {
      stores[key] = JSON.parse(raw); // plain parse — keep {$bigint} sentinels opaque
    } catch {
      /* skip a corrupt store rather than poison the whole bundle */
    }
  }
  const bundle: SyncBundle = {
    schema: SYNC_BUNDLE_SCHEMA,
    main: serializeState(await loadState()),
    stores
  };
  return JSON.stringify(bundle);
}

function isBundle(v: unknown): v is SyncBundle {
  return (
    typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === SYNC_BUNDLE_SCHEMA
  );
}

function asObject(v: unknown): Record<string, unknown> {
  return (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
}

/** Union an id-keyed array; remote wins on an id collision, local order kept. */
function unionById(local: unknown, remote: unknown): unknown[] {
  const byId = new Map<unknown, unknown>();
  for (const x of Array.isArray(local) ? local : []) byId.set((x as { id?: unknown })?.id, x);
  for (const x of Array.isArray(remote) ? remote : []) byId.set((x as { id?: unknown })?.id, x);
  return [...byId.values()];
}

/** Shallow union of a string-keyed map; remote wins on a key collision. */
function unionMap(local: unknown, remote: unknown): Record<string, unknown> {
  return { ...asObject(local), ...asObject(remote) };
}

function mergeCategorization(local: unknown, remote: unknown): unknown {
  const l = asObject(local);
  const r = asObject(remote);
  const out: Record<string, unknown> = {
    categories: unionById(l.categories, r.categories),
    rules: unionById(l.rules, r.rules),
    annotations: unionMap(l.annotations, r.annotations)
  };
  // Only carry pockets when a side actually has them, so the store's
  // DEFAULT_POCKETS fallback still applies when neither device set any.
  const lp = l.pockets;
  const rp = r.pockets;
  if ((Array.isArray(lp) && lp.length > 0) || (Array.isArray(rp) && rp.length > 0)) {
    out.pockets = unionById(lp, rp);
  }
  return out;
}

function mergeRecurring(local: unknown, remote: unknown): unknown {
  const l = asObject(local);
  const r = asObject(remote);
  return { items: unionById(l.items, r.items), sections: unionById(l.sections, r.sections) };
}

/** Merge one side store's remote value into local. Returns the JSON to persist,
 *  or null when there's nothing from the remote to apply (keep local untouched). */
function mergeSideStore(key: SideKey, localRaw: string | null, remoteVal: unknown): string | null {
  if (remoteVal === undefined) return null; // remote doesn't carry this store
  let local: unknown = null;
  if (localRaw !== null) {
    try {
      local = JSON.parse(localRaw);
    } catch {
      local = null;
    }
  }
  let merged: unknown;
  switch (key) {
    case 'mtrb.categorization':
      merged = mergeCategorization(local, remoteVal);
      break;
    case 'mtrb.recurring':
      merged = mergeRecurring(local, remoteVal);
      break;
    case 'mtrb.goals':
      merged = unionById(local, remoteVal); // array of { id, ... }
      break;
    case 'mtrb.budgets':
      merged = unionMap(local, remoteVal); // { category_id: "<cents>" }
      break;
    case 'mtrb.budget.anchor':
      merged = remoteVal ?? local; // scalar { year, month }
      break;
    default:
      merged = local;
  }
  return JSON.stringify(merged);
}

/**
 * Apply a decoded remote payload to local state (union merge), persisting both
 * the main vault and every side store. Returns whether it was a multi-store
 * bundle; a legacy main-only blob (older app / pre-#79 Drive file) still unions
 * the vault so no import is lost.
 */
export async function applyRemotePayload(payloadJson: string): Promise<{ bundle: boolean }> {
  const parsed: unknown = JSON.parse(payloadJson);

  if (!isBundle(parsed)) {
    // Legacy: the whole payload IS the main PersistedState.
    const remoteMain: PersistedState = deserializeState(payloadJson);
    await saveState(mergeState(await loadState(), remoteMain));
    return { bundle: false };
  }

  // 1. Main vault — union imports (re-uses the IV&V-signed merge).
  const remoteMain: PersistedState = deserializeState(parsed.main);
  await saveState(mergeState(await loadState(), remoteMain));

  // 2. Side stores — union each into localStorage.
  for (const key of SIDE_STORE_KEYS) {
    const merged = mergeSideStore(key, lsGet(key), parsed.stores?.[key]);
    if (merged !== null) lsSet(key, merged);
  }
  return { bundle: true };
}
