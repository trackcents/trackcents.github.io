/**
 * Provider-agnostic sync engine.
 *
 * Pushes the local state (PLAINTEXT JSON, framed) to the configured SyncProvider
 * and pulls it back. Conflict model is sync-authoritative: the remote blob is the
 * source of truth, and a concurrent-write conflict on push is resolved by pulling
 * the newer remote (union-merged so no local import is lost), then re-pushing.
 *
 * Encryption was removed at the user's request — the blob is plaintext (see the
 * amended Constitution Principle I).
 */
import { encodeBlobFrame, decodeBlobFrame, BLOB_FORMAT_VERSION } from './blob-format';
import { buildBundleString, applyRemotePayload } from './app-bundle';
import {
  ConcurrentModificationError,
  type SyncBlob,
  type SyncProvider,
  type SyncResult,
  type SyncState
} from './types';

let provider: SyncProvider | null = null;
let lastSyncAt: string | null = null;
const listeners = new Set<(s: SyncState) => void>();

function emit(state: SyncState): void {
  for (const listener of listeners) listener(state);
}
function idle(): void {
  emit({ state: 'idle', last_sync_at: lastSyncAt });
}
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DEVICE_KEY = 'mtrb.device';
function deviceId(): string {
  if (typeof localStorage === 'undefined') return 'unknown-device';
  let id = localStorage.getItem(DEVICE_KEY);
  if (id === null) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Wire up the engine with a provider. */
export function configure(p: SyncProvider): void {
  provider = p;
}

/** True once a provider has been wired in (triggers gate on this). */
export function isConfigured(): boolean {
  return provider !== null;
}

/** Subscribe to status changes for the UI. Returns an unsubscribe function. */
export function onStatusChange(listener: (s: SyncState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function requireConfigured(): SyncProvider {
  if (provider === null) {
    throw new Error('sync: not configured — call configure(provider) first');
  }
  return provider;
}

const PUSHED_FP_KEY = 'mtrb.sync.pushed_fp';
// Provider version token (etag-like) of the remote blob we last reconciled with —
// set on every successful push AND on every applied pull. The pull gate compares
// the current remote version against it so we only MERGE a blob that genuinely
// changed since we last saw it. Without this, a pull-before-push (the sync()
// order) would re-merge our OWN last push and could revert a local edit we hadn't
// pushed yet (remote-wins side-store merge). With it, a device never reverts its
// own unpushed edits, and another device's changes still flow in.
const SYNCED_VERSION_KEY = 'mtrb.sync.remote_version';

/** SHA-256 hex of the serialization — used to skip redundant pushes. */
async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function getPushedFp(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(PUSHED_FP_KEY) : null;
}
function setPushedFp(fp: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(PUSHED_FP_KEY, fp);
}
function getSyncedVersion(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(SYNCED_VERSION_KEY) : null;
}
function setSyncedVersion(v: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(SYNCED_VERSION_KEY, v);
}

function buildBlob(json: string): SyncBlob {
  return {
    bytes: encodeBlobFrame(new TextEncoder().encode(json)),
    sidecar: {
      blob_version: BLOB_FORMAT_VERSION,
      last_written_at: new Date().toISOString(),
      last_writer_device: deviceId()
    }
  };
}

export async function pull(): Promise<{ pulled: boolean; reason: string }> {
  const p = requireConfigured();
  emit({ state: 'pulling' });
  try {
    const meta = await p.statBlob();
    if (meta === null) {
      idle();
      return { pulled: false, reason: 'no remote blob yet' };
    }
    // Skip when the remote hasn't changed since we last reconciled — so a
    // pull-before-push never re-applies (and possibly reverts) our own last push.
    if (meta.version === getSyncedVersion()) {
      idle();
      return { pulled: false, reason: 'remote unchanged since last sync' };
    }
    const blob = await p.readBlob();
    if (blob === null) {
      idle();
      return { pulled: false, reason: 'no remote blob yet' };
    }
    const { payload } = decodeBlobFrame(blob.bytes);
    const json = new TextDecoder().decode(payload);
    // Union ALL stores (vault + categories + recurring + budgets + goals + anchor),
    // don't overwrite: never lose an unsynced local import (IV&V A1) or local edit.
    await applyRemotePayload(json);
    setSyncedVersion(meta.version);
    lastSyncAt = new Date().toISOString();
    idle();
    return { pulled: true, reason: 'merged remote blob' };
  } catch (err) {
    emit({ state: 'error', error: describe(err) });
    throw err;
  }
}

export async function push(): Promise<{ pushed: boolean; new_version?: string; reason: string }> {
  const p = requireConfigured();
  emit({ state: 'pushing' });
  try {
    const json = await buildBundleString();
    const fp = await fingerprint(json);
    const remote = await p.statBlob();
    // Skip when nothing changed since our last push, so we don't pile up
    // redundant Drive revisions (only meaningful when a remote already exists).
    if (remote !== null && fp === getPushedFp()) {
      idle();
      return { pushed: false, reason: 'no local changes since last push' };
    }
    const { new_version } = await p.writeBlob(buildBlob(json), remote?.version);
    setPushedFp(fp);
    setSyncedVersion(new_version);
    lastSyncAt = new Date().toISOString();
    idle();
    return { pushed: true, new_version, reason: 'uploaded' };
  } catch (err) {
    emit({ state: 'error', error: describe(err) });
    throw err;
  }
}

export async function sync(): Promise<SyncResult> {
  const result: SyncResult = { pulled: false, pushed: false, conflict_resolved: false };
  result.pulled = (await pull()).pulled;
  try {
    result.pushed = (await push()).pushed;
  } catch (err) {
    if (err instanceof ConcurrentModificationError) {
      // Another device pushed between our pull and push — pull the newer remote, then re-push.
      await pull();
      result.pushed = (await push()).pushed;
      result.conflict_resolved = true;
    } else {
      throw err;
    }
  }
  return result;
}
