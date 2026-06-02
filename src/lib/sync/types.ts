// Layer 3 sync provider types per specs/001-money-tracker-mvp/contracts/sync-provider.md.
//
// A SyncProvider is the abstraction the app uses to push and pull the data blob.
// The blob is PLAINTEXT JSON — the passphrase/encryption layer was removed at the
// user's request (see amended Constitution Principle I). The provider still
// treats the bytes as opaque: it MUST NOT inspect, modify, or parse them.

/**
 * The database snapshot (framed plaintext JSON) plus non-secret metadata.
 *
 * Wire format of `bytes`:
 *   [4 bytes  magic 'MTRB']
 *   [4 bytes  blob format version, big-endian]
 *   [N bytes  UTF-8 JSON of the persisted state]
 */
export interface SyncBlob {
  bytes: Uint8Array;
  sidecar: BlobSidecar;
}

export interface BlobSidecar {
  blob_version: number;
  last_written_at: string; // ISO timestamp
  last_writer_device: string; // opaque device id (random per-device)
}

export interface BlobMetadata {
  size_bytes: number;
  last_modified: string; // ISO timestamp
  version: string; // opaque provider-assigned token (etag-like)
}

export interface SyncProvider {
  /** Provider identifier, e.g. 'google-drive'. */
  readonly id: string;

  /** Human-readable name for UI, e.g. 'Google Drive'. */
  readonly display_name: string;

  authenticate(): Promise<{ ok: true } | { ok: false; reason: string }>;
  isAuthenticated(): Promise<boolean>;
  signOut(): Promise<void>;

  /** Returns null if no blob exists yet (first sync). */
  readBlob(): Promise<SyncBlob | null>;

  /**
   * Atomic write.  `if_match_version` is an optimistic-concurrency token; if
   * provided and the remote version no longer matches, throws
   * ConcurrentModificationError.
   */
  writeBlob(blob: SyncBlob, if_match_version?: string): Promise<{ new_version: string }>;

  /** Cheap metadata-only read.  Used to detect "should we pull?" without downloading. */
  statBlob(): Promise<BlobMetadata | null>;
}

// ── Error taxonomy ──────────────────────────────────────────────────────────

export class NetworkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkUnavailableError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ConcurrentModificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentModificationError';
  }
}

export class ProviderQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderQuotaError';
  }
}

export class BlobCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlobCorruptError';
  }
}

// ── Sync engine status ──────────────────────────────────────────────────────

export type SyncState =
  | { state: 'idle'; last_sync_at: string | null }
  | { state: 'pulling' }
  | { state: 'pushing' }
  | { state: 'error'; error: string }
  | { state: 'conflict' };

export interface SyncResult {
  pulled: boolean;
  pushed: boolean;
  conflict_resolved: boolean;
  error?: string;
}
