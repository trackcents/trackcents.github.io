# Contract: Sync Provider (Phase 3 of v1)

The sync provider is the abstraction that the app uses to push and pull the encrypted blob to/from the user's chosen cloud storage. v1 has one implementation: Google Drive. The interface is provider-agnostic so that OneDrive, Dropbox, or a self-hosted alternative can be added later without touching the sync engine.

## TypeScript interface

```typescript
// src/lib/sync/types.ts

export interface SyncProvider {
  /** Provider identifier, e.g. 'google-drive'. */
  readonly id: string;

  /** Human-readable name for UI, e.g. 'Google Drive'. */
  readonly display_name: string;

  /**
   * Begin the auth flow. Returns when the user has granted (or denied) access.
   * Stores the resulting access token internally (provider-specific storage).
   */
  authenticate(): Promise<{ ok: true } | { ok: false; reason: string }>;

  /**
   * Has the user previously authenticated with this provider?
   * Returns false if no token is stored or if the stored token is expired
   * and cannot be refreshed.
   */
  isAuthenticated(): Promise<boolean>;

  /** Revoke access. Forgets the stored token. */
  signOut(): Promise<void>;

  /**
   * Read the encrypted blob (and its sidecar metadata) from the provider.
   * Returns null if no blob exists yet (first sync from this user).
   * Throws if the network is down or the token is invalid.
   */
  readBlob(): Promise<EncryptedBlob | null>;

  /**
   * Write the encrypted blob. Provider implementations should be atomic:
   * either the new blob replaces the old one entirely, or the old one
   * remains untouched. Partial writes are unacceptable.
   *
   * `if_match_version` is an optimistic-concurrency token; the write
   * fails if the remote blob's version doesn't match. This lets us
   * detect concurrent writes from another device.
   */
  writeBlob(blob: EncryptedBlob, if_match_version?: string): Promise<{ new_version: string }>;

  /**
   * Cheap metadata-only read: size, last-modified, version token.
   * Used to determine "should we pull?" without downloading the full blob.
   */
  statBlob(): Promise<BlobMetadata | null>;
}

export interface EncryptedBlob {
  /**
   * The encrypted SQLite file + framing bytes. Schema:
   *   [4 bytes magic 'MTRB']
   *   [4 bytes blob format version, big-endian]
   *   [16 bytes IV/nonce]
   *   [N bytes ciphertext]
   *   [16 bytes AES-GCM authentication tag]
   * Caller-provided. Caller-decrypted. Provider never inspects.
   */
  ciphertext: Uint8Array;

  /**
   * Non-secret metadata that travels alongside the blob. Includes the
   * salt and KDF parameters so a new device can derive the key from the
   * user's passphrase.
   */
  sidecar: {
    salt_b64: string;
    kdf_algorithm: 'PBKDF2-SHA-256';
    kdf_iterations: number;
    blob_version: number;
    last_written_at: string;          // ISO timestamp
    last_writer_device: string;       // opaque device id
  };
}

export interface BlobMetadata {
  size_bytes: number;
  last_modified: string;              // ISO timestamp
  version: string;                    // opaque provider-assigned token (etag-like)
}
```

## Contract obligations

A SyncProvider implementation MUST:

1. **Never see plaintext.** It only ever receives and returns `Uint8Array` ciphertext. It MUST NOT attempt to inspect, modify, or parse the bytes.
2. **Be atomic on write.** If `writeBlob` fails midway, the user's previous blob MUST remain intact in the provider's storage. Implementations on providers without native atomic replace (e.g. Drive) MUST use the upload-to-temp + rename pattern.
3. **Respect `if_match_version`.** If the caller provides a version token that no longer matches the remote, the write MUST fail with a clearly-typed error (`ConcurrentModificationError`).
4. **Be offline-tolerant.** Methods MUST throw a typed `NetworkUnavailableError` when the network is down, rather than hanging or returning silently.
5. **Refresh tokens transparently.** Where OAuth tokens expire, the provider refreshes them internally; callers MUST NOT need to know about token state beyond `isAuthenticated()`.
6. **Operate on a single dedicated folder/path.** For Google Drive, this is a folder created at first auth named `MoneyTracker/`, with the blob stored as `vault.bin` and the sidecar as `vault.meta.json`. The provider MUST NOT touch any files outside this folder.
7. **Request minimal scope.** Google Drive provider uses `drive.file` (per-file access for files the app created). Equivalent minimal scopes for OneDrive / Dropbox when those providers are added.

A SyncProvider implementation MUST NOT:

- Persist any plaintext anywhere.
- Cache decrypted data.
- Send any telemetry, analytics, or non-blob metadata to any third party (including the provider).
- Make network calls outside of the provider's API surface (no analytics SDKs, etc.).
- Block the UI thread on long operations; all I/O is `async`/Promise-based.

## Error taxonomy

```typescript
export class NetworkUnavailableError extends Error {}     // Offline or transient
export class AuthenticationError extends Error {}         // Token invalid or absent
export class ConcurrentModificationError extends Error {} // if_match_version mismatch
export class ProviderQuotaError extends Error {}          // User's Drive is full
export class BlobCorruptError extends Error {}            // Magic bytes / structure invalid
```

Callers (the sync engine) MUST handle each of these explicitly. No catch-all error swallowing.

## Sync engine (independent of provider)

```typescript
// src/lib/sync/sync-engine.ts

export interface SyncEngine {
  /**
   * Configure the engine with a chosen provider + the user's encryption key.
   */
  configure(provider: SyncProvider, key: CryptoKey): Promise<void>;

  /**
   * Pull: download the remote blob, decrypt it, replace the local SQLite file.
   * Triggers on app open (if remote is newer) and on demand.
   */
  pull(): Promise<{ pulled: boolean; reason: string }>;

  /**
   * Push: encrypt the local SQLite file, upload to the provider.
   * Triggers: on app close, on manual sync, on a configurable timer (default off).
   * Returns the new remote version token.
   */
  push(): Promise<{ pushed: boolean; new_version?: string; reason: string }>;

  /**
   * Convenience: pull then push, with conflict resolution.
   */
  sync(): Promise<SyncResult>;

  /**
   * Subscribe to sync events for UI display.
   */
  onStatusChange(listener: (status: SyncStatus) => void): () => void;
}

export type SyncStatus =
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
```

## Conflict resolution (sync-authoritative model)

Per constitution Principle XI, the **cloud blob is the source of truth**. Conflict handling:

1. **On `pull`**: if the remote blob's `last_written_at` is newer than the local SQLite's `last_synced_at` watermark, the local file is REPLACED by the decrypted remote. Local in-flight edits since the last push are LOST. The UI MUST warn the user when this is about to happen.
2. **On `push`**: if `if_match_version` fails (someone else pushed since our last pull), the engine MUST `pull` first, then re-attempt `push`. Local changes that were not yet pushed are merged via per-field LWW (when v1.1 categorization lands; v1 has no editable fields so this is moot).
3. **Visible conflict** only arises when per-field LWW disagrees — in v1, never happens. Reserved for v1.1+.

## Provider implementations

| Provider | v1 status | Notes |
|---|---|---|
| Google Drive | shipped in Phase 3 of v1 | scope `drive.file`, folder `MoneyTracker/` |
| OneDrive | not in v1 | will use scope `Files.ReadWrite.AppFolder` |
| Dropbox | not in v1 | will use scoped app folder |
| Self-hosted (WebDAV / S3 / R2) | not in v1 | named as constitutional fallback if Drive becomes unworkable |

A provider switch in the future is non-destructive: user authenticates with the new provider, app pulls from the OLD provider one last time, pushes to the NEW provider, and the user can then revoke OLD provider access. No data loss.
