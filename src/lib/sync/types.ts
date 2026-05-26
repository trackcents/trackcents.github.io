// Layer 3 sync provider types per specs/001-money-tracker-mvp/contracts/sync-provider.md.
//
// A SyncProvider is the abstraction the app uses to push and pull the encrypted
// data blob.  The provider only ever sees ciphertext — by contract, it MUST NOT
// inspect, modify, or parse the bytes.

/**
 * The encrypted database snapshot plus non-secret metadata needed to derive
 * the decryption key from the user's passphrase on a fresh device.
 *
 * Wire format of `ciphertext`:
 *   [4 bytes  magic 'MTRB']
 *   [4 bytes  blob format version, big-endian]
 *   [12 bytes IV/nonce]
 *   [N bytes  AES-256-GCM ciphertext]
 *   [16 bytes AES-GCM authentication tag]
 */
export interface EncryptedBlob {
  ciphertext: Uint8Array;
  sidecar: BlobSidecar;
}

export interface BlobSidecar {
  salt_b64: string;
  kdf_algorithm: 'PBKDF2-SHA-256';
  kdf_iterations: number;
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
  readBlob(): Promise<EncryptedBlob | null>;

  /**
   * Atomic write.  `if_match_version` is an optimistic-concurrency token; if
   * provided and the remote version no longer matches, throws
   * ConcurrentModificationError.
   */
  writeBlob(blob: EncryptedBlob, if_match_version?: string): Promise<{ new_version: string }>;

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
