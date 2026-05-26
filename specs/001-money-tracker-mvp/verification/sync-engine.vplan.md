# Verification Plan (vplan) — sync-engine + blob-format framing

> MODE: PLAN deliverable. Produced by the independent verification-engineer from
> the contract + cited spec ONLY. No implementation source was read (see
> Independence Audit at the bottom). No stimulus/scoreboard/mutation built yet.

- **DUT**: `src/lib/sync/sync-engine.ts`, `src/lib/sync/blob-format.ts` (NOT read)
- **Contract**: `specs/001-money-tracker-mvp/verification/sync-engine.contract.md`
- **Spec**: `specs/001-money-tracker-mvp/contracts/sync-provider.md`; constitution Principles I, XI
- **Risk tier**: P1 (encrypted data movement; data-integrity critical)

---

## 1. Verification plan — requirement → check → oracle → hazard mitigation

Legend for **check type**: PROP = fast-check property; META = metamorphic (oracle-free);
HIST = Jepsen-style operation-history vs consistency-model; FUZZ = malformed-input fuzz;
SB = scoreboard (DUT vs independent reference model); DIR = directed example.

| Req | Check(s) I will build | Oracle | Hazard (§11) mitigation |
|---|---|---|---|
| **R1** not-configured ⇒ refuses | DIR: before `configure`, `await expect(pull()/push()/sync()).rejects` with message matching `/configured/i`; `isConfigured()===false` pre, `true` post. | Spec text (oracle-free: rejection + substring). | None needed; behavioral assertion, not value oracle. Must reset module singleton between cases (re-configure + `clearState`). |
| **R2** push hands ciphertext only | PROP over seeded states: capture the `blob` passed to a spy `writeBlob`; assert `blob.ciphertext` contains NO contiguous byte-run of a seeded high-entropy sentinel, the literal `"reconciliation_links"`, seeded bank names/descriptions. Assert `{pushed:true,new_version,reason}`. | Oracle-free byte-search (INV2). | §11: long high-entropy unique sentinel so absence is meaningful; presence = definite leak. Encode sentinel as UTF-8 bytes AND check it isn't present as the JSON-serialized substring. |
| **R3** push threads OCC version | HIST + DIR: mock provider records `if_match_version` per `writeBlob`. (a) no remote (`statBlob`→null) ⇒ `if_match` omitted/undefined. (b) remote present ⇒ `if_match` === remote `version` from `statBlob`. (c) mock rejects stale `if_match` w/ `ConcurrentModificationError` ⇒ `push()` rejects (no silent overwrite). | Mock provider = literal transcription of sync-provider.md obligation #3. | §11: keep mock's OCC rule a faithful transcription (reject on stale, increment on accept). The mock is the oracle — a mock bug = correlated blind spot. Cross-check with an independent assertion on the recorded `if_match` value, not just on the thrown error. |
| **R4** pull applies / no-ops | DIR: `readBlob`→null ⇒ `{pulled:false}` and local state byte-identical before/after (serialize both, compare). `readBlob`→blob ⇒ decode+decrypt+deserialize+replace, `{pulled:true}`. **NOTE: R4 (unconditional apply) conflicts with spec point 1 (watermark-gated apply) — AMBIGUITY A1; the watermark branch is gated behind A1's resolution.** | Round-trip identity (safe oracle, §11). | §11: compare via store `serializeState` AND spot-check structural equality so a serializer bug can't mask a round-trip bug. |
| **R5** round-trip fidelity | PROP (generalized by INV1): seed arbitrary state → `push` → `clearState` → `pull` → restored == pre-push (value-equal incl. bigint). Provider in between sees only ciphertext. | decrypt∘encrypt = identity over state (round-trip, the §11-blessed safe oracle). | §11: equality basis = `serializeState` compare, PLUS independent structural deep-equal (don't let one function define both sides). bigint via `deepEqual`/`stringify` (`Nn` suffix). |
| **R6** sync resolves ONE conflict | HIST: mock that conflicts on the FIRST push then accepts the re-push ⇒ `SyncResult.conflict_resolved===true && pushed===true`. Non-`ConcurrentModificationError` (Network/Auth/Quota) ⇒ propagates, NOT swallowed, NOT reported resolved. **Double-conflict behavior gated behind AMBIGUITY A2.** | Consistency model: "pull-then-retry-once" from spec point 2 + contract R6. | §11 + Knight&Leveson: mock state machine is the oracle; transcribe spec point 2 literally. Distinguish "resolved once" from "looped" by counting `writeBlob` calls. |
| **R7** status stream | HIST/PROP: subscribe N listeners, record emissions. `pull` ⇒ sequence ends `pulling`…`idle`; `push` ⇒ `pushing`…`idle`; thrown error ⇒ `error` emitted. Unsubscribe ⇒ no further events to that listener; OTHER listeners still receive. | Spec text R7 + INV5 (sequence assertions, oracle-free). | Ordering of last-emitted vs promise-resolve is AMBIGUITY A3 — assert only what spec pins; record observed ordering. |
| **R8** sidecar well-formed, non-secret | PROP: capture pushed `blob.sidecar`; assert `kdf_algorithm==='PBKDF2-SHA-256'`, numeric `kdf_iterations`, `blob_version===BLOB_FORMAT_VERSION`, ISO-parseable `last_written_at`, string `last_writer_device`. Assert sidecar JSON contains NO seeded sentinel / no key material. | Spec text + INV2 byte-search applied to sidecar. | High-entropy sentinel reused from R2; ISO check via `!Number.isNaN(Date.parse(x))` AND a strict ISO regex. |
| **R-BF1** frame round-trips | PROP: for `b` of **valid length** and `v∈[0,2^32)`, `decode(encode(b,v))==={version:v, aesBlob byte-equal b}`; default `v===BLOB_FORMAT_VERSION`. **"valid length" is AMBIGUITY A4 — see probe: decode requires aesBlob ≥ 28 bytes; encode does NOT enforce this. Generator constrained to len≥28 once A4 resolved; also a META check encode→decode identity.** | encode/decode mutual inverse (round-trip, oracle-free) within the valid-length domain. | §11 MR soundness: constrain generator to the validity domain (aesBlob length ≥ min) so the round-trip MR holds for a correct impl; out-of-domain (short) inputs are tested separately as the FUZZ/throw path, not as round-trip. |
| **R-BF2** magic + version header | DIR + PROP: `encode` output starts with ASCII `MTRB` (0x4d54 5242), then 4-byte big-endian version, then aes blob. Decode reads same. | Hand-derived byte layout (golden bytes, oracle-free). | Confirmed by probe: header is `4d 54 52 42` + BE u32 version. Assert exact bytes. |
| **INV1** conservation across round-trip | PROP (superset of R5): multiset of imports & transactions out == in; no create/drop/dup/mutate; bigint amounts of any magnitude exact (incl. ±9_007_199_254_740_993n and beyond). | Multiset equality (conservation law, oracle-free). | The mandatory money-module conservation invariant. Compare as multisets (sort canonical) so ordering changes don't false-fail and reordering bugs are still caught by count+content. |
| **INV2** ciphertext opacity | PROP: covered by R2/R8 sentinel byte-search over EVERY seeded state. | Oracle-free byte search (Principle I). | §11: high-entropy sentinel; verify directly, never trust engine claim. |
| **INV3** decode total & safe | FUZZ: thousands of arbitrary `Uint8Array` (incl. byteOffset subarrays, huge, empty) ⇒ decode EITHER returns valid `{version,aesBlob}` OR throws `BlobCorruptError` (never generic Error, never null/garbage, never OOB, never hangs). Persist any failing seed to `tests/ivv/corpus/blob-format/`. | Oracle-free totality property (anomaly/fault-injection lens). | Assert thrown error is *instanceof* `BlobCorruptError` specifically; assert returns, when present, have `version` number + `aesBlob` Uint8Array. Wrap in a timeout guard to catch a hypothetical hang. |
| **INV4** version monotonicity through mock | HIST: repeated `push` against a mock that increments version on accept ⇒ strictly-increasing `new_version`; each push offers the latest observed version as `if_match` (no lost-update window). | Mock version-counter = oracle (transcribed obligation #3). | Same mock-correlation hazard as R3; assert monotonic sequence independently of the engine's own reporting. |
| **INV5** idle is resting state | HIST: after any successful `pull/push/sync`, LAST emitted status === `{state:'idle'}`; after a thrown error, LAST emitted === `{state:'error'}`. | Spec text INV5 (sequence assertion). | Subset of R7; ordering-vs-resolve subtlety = A3. |

**Stimulus generators (constrained-random, EXECUTE phase):**
- `arbPersistedState`: `{version:1, imports: ImportRecord[], reconciliation_links: ReconciliationLink[]}` with bigint amounts spanning small, MAX_SAFE_INTEGER±k, and very large magnitudes; embedded high-entropy sentinel in ≥1 description.
- `arbAesBlob`: `Uint8Array`, length ≥ 28 (valid-length domain) for R-BF1; full `[0, large]` length incl. 0 for INV3 fuzz.
- `arbVersion`: integer in `[0, 2^32)`.
- `arbBytes`: arbitrary `Uint8Array` + subarray-with-byteOffset wrapper for INV3.

**Independent reference model:** a second from-spec implementation of `encode/decodeBlobFrame`
(magic + BE-u32 + opaque payload, with the min-length rule once A4 is resolved) for the
blob-format scoreboard; and a from-spec mock `SyncProvider` state machine (OCC + version
counter) as the engine's concurrency oracle. The engine's *state round-trip* is checked by the
oracle-free round-trip identity, NOT by a re-implemented engine (encrypt/decrypt is a trusted
black box per §7, so an independent engine re-impl would add no independence over round-trip).

---

## 2. Functional cover points (drive to closure in EXECUTE)

| # | Cover point | Exercises |
|---|---|---|
| C1 | pull with no remote (`readBlob`→null) | R4 |
| C2 | pull with remote present (`readBlob`→blob) | R4, R5, INV1 |
| C3 | push with no remote (`statBlob`→null ⇒ `if_match` omitted) | R3, §6 first-sync |
| C4 | push with remote present (`if_match` === remote version) | R3, INV4 |
| C5 | conflict resolved exactly once (1st push conflicts, retry succeeds) | R6 |
| C6 | conflict then OTHER error (2nd push throws Network/Auth/Quota) propagates | R6, error contract §8 |
| C7 | double-conflict (2nd push ALSO ConcurrentModification) — observe loop vs single-retry | R6, A2 |
| C8 | non-conflict error on first push propagates (not reported resolved) | R6, §8 |
| C9 | empty local state round-trip | §6, R5, INV1, INV2 |
| C10 | large state round-trip (many imports, large bigint) | §6, R5, INV1 |
| C11 | decode bad-magic (long enough) | INV3, R-BF2 |
| C12 | decode too-short (< 8-byte header) | INV3, A4 |
| C13 | decode header-only (8 bytes, no payload) | INV3, §6, A4 |
| C14 | decode truncated AES (< 28-byte payload, ≥ header) | INV3, §6, A4 |
| C15 | decode subarray view (non-zero byteOffset) round-trip | R-BF1, §6 |
| C16 | decode empty array | INV3, §6 |
| C17 | encode/decode round-trip default version | R-BF1, R-BF2 |
| C18 | encode/decode round-trip explicit version (incl. 0 and 2^32−1) | R-BF1 |
| C19 | ciphertext opacity: sentinel absent from ciphertext | INV2, R2 |
| C20 | sidecar well-formed + non-secret | R8 |
| C21 | version monotonicity over repeated push | INV4 |
| C22 | single listener: pulling→idle / pushing→idle | R7, INV5 |
| C23 | multiple listeners all receive events | R7, §6 |
| C24 | unsubscribe stops one listener, others continue | R7, §6 |
| C25 | error path emits `{state:'error'}` then propagates | R7, INV5, §8 |
| C26 | not-configured pull/push/sync reject | R1, §8 |
| C27 | fuzz corpus: arbitrary bytes → BlobCorruptError-or-valid (totality) | INV3 |

Traceability: every R1–R8, R-BF1/2, INV1–INV5 maps to ≥1 cover point above
(R1→C26; R2→C19,C20; R3→C3,C4; R4→C1,C2; R5→C2,C9,C10; R6→C5–C8; R7→C22–C25;
R8→C20; R-BF1→C15,C17,C18; R-BF2→C11,C17; INV1→C2,C9,C10; INV2→C19; INV3→C11–C16,C27;
INV4→C21; INV5→C22,C25). **No requirement is unmapped.**

---

## 3. Enumerated spec-ambiguity list

> Each: exact quote + location, the two defensible readings, current black-box DUT
> behavior (probed via public calls only, or "not probed").

### A1 — pull-apply: unconditional (R4) vs watermark-gated (spec point 1)  **[HIGHEST PRIORITY]**
- **Contract R4** (`sync-engine.contract.md:103`): *"`pull()` calls `provider.readBlob()`. If it returns `null` … does NOT alter local state. **Otherwise** it decodes the frame, decrypts …, deserializes, replaces local state, and returns `{ pulled: true, … }`."* → apply whenever a blob exists.
- **Spec point 1** (`sync-provider.md:178`): *"On `pull`: **if** the remote blob's `last_written_at` is newer than the local SQLite's `last_synced_at` watermark, the local file is REPLACED by the decrypted remote. Local in-flight edits since the last push are LOST."* → apply only when remote strictly newer than the local watermark.
- **Reading A (unconditional):** any non-null remote blob replaces local; the watermark is informational only. Simple; matches R4 verbatim; makes R5/INV1 round-trip (push→clear→pull) deterministic.
- **Reading B (watermark-gated):** pull is a no-op (`pulled:false`) when remote `last_written_at` ≤ local `last_synced_at`; local is preserved. Matches spec point 1 and Principle XI's "source of truth, only replace when newer." Under B, R5's `push→clearState→pull` is sensitive to what the watermark is AFTER `clearState` (does clear reset the watermark? if not, a stale watermark could suppress the pull and break the round-trip test) — a *second-order* ambiguity (A1b).
- **Why it matters:** contract §2 says *"If this contract and a spec doc disagree, the spec wins and the disagreement is itself a finding."* This is precisely that disagreement. The two readings give opposite results for "remote exists but is not newer." It also changes how the R5/INV1 round-trip harness must be built (A1b: must `pull` see remote as "newer"?).
- **DUT behavior:** **not probed** — exercising `pull`'s apply/no-op decision requires standing up the full mock provider + crypto key + store + localStorage stub + watermark seeding, which is the expensive EXECUTE environment, not a cheap probe. Deferred to EXECUTE once resolved.
- **Recommended escalation:** human architect to reconcile R4 vs spec point 1, and clarify the watermark semantics after `clearState` (A1b).

### A2 — conflict recurrence on the re-push (single-retry vs loop)
- **Contract R6** (`:105`): *"recover by pulling the newer remote and re-pushing"* (singular). **§6** (`:125`): *"a provider that conflicts twice in a row is allowed to surface the second error (document whichever the engine does — single-retry vs loop — as observed behavior)."* **Spec point 2** (`sync-provider.md:179`): *"the engine MUST `pull` first, then re-attempt `push`."* (also singular, no loop stated).
- **Reading A (single-retry):** exactly one pull+retry; a second `ConcurrentModificationError` on the retry propagates out of `sync()`.
- **Reading B (bounded/unbounded loop):** keep pulling+retrying until success (or a bounded N).
- **Why it matters:** determines whether C7 expects a thrown error or eventual success; affects liveness (an unbounded loop against a perpetually-conflicting mock could hang the test).
- **DUT behavior:** **not probed** (same reason as A1 — needs the full EXECUTE harness).
- **Note:** contract §6 explicitly says to DOCUMENT observed behavior rather than fail — so this is LOW-severity (the contract pre-authorizes either). I will record observed behavior in EXECUTE; escalate only if observed behavior is an unbounded loop (a liveness bug).

### A3 — status-emission ordering relative to promise resolution (INV5 / R7)
- **Quote** INV5 (`:117`): *"After any successful `pull`/`push`/`sync` completes, the last emitted status is `{state:'idle'}`."* R7 (`:106`): *"During `pull()` the listener observes `{state:'pulling'}` then `{state:'idle'}`."*
- **Reading A:** the `idle`/`error` emission is synchronously emitted BEFORE the returned promise resolves/rejects — so a listener that awaits the promise is guaranteed to have already seen the terminal status.
- **Reading B:** "completes" means after the promise settles; the terminal `idle`/`error` may be emitted in the same microtask but ordering vs the awaiting caller is not pinned.
- **Why it matters:** the harness must know whether to assert the terminal status *immediately after* `await push()` (Reading A) or to drain microtasks first (Reading B). Mis-assuming A could produce a flaky false-positive failure.
- **DUT behavior:** **not probed** (needs full harness). I will write the assertion to be robust to both (await + microtask drain) and report the observed ordering; this is LOW severity (test-construction concern, not a spec defect) unless the terminal status is never emitted.

### A4 — R-BF1 "valid length" undefined; decode enforces an AES-GCM minimum the framing layer is said to be "opaque" to  **[MEDIUM PRIORITY]**
- **Quotes:** R-BF1 (`:108`): *"returns `{ version: v, aesBlob }` … for any `b` of **valid length** and any `v`."* §2 (`:24`): *"`blob-format` treats the AES blob as an **opaque byte string**."* §6 (`:124`) lists as throw-cases: *"header-only (no AES blob); … correct magic but truncated AES blob below the AES-GCM minimum."* INV3 (`:115`): decode *"either returns … or throws `BlobCorruptError`."*
- **PROBED black-box behavior (cheap, blob-format public fns only):**
  - Header is `MTRB`(4) + big-endian u32 version(4) = **8 bytes**; confirmed bytes `4d 54 52 42 00 00 00 01` for v=1.
  - `decodeBlobFrame` **requires the AES payload to be ≥ 28 bytes** (12-byte IV + 16-byte GCM tag). Sweep: payload len 0/1/16/27 → `BlobCorruptError "sync blob too short to contain header + IV + tag"`; len 28/29/32 → OK. So minimum total frame = **36 bytes**.
  - **Length check precedes magic check:** a too-short buffer with wrong magic reports *"too short"*, not *"bad magic"*; a long-enough buffer with wrong magic reports *"bad magic bytes (expected 'MTRB')"*.
  - **`encodeBlobFrame` does NOT enforce the minimum** — `encode(3-byte blob)` succeeds (11 bytes) but `decode` of that exact output THROWS. So encode/decode are inverse ONLY for aesBlob length ≥ 28; they are NOT inverse over all "encodable" inputs.
  - Subarray view (non-zero `byteOffset`) decodes correctly and byte-equal.
- **Reading A:** "valid length" in R-BF1 *means* "AES payload ≥ 28 (IV+tag)"; the round-trip guarantee is scoped to that domain, and the framing layer legitimately knows the GCM minimum. (Consistent with §6's throw-cases and the observed behavior.)
- **Reading B:** §2's "opaque byte string" implies framing should round-trip ANY byte length (a true opaque container), and the 28-byte gate is leakage of crypto-layer knowledge into the framing layer — i.e., `encodeBlobFrame(short)` producing something `decodeBlobFrame` rejects is an internal inconsistency.
- **Why it matters:** decides the R-BF1 generator's validity domain (constrain to len≥28 — Reading A) and whether `encode(short)→decode` should be filed as a discrepancy (Reading B). This is an MR-soundness issue: a round-trip MR over *all* lengths would falsely fail under the as-built DUT, so the generator MUST be bounded to the resolved validity domain.
- **Recommended escalation:** architect to confirm R-BF1's validity domain = "AES payload ≥ IV+tag (28 bytes)" and update R-BF1 wording (and decide whether `encodeBlobFrame` should symmetrically reject sub-minimum input, or it is acceptable that only `decode` guards). Likely Reading A is intended (matches §6), but the contradiction with §2 "opaque" needs a one-line spec confirmation.

### A5 — `configure` arity: `void` (contract §3) vs `Promise<void>` (spec sketch)  **[INFORMATIONAL — already adjudicated]**
- Contract §3 (`:30`) and §7 (`:134`) explicitly call this an accepted as-built simplification (`void`), while `sync-provider.md:133` shows `Promise<void>`. The contract pre-resolves this ("do not fail the run on it"). Listed only for completeness; **not** an open ambiguity. I will treat `configure` as synchronous `void`.

### A6 — empty-AES-blob handling vs §6 "header-only" (sub-case of A4)  **[LOW]**
- §6 lists "header-only (no AES blob)" as a throw-case, which is consistent with the probed 28-byte minimum (header-only = 0-length payload → throws). No separate resolution needed beyond A4; folded into A4. Recorded so it isn't mistaken for a distinct gap.

**Genuine open ambiguities requiring human escalation: A1 (high), A4 (medium).**
A2 and A3 are pre-authorized by the contract to be observed-and-documented (low); A5 is
already adjudicated; A6 folds into A4.

---

## 4. Independence audit

**Files I read:** `specs/001-money-tracker-mvp/verification/sync-engine.contract.md`;
`specs/001-money-tracker-mvp/contracts/sync-provider.md`;
`.specify/memory/constitution.md` (Principles I, XI excerpts);
`src/lib/sync/types.ts` (interface-only declarations + error taxonomy);
`src/lib/db/store.ts` **lines 1–60 only** (the documented `PersistedState`/`ImportRecord`
interface + doc-comments naming the public collaborator API per contract §3 — no engine logic);
`tests/_framework/scoreboard.ts` (reusable framework); `vitest.ivv.config.ts` (run config).

**Black-box probes (public functions called, no source read):** `blob-format.ts` exports
`encodeBlobFrame`, `decodeBlobFrame`, `BLOB_FORMAT_VERSION` — via two throwaway scripts under
`experiments/` that have been DELETED. Probe results recorded under A4. (A stack trace from a
thrown `BlobCorruptError` surfaced one internal line number/message string — observable error
output, not source I opened.)

**NOT read (independence preserved):** `src/lib/sync/sync-engine.ts`,
`src/lib/sync/blob-format.ts`, `src/lib/sync/drive-blob.ts`, and any test under
`tests/unit/sync/` or `tests/unit/independent/`. The Files-I-read list contains NO
implementation body and NO Designer test.
