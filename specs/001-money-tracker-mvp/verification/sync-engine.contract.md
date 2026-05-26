# Verification Contract — sync-engine (+ blob-format framing)

> Implementation-free. States WHAT the provider-agnostic sync engine must do and
> the interface it exposes, never HOW. The verifier authors its environment from
> this contract + the cited spec and never reads the source.
>
> Produced by: the Designer. Consumed by: the `verification-engineer` (via `/ivv`).

> **PLAN-GATE RESOLUTIONS (applied before this EXECUTE pass):**
> - **A1 [was HIGH] — RESOLVED by code change to the MERGE model.** The old `pull` replaced local with remote and could wipe an unsynced local import. Per the user (architect), sync now follows the OneNote/Simplenote model: **`pull` UNIONS the remote into local — it never overwrites.** No import from either device is ever lost; the cloud accumulates the superset. This is safe in v1 because imports are append-only + idempotent (unique `pdf_source_hash`, no editable fields until v1.1). Per-field last-write-wins for editable fields is deferred to v1.1. The watermark language in `sync-provider.md` point 1 is superseded by union-merge for v1 (a spec-doc update is owed; tracked separately).
> - **A4 [was MEDIUM] — RESOLVED by the Designer** (see R-BF1): "valid length" = AES payload ≥ 28 bytes; decode-side guard only; do not file `encode(<28)→decode throws` as a discrepancy.
> - **A2/A3 [LOW]** — observe-and-document (single-retry conflict; microtask-robust status assertion).

## 1. Module under verification

- **Source file(s)** (do NOT open these): `src/lib/sync/sync-engine.ts`, `src/lib/sync/blob-format.ts`, `src/lib/sync/merge.ts`
- **Public entry points**:
  - sync-engine: `configure`, `isConfigured`, `onStatusChange`, `pull`, `push`, `sync`
  - merge: `mergeState`
  - blob-format: `encodeBlobFrame`, `decodeBlobFrame`, `BLOB_FORMAT_VERSION`
- **Risk tier**: P1 (encrypted-data movement; not P0 money-math, but data-integrity critical)
- **Touches**: ☑ persistent state ☑ concurrency/async ☑ untrusted input (decode of remote bytes) ☐ value/money math (only as opaque payload) ☐ authn/authz ☐ running UI

## 2. Authoritative spec sources

If this contract and a spec doc disagree, the spec wins and the disagreement is itself a finding.

- `specs/001-money-tracker-mvp/contracts/sync-provider.md` — the `SyncProvider` interface, `EncryptedBlob`/`BlobMetadata` shapes, error taxonomy, the "Sync engine" section, and **"Conflict resolution (sync-authoritative model)"**.
- `.specify/memory/constitution.md` — Principle XI (sync-authoritative, local-as-cache), Principle I (privacy / zero-knowledge).
- **Known spec drift (already noted, not a bug to re-litigate):** the `EncryptedBlob` doc-comment in `sync-provider.md` says "16 bytes IV"; the shipped AES-GCM layer uses the NIST-standard **12-byte** GCM IV. IV size is internal to the (already independently signed-off) crypto module and is **opaque to the framing** — `blob-format` treats the AES blob as an opaque byte string. Do not test IV size here; see §7.

## 3. Public interface (signatures only)

```typescript
// src/lib/sync/sync-engine.ts
export function configure(p: SyncProvider, key: CryptoKey): void;     // NOTE: synchronous (spec sketch showed Promise<void>; as-built is void — see §7)
export function isConfigured(): boolean;
export function onStatusChange(listener: (s: SyncState) => void): () => void;  // returns unsubscribe
export function pull(): Promise<{ pulled: boolean; reason: string }>;
export function push(): Promise<{ pushed: boolean; new_version?: string; reason: string }>;
export function sync(): Promise<SyncResult>;

// src/lib/sync/blob-format.ts
export const BLOB_FORMAT_VERSION: number; // == 1
export function encodeBlobFrame(aesBlob: Uint8Array, version?: number): Uint8Array;
export function decodeBlobFrame(framed: Uint8Array): { version: number; aesBlob: Uint8Array };

// src/lib/sync/merge.ts
export function mergeState(a: PersistedState, b: PersistedState): PersistedState;
```

Types you import from `src/lib/sync/types.ts` (build your mock + reference model against these):

```typescript
interface SyncProvider {
  readonly id: string;
  readonly display_name: string;
  authenticate(): Promise<{ ok: true } | { ok: false; reason: string }>;
  isAuthenticated(): Promise<boolean>;
  signOut(): Promise<void>;
  readBlob(): Promise<EncryptedBlob | null>;
  writeBlob(blob: EncryptedBlob, if_match_version?: string): Promise<{ new_version: string }>;
  statBlob(): Promise<BlobMetadata | null>;
}
interface EncryptedBlob { ciphertext: Uint8Array; sidecar: {
  salt_b64: string; kdf_algorithm: 'PBKDF2-SHA-256'; kdf_iterations: number;
  blob_version: number; last_written_at: string; last_writer_device: string; }; }
interface BlobMetadata { size_bytes: number; last_modified: string; version: string; }
type SyncState =
  | { state: 'idle'; last_sync_at: string | null } | { state: 'pulling' }
  | { state: 'pushing' } | { state: 'error'; error: string } | { state: 'conflict' };
interface SyncResult { pulled: boolean; pushed: boolean; conflict_resolved: boolean; error?: string; }
class NetworkUnavailableError extends Error {}
class AuthenticationError extends Error {}
class ConcurrentModificationError extends Error {}
class ProviderQuotaError extends Error {}
class BlobCorruptError extends Error {}
```

### Collaborators you MAY use to seed / inspect local state (NOT under verification)

The engine reads/writes "the local app state" through the store module. To verify
round-trips, seed and read state through this public API — treat it as trusted infra:

```typescript
// src/lib/db/store.ts
interface PersistedState { version: number; imports: ImportRecord[]; reconciliation_links: ReconciliationLink[]; }
const STORE_VERSION: number; // == 1
function serializeState(state: PersistedState): string;       // bigint-safe JSON
function deserializeState(text: string): PersistedState;
async function loadState(): Promise<PersistedState>;
async function saveState(state: PersistedState): Promise<void>;
async function clearState(): Promise<boolean>;

// src/lib/crypto/kdf.ts   — export function deriveKey(passphrase, salt, opts?): Promise<CryptoKey>; const KDF_ITERATIONS
// src/lib/crypto/salt.ts  — export function generateSalt(): Uint8Array; saltToBase64()
// src/lib/crypto/session.ts — setSessionKey(k), getSessionKey(), clearSessionKey()
// src/lib/app/unlock.ts   — const SALT_STORAGE_KEY ('mtrb.salt')
```

### Environment setup the contract guarantees (so you are not reverse-engineering)

- **Run under `// @vitest-environment node`** — the engine uses Web Crypto (`crypto.subtle`) and `localStorage`. Node 18+ provides global `crypto`. You must stub `localStorage` (a `Map`-backed stub is sufficient; see the existing Designer pattern only conceptually — do NOT read it for oracle logic).
- **The store encrypts-at-rest when a session key is present.** In the real app the sync key and the session key are the **same** `CryptoKey` (the controller configures the engine with `getSessionKey()`). So: call `setSessionKey(key)` with the same key you pass to `configure(provider, key)`. (Equivalently you may leave no session key, in which case the at-rest store is plaintext and round-trips equally well — both are valid setups.)
- **Module-level singleton:** sync-engine holds `provider`, `key`, `lastSyncAt`, and `listeners` at module scope. `configure()` replaces provider+key. Reset between cases by re-configuring and `clearState()`.

## 4. Behavioral requirements (the WHAT)

- **R1 — not configured ⇒ refuses.** Before `configure(...)`, each of `pull()`, `push()`, `sync()` MUST reject (throw) with an error whose message conveys "not configured". `isConfigured()` returns `false` until `configure` is called, `true` after.
- **R2 — push hands the provider ciphertext only.** `push()` serializes the current local state, encrypts it with the configured key, frames it, and calls `provider.writeBlob(blob, <version>)`. The `blob.ciphertext` handed to the provider MUST be ciphertext — it MUST NOT contain recognizable plaintext substrings from the local state (e.g. known transaction descriptions, the literal key `"reconciliation_links"`, bank names you seeded). On success returns `{ pushed: true, new_version, reason }`.
- **R3 — push threads the optimistic-concurrency version.** Before writing, `push()` consults `provider.statBlob()` and passes the remote's current `version` as `writeBlob`'s `if_match_version` (or `undefined`/omitted when no remote blob exists yet). A provider that rejects a stale `if_match_version` with `ConcurrentModificationError` MUST cause `push()` to reject (it does NOT silently overwrite).
- **R4 — pull MERGES the remote, or no-ops.** `pull()` calls `provider.readBlob()`. If it returns `null` (no remote yet), `pull()` returns `{ pulled: false, ... }` and does NOT alter local state. Otherwise it decodes the frame, decrypts with the configured key, deserializes, **UNIONS the remote into the current local state via `mergeState(local, remote)`** (it does NOT overwrite — A1 resolution), saves the merged result, and returns `{ pulled: true, ... }`. Consequence the bench MUST check: an import that exists ONLY locally (never pushed) is still present after a `pull` of an older remote (no silent loss).
- **R5 — round-trip fidelity.** After `push()` of a state `S`, then `clearState()`, then `pull()`, the restored local state MUST equal `S` (value-equal: same imports, same transactions incl. bigint amounts, same reconciliation_links). Because local is empty after the clear, `mergeState(∅, S) ≡ S`, so the merge model preserves this round-trip exactly. The provider in between sees only ciphertext (R2).
- **R6 — sync resolves a concurrent-write conflict by UNION (no loss).** `sync()` performs a `pull` (merge) then a `push`. If that `push` throws `ConcurrentModificationError` (another device wrote between our pull and push), `sync()` MUST recover by pulling the newer remote (which MERGES it into local) and re-pushing, and the returned `SyncResult.conflict_resolved` MUST be `true` with `pushed: true` (unless the union turned out to already match the remote — see R9). After resolution, the pushed blob MUST contain the UNION of both sides' imports (neither device's import is lost). A non-conflict error (`Network`/`Auth`/`Quota`) MUST propagate (not be swallowed, not be reported as resolved).
- **R9 — push is skipped when nothing changed.** When the local serialized state is identical to what was last pushed AND a remote blob already exists, `push()` returns `{ pushed: false, reason: <no-change> }` and does NOT call `writeBlob` (so no redundant Drive revision/checkpoint is created). When there is no remote yet, or the local state differs from the last push, `push()` uploads. (Change is detected on the PLAINTEXT serialization, since the ciphertext differs every time due to the random IV.)
- **R-M1 — merge unions imports by hash.** `mergeState(a, b).imports` contains exactly one `ImportRecord` per distinct `pdf_source_hash` appearing in `a.imports` or `b.imports`; `a`'s imports keep their relative order and `b`'s new-hash imports are appended. No hash is dropped; no hash is duplicated.
- **R-M2 — merge re-indexes links.** Each `ReconciliationLink` in the result has `bank_import_index`/`cc_import_index` pointing at the correct import (by `pdf_source_hash`) IN THE MERGED imports array — NOT the source array's positions. Transaction indices are carried over unchanged.
- **R-M3 — merge drops dangling links.** A link whose `bank_import_index` or `cc_import_index` does not resolve to an import in its source state (or whose import's hash is absent from the merged result) is omitted from the result. Exact-duplicate links (same re-indexed positional key) are deduped (first-writer-wins, `a` before `b`).
- **R-M4 — merged version never downgrades** (added post-EXECUTE per the VE's minor ambiguity note). `mergeState(a, b).version` MUST be ≥ `max(a.version, b.version, STORE_VERSION)`, so a newer client's schema version is never silently downgraded by a merge. As-built it is exactly `max(a.version, b.version, STORE_VERSION)`. Moot in v1 (single schema version), but pinned so a future schema bump is safe.
- **R7 — status stream.** `onStatusChange(listener)` registers a listener and returns an unsubscribe function. During `pull()` the listener observes `{state:'pulling'}` then `{state:'idle'}`; during `push()` `{state:'pushing'}` then `{state:'idle'}`; on a thrown error `{state:'error', error}`. After unsubscribe, the listener receives nothing further. Multiple listeners all receive events.
- **R8 — sidecar is well-formed and non-secret.** The `sidecar` on the pushed blob MUST carry `kdf_algorithm === 'PBKDF2-SHA-256'`, a numeric `kdf_iterations`, `blob_version === BLOB_FORMAT_VERSION`, an ISO `last_written_at`, and an opaque `last_writer_device`. It MUST NOT contain plaintext state or the passphrase/key.
- **R-BF1 — frame round-trips.** `decodeBlobFrame(encodeBlobFrame(b, v))` returns `{ version: v, aesBlob }` where `aesBlob` is byte-equal to `b`, for any `b` of **valid length** and any `v` in `[0, 2^32)`. Default `v` is `BLOB_FORMAT_VERSION`. **"Valid length" (resolved at the PLAN gate, A4): `b.byteLength ≥ 28`** — a real AES-GCM blob is at minimum a 12-byte IV + a 16-byte auth tag (empty plaintext), so 28 bytes is the floor. `decodeBlobFrame` MUST reject a frame whose AES payload is shorter than 28 bytes with `BlobCorruptError` (truncation defense). The round-trip property is scoped to `b.byteLength ≥ 28`; shorter inputs are exercised as throw-cases, not round-trip cases. **Accepted asymmetry:** `encodeBlobFrame` does NOT enforce the 28-byte floor (it is an internal helper only ever handed real AES output); only `decodeBlobFrame` guards. The framing layer is opaque to the blob's *content*, not its *length* — knowing the AES-GCM minimum length is legitimate corruption-detection, not a layering violation. Do NOT file `encode(<28-byte input>)→decode throws` as a discrepancy.
- **R-BF2 — frame carries magic + version header.** The framed output begins with the ASCII bytes `MTRB`, followed by a 4-byte big-endian version, followed by the AES blob.

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — conservation across round-trip.** No import and no transaction is created, dropped, duplicated, or mutated by a push→pull cycle (R5 generalized over arbitrary seeded states, including bigint money values of any magnitude). The multiset of transactions out equals the multiset in.
- **INV2 — ciphertext opacity (oracle-independent).** For ANY seeded local state, the bytes handed to `provider.writeBlob` reveal no plaintext: a chosen sentinel string seeded into the state (e.g. a unique transaction description) MUST NOT appear as a contiguous byte run in `blob.ciphertext`. (This is a privacy invariant per Principle I — verify it directly, do not trust the engine's claim.)
- **INV3 — frame decode is total and safe.** `decodeBlobFrame` either returns a valid `{version, aesBlob}` or throws `BlobCorruptError` — it never returns garbage, never reads out of bounds, never hangs, for arbitrary byte inputs (fuzz this).
- **INV4 — version monotonicity through the mock.** Repeated `push()` against a mock that increments its version on each accepted write yields strictly increasing `new_version` tokens, and each `push` offers the latest observed version as `if_match` (no lost-update window left open by the engine itself).
- **INV5 — idle is the resting state.** After any successful `pull`/`push`/`sync` completes, the last emitted status is `{state:'idle'}` (not left in `pulling`/`pushing`). After a thrown error the last emitted status is `{state:'error'}`.
- **INV-M1 — merge is idempotent.** `mergeState(s, s)` has the same set of import hashes and the same set of (re-indexed) links as `s`. (Re-syncing unchanged data adds nothing.)
- **INV-M2 — merge is set-commutative.** `mergeState(a, b)` and `mergeState(b, a)` contain the SAME set of import hashes and the SAME set of links (order MAY differ; the SET MUST NOT). This is the "no device is privileged" property.
- **INV-M3 — conservation / no creation.** The set of import hashes in `mergeState(a, b)` equals exactly `hashes(a) ∪ hashes(b)` — nothing is lost (⊇ both inputs) and nothing is invented (⊆ the union). This is the merge analogue of the mandatory conservation invariant.
- **INV-M4 — referential integrity.** For EVERY link in `mergeState(a, b).reconciliation_links`, both `bank_import_index` and `cc_import_index` are valid indices into the result's `imports` array (`0 ≤ idx < imports.length`). The merge never produces a dangling link.

## 6. Domain edge cases that MUST be handled

- Empty local state (no imports, no links) — push/pull round-trip still works; ciphertext still opaque.
- First sync ever: `readBlob` → `null` (pull no-ops), `statBlob` → `null` (push offers no `if_match`).
- Large state: many imports / many transactions with large bigint amounts (e.g. ±9_007_199_254_740_993n and beyond) — round-trip exact.
- `decodeBlobFrame` on: empty array; array shorter than the 8-byte header; header-only (no AES blob); correct length but wrong magic; correct magic but truncated AES blob below the AES-GCM minimum; a buffer with a non-zero `byteOffset` (subarray view).
- Concurrent write: the conflict path (R6) fires exactly once and then succeeds; a provider that conflicts *twice* in a row is allowed to surface the second error (document whichever the engine does — single-retry vs loop — as observed behavior, and check it against the spec's wording "pull first, then re-attempt").
- Multiple `onStatusChange` listeners; unsubscribing one does not affect the others.
- **Merge corners:** disjoint imports (a-only + b-only → both survive); fully-overlapping imports (a == b → idempotent, no dups); partial overlap (shared hash kept once); empty ⊕ non-empty (identity); links from BOTH sides (re-indexed + unioned); duplicate links across sides (deduped); a link in `b` that points at an import only `b` has (survives, re-indexed); a link whose import hash is absent after merge (dropped); links referencing the same import pair but different `cc_transaction_index` (both kept — different positional key).
- **No-silent-loss scenario (the A1 regression guard):** local has import X (never pushed), remote has only older import Y; after `pull`, local MUST contain BOTH X and Y. After `sync`, the remote MUST contain both X and Y.

## 7. Explicitly OUT of scope / deferred — do NOT report these as bugs

- `src/lib/sync/drive-blob.ts` (the live Google Drive REST provider) — verifiable only in a real browser against the live API; excluded by the run scope.
- The Svelte UI (`SyncStatusIndicator.svelte`, layout wiring, `sync-controller.ts`).
- **AES-GCM crypto internals** (IV length, tag, key derivation) — independently signed off in `tests/unit/independent/crypto-security.test.ts`. Treat encrypt/decrypt as a trusted black box keyed by the `CryptoKey`. The "16-byte IV" wording in the spec doc is stale (see §2); do not test IV size.
- **Per-field LWW / visible `{state:'conflict'}` resolution** — `sync-provider.md` §"Conflict resolution" point 3 states this only arises with editable fields, which **arrive in v1.1**; v1 has no editable fields. So a *visible* conflict state never occurs in v1. The `'conflict'` SyncState variant existing-but-unreached is expected, not a gap.
- `configure` being synchronous (`void`) vs the spec sketch's `Promise<void>` — as-built it is synchronous; this is an accepted simplification, not a bug. (Flag if you think the spec must be reconciled, but do not fail the run on it.)
- The store's own persistence/encryption-at-rest correctness — owned by `db/store` + `db/store-crypto`, verified separately.

## 8. Error contract (no silent failures)

- Unconfigured `pull`/`push`/`sync` → throw (R1), message contains "configured".
- `decodeBlobFrame` invalid input → throw `BlobCorruptError` (R-BF / INV3). Never a generic `Error`, never a silent `null`.
- `push`/`sync` on a `ConcurrentModificationError`: `push` propagates it; `sync` catches it and resolves once (R6). All OTHER provider errors (`NetworkUnavailableError`, `AuthenticationError`, `ProviderQuotaError`) MUST propagate out of `pull`/`push`/`sync` — they are NOT swallowed and NOT reported as `conflict_resolved`.
- On any thrown error, the status stream MUST emit `{state:'error', error:<message>}` before the error propagates.

## 9. Security expectations

- Privacy (Principle I): the provider — modeled as a hostile observer — must never be able to recover plaintext from anything the engine hands it. INV2 is the testable form. Additionally, the `sidecar` is explicitly non-secret (salt + KDF params are safe to expose) but MUST NOT leak the key or plaintext state (R8).

## 10. Runtime/behavioral expectations

n/a — not a running UI in this scope (the UI is out of scope, §7).

## 11. Known oracle hazards (Knight & Leveson)

- **Round-trip (INV1/R5)** is the safe oracle here: you do not need to predict the exact ciphertext (you can't — GCM is randomized by IV), only that decrypt∘encrypt is identity over the state. Use the **store's own `serializeState`/`deserializeState`** as the equality basis (compare serialized forms) to avoid bigint `===` pitfalls — but ALSO spot-check structural equality so you're not blind to a serializer bug masking a round-trip bug (don't let the same function define both sides).
- **INV2 opacity**: a false "pass" is possible if your sentinel happens to be short/common; use a long high-entropy unique sentinel so a contiguous-byte search is meaningful. Encryption changes bytes, so absence of the sentinel is strong evidence; presence is a definite leak.
- **Version threading (R3/INV4)**: the mock provider IS your oracle for concurrency — make it model the spec's optimistic-concurrency semantics faithfully (reject on stale `if_match`, increment on accept). A bug in your mock will produce correlated blind spots; keep the mock's rule a literal transcription of `sync-provider.md` obligation #3.
