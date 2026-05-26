// Phase 1A persistence — single-blob OPFS JSON store.
//
// CONSTITUTIONAL DEVIATION (deliberate, documented):
// Principle XIV names wa-sqlite + OPFS VFS as the local DB.  That setup
// requires a custom WASM VFS, careful Vite asset bundling, and worker
// orchestration — substantial implementation work that doesn't add user value
// until we need SQL-level queries (FTS5 search arrives in Phase 7 / US-P1-E).
//
// For Phase 1A we persist the full app state as a single JSON blob:
//   - On modern browsers: OPFS file `money-tracker.json` via the Origin
//     Private File System API.
//   - On older browsers (no OPFS): localStorage key `money-tracker:state`.
//
// Phase 1B (separate task, when FTS5 / large datasets are exercised):
// migrate the same data to wa-sqlite over the schema in
// `src/lib/db/schema.sql`.  Migration is one-way: read the JSON blob, run
// INSERTs, then unlink the JSON.  Code paths in this file have stable names
// (`load()`, `save()`, etc.) so callers don't need to change.
//
// User-facing behavior we get from this layer:
//   - Drops survive page reload.
//   - Idempotency: same PDF (same SHA-256 hash) is rejected at the orchestrator.
//   - Multi-month history accrues so the paycheck-window feature (#47) and
//     categorization (#48) have something to attach to.

import type { ParsedStatement, ParsedTransaction } from '../adapters/types';
import type { ReconciliationLink } from '../app/reconciliation';
import { diagnosePersistedState } from './schema';
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';

// ── Persisted shape ────────────────────────────────────────────────────────
// Each ImportRecord mirrors the in-memory ImportSuccess but doesn't depend on
// the orchestrator's runtime types.  Versioned so future schema changes can
// migrate cleanly.

export const STORE_VERSION = 1;

export interface ImportRecord {
  bank_name: string;
  adapter_name: string;
  adapter_version: string;
  pdf_source_hash: string;
  imported_at: string; // ISO timestamp
  statement: ParsedStatement;
  transactions: ParsedTransaction[];
  checksum_strategy_used: string;
}

export interface PersistedState {
  version: number;
  imports: ImportRecord[];
  reconciliation_links: ReconciliationLink[];
}

const EMPTY_STATE: PersistedState = {
  version: STORE_VERSION,
  imports: [],
  reconciliation_links: []
};

// ── bigint-safe JSON ───────────────────────────────────────────────────────
// JSON.stringify doesn't know about bigint.  We wrap bigints as strings with
// a sentinel prefix and recover them on parse.  This keeps every money value
// (which is bigint cents per Principle II) round-trippable.

const BIGINT_PREFIX = '__bigint__:';

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return `${BIGINT_PREFIX}${value.toString()}`;
  return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_PREFIX)) {
    return BigInt(value.slice(BIGINT_PREFIX.length));
  }
  return value;
}

export function serializeState(state: PersistedState): string {
  return JSON.stringify(state, jsonReplacer);
}

export function deserializeState(text: string): PersistedState {
  const parsed = JSON.parse(text, jsonReviver) as PersistedState;
  if (parsed.version > STORE_VERSION) {
    throw new Error(
      `store: refusing to load state with version ${parsed.version} (this code only understands ${STORE_VERSION}). ` +
        `Newer state was written by a later build; downgrade is unsafe.`
    );
  }
  // Apply forward-compatibility defaults BEFORE invariant validation.
  const normalized = {
    version: parsed.version ?? STORE_VERSION,
    imports: parsed.imports ?? [],
    reconciliation_links: parsed.reconciliation_links ?? []
  };
  // Runtime invariant check — money MUST be bigint, dates MUST be ISO, types
  // MUST be one of the enum.  TypeScript can't enforce these across the JSON
  // boundary; Zod can.  Failure throws a verbose error with the exact path.
  // The check runs once per load; per-tick cost is negligible.
  const issues = diagnosePersistedState(normalized);
  if (issues !== null) {
    throw new Error(
      `store: persisted state failed runtime schema check (${issues.length} issue${
        issues.length === 1 ? '' : 's'
      }):\n  - ` +
        issues.slice(0, 5).join('\n  - ') +
        (issues.length > 5 ? '\n  - …' : '')
    );
  }
  return normalized;
}

// ── Storage backends ───────────────────────────────────────────────────────
// We try OPFS first (better isolation, better quota), then fall back to
// localStorage.  Both are awaitable so callers don't care which one is in use.

const OPFS_FILE_NAME = 'money-tracker.json';
const LS_KEY = 'money-tracker:state';

/**
 * Records which backend the last load/save actually used.  Exposed for the
 * UI's diagnostic banner so the user can see "Storage: OPFS" vs
 * "Storage: localStorage" at a glance.
 */
export type StorageBackend = 'opfs' | 'localStorage' | 'memory';
let lastUsedBackend: StorageBackend = 'memory';
export function getLastUsedBackend(): StorageBackend {
  return lastUsedBackend;
}

let storeLocked = false;
/** True when encrypted data exists on disk but no key is loaded — the user must unlock. */
export function isStoreLocked(): boolean {
  return storeLocked;
}

async function opfsAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage) return false;
  if (typeof navigator.storage.getDirectory !== 'function') return false;
  try {
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

async function loadFromOpfs(): Promise<PersistedState | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_FILE_NAME, { create: false });
    const file = await handle.getFile();
    const text = await file.text();
    if (text.trim() === '') return null;
    const decoded = await decodeStateFromStorage(text);
    if (decoded.kind === 'locked') {
      storeLocked = true;
      return null;
    }
    return deserializeState(decoded.json);
  } catch (err) {
    // NotFoundError on first run is expected; anything else is logged but
    // treated as empty so the user gets a fresh start rather than a crash.
    if (err instanceof Error && err.name === 'NotFoundError') return null;
    console.warn('store: OPFS load failed, treating as empty', err);
    return null;
  }
}

async function saveToOpfs(state: PersistedState): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(OPFS_FILE_NAME, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(await encodeStateForStorage(serializeState(state)));
  } finally {
    await writable.close();
  }
}

async function loadFromLocalStorage(): Promise<PersistedState | null> {
  if (typeof localStorage === 'undefined') return null;
  const text = localStorage.getItem(LS_KEY);
  if (text === null || text.trim() === '') return null;
  try {
    const decoded = await decodeStateFromStorage(text);
    if (decoded.kind === 'locked') {
      storeLocked = true;
      return null;
    }
    return deserializeState(decoded.json);
  } catch (err) {
    console.warn('store: localStorage load failed, treating as empty', err);
    return null;
  }
}

async function saveToLocalStorage(state: PersistedState): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, await encodeStateForStorage(serializeState(state)));
}

// ── Write serialization ────────────────────────────────────────────────────
// Every mutation (addImport / removeImport / setReconciliationLinks /
// clearState) does a load-modify-save sequence.  If two of these run
// concurrently they can clobber each other (both load the same prior state,
// both write back, last writer wins — the loser's modification is silently
// dropped).  The link-autosave race that wiped imports on reload was an
// instance of this.
//
// We serialize all writes through a single promise chain so each mutation
// completes its load-modify-save atomically with respect to the others.
// Reads (loadState by itself) are still concurrent — they only race against
// in-flight writes, which is acceptable since a read just before vs just
// after a write are both valid views.

let writeChain: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the persisted state.  Returns an empty state if nothing was saved yet
 * or if storage isn't available.  Never throws on missing data — only on
 * unrecoverable schema mismatches (forward-version state).
 *
 * Prefers OPFS but if OPFS read returns empty AND localStorage has something,
 * uses localStorage.  This handles the case where a previous saveState wrote
 * to localStorage (e.g., because OPFS write failed) — we don't want to
 * "lose" that data by preferring an empty OPFS file.
 */
export async function loadState(): Promise<PersistedState> {
  storeLocked = false;
  if (await opfsAvailable()) {
    const s = await loadFromOpfs();
    if (s !== null && s.imports.length > 0) {
      lastUsedBackend = 'opfs';
      return s;
    }
  }
  const fromLs = await loadFromLocalStorage();
  if (fromLs !== null) {
    lastUsedBackend = 'localStorage';
    return fromLs;
  }
  // Last resort: empty OPFS file (no data yet anywhere).
  if (await opfsAvailable()) {
    const s = await loadFromOpfs();
    if (s !== null) {
      lastUsedBackend = 'opfs';
      return s;
    }
  }
  lastUsedBackend = 'memory';
  return { ...EMPTY_STATE };
}

/**
 * Persist the entire state.  Tries OPFS first; if OPFS write throws for any
 * reason (createWritable not supported, quota, permission), falls back to
 * localStorage instead of letting the error propagate.  An unhandled save
 * failure would silently lose the user's work — much worse than landing on
 * the simpler backend.
 */
export async function saveState(state: PersistedState): Promise<void> {
  const toWrite: PersistedState = { ...state, version: STORE_VERSION };
  if (await opfsAvailable()) {
    try {
      await saveToOpfs(toWrite);
      lastUsedBackend = 'opfs';
      return;
    } catch (err) {
      console.warn(
        'store: OPFS save failed, falling back to localStorage',
        err instanceof Error ? err.message : err
      );
    }
  }
  try {
    await saveToLocalStorage(toWrite);
    lastUsedBackend = 'localStorage';
  } catch (err) {
    lastUsedBackend = 'memory';
    throw new Error(
      `store: both OPFS and localStorage failed to save. Your data is in memory only and will be lost on reload. Underlying error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Wipe the persisted state.  Used by the "Clear all data" button in the UI.
 * Returns true if a state file existed and was removed; false if nothing
 * was there.  Errors are logged but not thrown — the worst case is the user
 * sees their data again on next reload, which the in-memory clear has
 * already addressed.
 */
export async function clearState(): Promise<boolean> {
  let cleared = false;
  if (await opfsAvailable()) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(OPFS_FILE_NAME);
      cleared = true;
    } catch (err) {
      if (!(err instanceof Error && err.name === 'NotFoundError')) {
        console.warn('store: OPFS clear failed', err);
      }
    }
  }
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) !== null) {
    localStorage.removeItem(LS_KEY);
    cleared = true;
  }
  return cleared;
}

/** Read the raw stored blob (encrypted or plaintext) without decoding it. */
async function readRawStored(): Promise<string | null> {
  if (await opfsAvailable()) {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(OPFS_FILE_NAME, { create: false });
      const text = await (await handle.getFile()).text();
      if (text.trim() !== '') return text;
    } catch {
      // fall through to localStorage
    }
  }
  if (typeof localStorage !== 'undefined') {
    const t = localStorage.getItem(LS_KEY);
    if (t !== null && t.trim() !== '') return t;
  }
  return null;
}

/**
 * With the current session key set, test whether the stored data decodes.
 * Returns true if nothing is stored, the blob is plaintext, or it decrypts
 * cleanly; false if an encrypted blob fails to decrypt (wrong key). Used by the
 * returning-user unlock flow (T116).
 */
export async function tryDecryptWithCurrentKey(): Promise<boolean> {
  const raw = await readRawStored();
  if (raw === null) return true;
  try {
    const decoded = await decodeStateFromStorage(raw);
    return decoded.kind !== 'locked';
  } catch {
    return false;
  }
}

/**
 * Convenience: add a single import to the persisted state.  Idempotent — a
 * record with the same `pdf_source_hash` replaces the prior one instead of
 * duplicating.  Returns the updated state so the caller can update its
 * in-memory mirror without re-reading from disk.
 *
 * Serialized against other write operations via the writeChain mutex so
 * concurrent callers can't clobber each other.
 */
export function addImport(record: ImportRecord): Promise<PersistedState> {
  return serializeWrite(async () => {
    const state = await loadState();
    const next: PersistedState = {
      ...state,
      imports: [
        ...state.imports.filter((i) => i.pdf_source_hash !== record.pdf_source_hash),
        record
      ]
    };
    await saveState(next);
    return next;
  });
}

/** Convenience: remove one import by pdf_source_hash. */
export function removeImport(pdfSourceHash: string): Promise<PersistedState> {
  return serializeWrite(async () => {
    const state = await loadState();
    const next: PersistedState = {
      ...state,
      imports: state.imports.filter((i) => i.pdf_source_hash !== pdfSourceHash),
      // When a statement goes away, any reconciliation links pointing at it
      // become orphans.  Drop those so the UI doesn't render dangling badges.
      reconciliation_links: state.reconciliation_links.filter(
        (l) =>
          state.imports[l.bank_import_index]?.pdf_source_hash !== pdfSourceHash &&
          state.imports[l.cc_import_index]?.pdf_source_hash !== pdfSourceHash
      )
    };
    await saveState(next);
    return next;
  });
}

/** Convenience: replace all reconciliation links (matcher reruns wholesale). */
export function setReconciliationLinks(links: ReconciliationLink[]): Promise<PersistedState> {
  return serializeWrite(async () => {
    const state = await loadState();
    const next: PersistedState = { ...state, reconciliation_links: links };
    await saveState(next);
    return next;
  });
}
