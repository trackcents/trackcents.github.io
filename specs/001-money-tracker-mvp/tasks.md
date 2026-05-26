---
description: "Task list for Money Tracker v1 Foundation (P1 stories)"
---

# Tasks: Money Tracker v1 Foundation

**Input**: Design documents from `specs/001-money-tracker-mvp/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are INCLUDED in this plan because accuracy is constitutionally non-negotiable (Principle II) and parser correctness is the project's largest risk. Vitest unit tests + Playwright e2e tests gate every PR; golden-PDF fixtures gate every parser change.

**Organization**: Tasks are grouped by user story (US1–US5) so each story is independently implementable and testable. Phases are ordered for implementation-risk reduction (parser first, per the constitutional phasing rule), not by spec priority numbers (all five P1 stories share the same priority tier).

**Two pending user inputs**: tasks marked `chase-credit-card` need the user's most-used bank name (Phase 0 / US2). Tasks marked `[CC-ISSUER]` need the user's most-used credit-card issuer (Phase 1 / US3). These come from the anonymized sample statements the user supplies.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5). Setup/Foundational/Sync/Polish phases have no story label.
- Include exact file paths in descriptions
- Money is integer cents throughout; no floats anywhere

## Path Conventions

Single-project frontend web application. All source under `src/`, tests under `tests/`. PWA assets under `static/`. Spec-kit artifacts under `specs/` and `.specify/`. Paths in the task descriptions are relative to the repository root.

---

## Status reconciliation (2026-05-25)

Checkboxes below were reconciled against the actual codebase. Notable divergences from the original plan:

- **Persistence shipped as an OPFS-JSON store (`src/lib/db/store.ts`), not wa-sqlite.** The app persists today (drops survive reload), just not via SQLite. The wa-sqlite-specific tasks — **T065** (wa-sqlite client), the wa-sqlite form of **T067** (repository), and **T136** (FTS5 search) — remain OPEN, tracked as the **Phase 1B migration (#49)**.
- **Multiple credit-card adapters** (amex, bofa-credit-card, discover-credit-card, robinhood-credit-card, chase-credit-card, chase-checking) were built where the plan named a single `[CC-ISSUER]` placeholder — so the US3 adapter tasks are satisfied collectively.
- **US4 (reconciliation drill)** and **US5 (unified view)** are functionally live at `/statements/[hash]`, `/payments/...`, and `/transactions`.
- **Dedicated Playwright e2e specs are partial** — covered by `tests/e2e/{drop-pdf,user-flows}.spec.ts` rather than the per-story spec filenames named below; those remain open.
- ➡️ **US1 (Onboarding & Encryption, Phase 6) is the next unbuilt phase and is now IN PROGRESS** (starting with the crypto core: T106–T108).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the SvelteKit project, build tooling, and CI.

- [x] T001 Initialize SvelteKit project with `adapter-static` (SPA mode) using `pnpm create svelte` in repo root, accepting TypeScript + Svelte 5 + Vite defaults
- [x] T002 [P] Add Tailwind CSS 4 and configure `tailwind.config.js` + `src/app.css` with the project palette
- [x] T003 [P] Add shadcn-svelte component primitives via `pnpm dlx shadcn-svelte init` and seed `src/lib/ui/`
- [x] T004 [P] Configure TypeScript strict mode in `tsconfig.json` (strict: true, noImplicitAny, exactOptionalPropertyTypes)
- [x] T005 [P] Configure Prettier + ESLint in `.prettierrc.json` and `eslint.config.js` with rules: no-floating-decimal, no-implicit-coercion, no-undef
- [x] T006 [P] Configure Vitest in `vitest.config.ts` for unit testing under `tests/unit/`
- [x] T007 [P] Configure Playwright in `playwright.config.ts` for e2e under `tests/e2e/` (Chromium + WebKit projects)
- [x] T008 [P] Create GitHub Actions CI workflow at `.github/workflows/ci.yml` running `pnpm install && pnpm lint && pnpm test && pnpm test:e2e` on every PR
- [x] T009 [P] Create GitHub Actions deploy workflow at `.github/workflows/deploy.yml` publishing `build/` to GitHub Pages on push to `main`
- [x] T010 [P] Add `LICENSE` file at repo root containing AGPL-3.0 full text
- [x] T011 [P] Write `README.md` at repo root with project overview, links to spec.md / plan.md / constitution.md, and "How to anonymize statements" pointer to quickstart.md
- [x] T012 [P] Update `.gitignore` if needed; ensure `.claude/`, `*.env`, `*.pdf` (except `tests/fixtures/**/*.pdf`) are excluded

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Three-layer skeleton (adapters / db / app) and shared utilities that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T020 Create three-layer directory skeleton: `src/lib/adapters/`, `src/lib/db/`, `src/lib/app/`, `src/lib/crypto/`, `src/lib/sync/`, `src/lib/pdf/`, `src/lib/util/`, `src/components/`
- [x] T021 Define `BankAdapter` interface, `ParsedTransaction`, `ParsedStatement`, `ParseResult`, `PdfTextWithPositions`, `ParseError` types in `src/lib/adapters/types.ts` per `specs/001-money-tracker-mvp/contracts/bank-adapter.md`
- [x] T022 [P] Define repository contract types (`Account`, `Statement`, `Transaction`, `ReconciliationLink`, etc.) in `src/lib/db/types.ts` per `specs/001-money-tracker-mvp/contracts/storage-repository.md`
- [x] T023 [P] Define `SyncProvider`, `EncryptedBlob`, `BlobMetadata`, error taxonomy in `src/lib/sync/types.ts` per `specs/001-money-tracker-mvp/contracts/sync-provider.md`
- [x] T024 [P] Implement money utilities (parse `"$1,234.56"` → 123456 integer, BigInt sum) in `src/lib/util/money.ts`
- [x] T025 [P] Implement SHA-256 wrappers (file hash, normalized-description hash) in `src/lib/util/hash.ts`
- [x] T026 [P] Implement ULID generator in `src/lib/util/ulid.ts`
- [x] T027 [P] Implement ISO date helpers (parse / normalize / compare) in `src/lib/util/date.ts`
- [x] T028 Implement PDF.js extraction wrapper in `src/lib/pdf/extract.ts` returning `PdfTextWithPositions` with X/Y coordinates per `contracts/bank-adapter.md`. Cluster items by Y-coordinate (~3 pt tolerance) to recover visual row order — PDF.js returns items in content-stream order, NOT visual order (see research.md §R1 war story).
- [x] T029 Implement layout-aware extraction helpers (group items by Y → rows, then by X → columns, detect table header by regex) in `src/lib/adapters/_layout/table.ts`
- [x] T030 Implement bank detector with self-registration in `src/lib/adapters/detector.ts` exposing `detectAdapter()`, `registerAdapter()`, `listAdapters()`
- [x] T031 [P] Add ESLint custom rule forbidding imports from `src/lib/db/` or `src/lib/app/` inside files under `src/lib/adapters/` (enforces Principle VI layer separation)
- [x] T032 [P] Add ESLint custom rule forbidding floating-point literals in any file under `src/lib/adapters/`, `src/lib/db/`, `src/lib/app/`
- [x] T033 [P] Create test fixture directory structure `tests/fixtures/<bank>/` with a placeholder README explaining naming convention
- [x] T034 [P] Add `pnpm run gen:fixture <bank-slug>` script to `package.json` that runs the parser against `tests/fixtures/<bank-slug>/sample.pdf` and writes `expected.json`

**Checkpoint**: Foundation ready. User story implementation can now begin.

---

## Phase 3: User Story 2 (US2) — Bank Import 🎯 PHASE 0 OF v1 (MVP step 1)

**Goal**: Prove that we can parse one of the user's real bank statements end-to-end with 100% accuracy. This is the riskiest unknown in the project; everything else depends on it working.

**Independent Test**: Drop the user's anonymized real bank PDF on the bare drop-zone page. Every transaction matches the original PDF when spot-checked. The checksum banner shows GREEN (parsed sum equals printed totals to the cent).

### Tests for User Story 2

> Tests MUST be written and FAIL before implementation. Golden-fixture tests are mandatory per Principle VIII.

- [x] T040 [P] [US2] Write Vitest snapshot test scaffold at `tests/unit/adapters/chase-credit-card.test.ts` asserting that parsing `tests/fixtures/chase-credit-card/sample.pdf` matches `expected.json` byte-for-byte
- [x] T041 [P] [US2] Write Vitest tests at `tests/unit/app/checksum.test.ts` covering: Level A success/failure, Level B success/failure, Level C success/failure, Level D-only refused as "insufficient verification", multi-level agreement (A+B both pass), and one-level-disagreement refusal (A passes but B fails → refused with diff)
- [ ] T042 [P] [US2] Write Playwright e2e test scaffold at `tests/e2e/phase0-import.spec.ts` — drop the fixture PDF, expect a GREEN banner and N table rows

### Implementation for User Story 2

- [x] T043 [US2] Create the Phase 0 entry route at `src/routes/+page.svelte` with a single drop zone (no DB, no auth yet)
- [x] T044 [P] [US2] Build `PdfDropZone.svelte` component at `src/components/PdfDropZone.svelte` per `contracts/pdf-intake.md` (drag-drop, file picker, magic-byte sniff, sequential file handling)
- [x] T045 [US2] Implement adapter for chase-credit-card at `src/lib/adapters/chase-credit-card/adapter.ts` implementing `BankAdapter` interface (detect, parse, version, name)
- [x] T046 [US2] Add anonymized fixture at `tests/fixtures/chase-credit-card/sample.pdf` and seed `tests/fixtures/chase-credit-card/expected.json` by running `pnpm run gen:fixture chase-credit-card`
- [x] T047 [US2] Implement the **multi-level checksum gate** in `src/lib/app/checksum.ts` per research.md §R13. Run every level the adapter populated (A: opening + closing balance; B: aggregate totals; C: CC balance equation; D: count). Require at least one of A/B/C to pass; all populated levels must agree. Return the `checksum_strategy_used` string (e.g. `"A+B"`) on success, or a level-specific diff message on failure. Level D alone is never sufficient.
- [x] T048 [P] [US2] Build `TransactionTable.svelte` (Phase 0 version — no virtualization yet) at `src/components/TransactionTable.svelte` showing date / description / amount
- [x] T049 [P] [US2] Build `ChecksumDiff.svelte` at `src/components/ChecksumDiff.svelte` with red/yellow/green states + diff display per `contracts/pdf-intake.md` state machine
- [x] T050 [US2] Implement Phase 0 orchestration in `src/lib/app/import.ts` (read bytes → hash → extract → detect → parse → checksum → render in-memory; no persistence yet)
- [x] T051 [P] [US2] Register the chase-credit-card adapter in `src/lib/adapters/index.ts` (calls `registerAdapter(...)` at module load)
- [x] T052 [US2] Wire the route to the orchestration: drop event → `importStatement()` → state-driven UI updates per the contract

**Checkpoint**: Phase 0 of v1 complete. Stop and validate: open the page, drop your real PDF, see the GREEN banner and accurate transactions. If it doesn't work, fix the adapter before proceeding. Per quickstart.md smoke-test list.

---

## Phase 4: User Story 3 (US3) — Credit Card Import

**Goal**: Same drop-and-parse flow but for credit card statements, persisting both bank and CC transactions to a real SQLite database with proper provenance and idempotency.

**Independent Test**: Drop a CC PDF; transactions appear with `account_type = 'credit_card'`; the account's nickname / last 4 are visible; checksum matches; re-dropping the same PDF does not duplicate transactions.

### Tests for User Story 3

- [ ] T060 [P] [US3] Write Vitest unit tests for repository at `tests/unit/db/repository.test.ts` covering `insertStatement`, `bulkInsertTransactions`, idempotency, foreign keys, and `markStatementRefused`
- [x] T061 [P] [US3] Write Vitest snapshot test for [CC-ISSUER] adapter at `tests/unit/adapters/[CC-ISSUER].test.ts`
- [ ] T062 [P] [US3] Write Playwright e2e at `tests/e2e/cc-import.spec.ts` — import bank then CC; confirm both appear with correct account_type in unified store; re-drop same CC; confirm no duplicates

### Implementation for User Story 3

- [x] T063 [US3] Author SQL schema in `src/lib/db/schema.sql` exactly matching `specs/001-money-tracker-mvp/data-model.md` (all 7 tables, CHECK constraints, FTS5 virtual table)
- [x] T064 [US3] Create initial migration at `src/lib/db/migrations/0001_initial.sql` (the contents of schema.sql plus initial inserts to `user_settings` and `schema_migrations`)
- [ ] T065 [US3] Implement wa-sqlite client bootstrap in `src/lib/db/client.ts` (OPFS VFS primary, IndexedDB VFS fallback, migration application on first open)
- [x] T066 [P] [US3] Generate / hand-write TypeScript types from schema in `src/lib/db/types.ts`
- [ ] T067 [US3] Implement all repository functions in `src/lib/db/repository.ts` per `contracts/storage-repository.md` (account ops, statement ops, transaction bulk insert with idempotency dedup, link ops, settings, encryption metadata)
- [x] T068 [US3] Refactor `src/lib/app/import.ts` to persist via the repository in a single SQLite transaction (replaces the Phase 0 in-memory path)
- [ ] T069 [P] [US3] Build `AccountNicknamePrompt.svelte` at `src/components/AccountNicknamePrompt.svelte` (first-seen account → modal asking for nickname, with suggested default from adapter)
- [x] T070 [US3] Implement adapter for [CC-ISSUER] at `src/lib/adapters/[CC-ISSUER]/adapter.ts` (must invert amount sign per `contracts/bank-adapter.md` convention)
- [ ] T071 [US3] Add CC fixture at `tests/fixtures/[CC-ISSUER]/sample.pdf` and seed `tests/fixtures/[CC-ISSUER]/expected.json` via `pnpm run gen:fixture [CC-ISSUER]`
- [x] T072 [P] [US3] Register [CC-ISSUER] adapter in `src/lib/adapters/index.ts`
- [x] T073 [US3] Update the route to handle both adapters: drop any PDF, route through detector, persist correctly, surface success banner with inserted/skipped counts

**Checkpoint**: Persistence layer working. Bank + CC imports stored idempotently. Phase 1 of v1 substantially complete.

---

## Phase 5: User Story 4 (US4) — Reconciliation Drill-Through 🎯 SIGNATURE FEATURE

**Goal**: User clicks a bank "PAYMENT TO BOFA CC -$800" row and sees the credit card transactions that $800 paid off, drawn from the matching CC statement.

**Independent Test**: With one bank statement and the matching CC statement imported, clicking the bank CC-payment row navigates to a page listing every line item on the CC statement that was paid by that $800.

### Tests for User Story 4

- [x] T080 [P] [US4] Write Vitest unit tests for reconciliation matcher at `tests/unit/app/reconciliation.test.ts` covering auto-match success, no-match, multi-match disambiguation, date window edge cases, and manual-override precedence (21 tests, includes cross-bank coverage)
- [ ] T081 [P] [US4] Write Playwright e2e at `tests/e2e/reconciliation.spec.ts` — import bank + matching CC; click CC-payment row; verify drill-through page shows CC transactions

### Implementation for User Story 4

- [x] T082 [US4] Implement reconciliation matching algorithm in `src/lib/app/reconciliation.ts` per `research.md §R12` (card identifier + amount + date window; auto-link when exactly one match, store with link_type='auto' and confidence_score) — done in-memory; persistence via repository link table is task T083 / #43
- [x] T083 [US4] Wire reconciliation into `src/lib/app/import.ts`: after CC statements with `payment_to_card` linked from bank side are imported, run `reconcileNewPayments()`; also re-run when new CC statements arrive in case they match pre-existing bank payments
- [x] T084 [US4] Create statement detail route at `src/routes/statements/[id]/+page.svelte` rendering all transactions for that statement with source metadata
- [x] T085 [US4] Add drill-through link from each `transaction_type='payment_to_card'` row in the bank-side view to the linked CC statement page, OR an "import the matching CC statement" CTA per `FR-034`
- [x] T086 [P] [US4] Build `ReconciliationLinkBadge.svelte` at `src/components/ReconciliationLinkBadge.svelte` showing link_type and confidence_score for transparency
- [ ] T087 [P] [US4] Build manual-link UI at `src/components/ManualLinkPicker.svelte` letting the user assign an unmatched bank-payment row to a specific CC statement (writes a `link_type='manual'` row)
- [ ] T088 [P] [US4] Build `NoMatchingStatementCard.svelte` for the empty state when no CC statement has been imported yet

**Checkpoint**: The signature feature works end-to-end with one-click drill. Phase 1 of v1 complete.

---

## Phase 6: User Story 1 (US1) — Onboarding & Encryption

**Goal**: First-run setup flow with Google sign-in, encryption passphrase, iOS install nudge. Local SQLite is now encrypted at rest with a user-controlled key.

**Independent Test**: Fresh user on Android Chrome / iOS Safari (after Add-to-Home-Screen) / desktop Chrome can complete onboarding and reach the "ready to import" state. Reopening the app prompts for passphrase only; correct passphrase decrypts the local cache.

### Tests for User Story 1

- [x] T100 [P] [US1] Write Vitest unit tests for `src/lib/crypto/kdf.ts` and `src/lib/crypto/aes.ts` at `tests/unit/crypto/kdf.test.ts` and `tests/unit/crypto/aes.test.ts` (derive-then-encrypt round-trip, known-answer vectors)
- [ ] T101 [P] [US1] Write Playwright e2e at `tests/e2e/onboarding.spec.ts` — simulate iOS Safari non-standalone; verify onboarding blocks until standalone; complete passphrase setup; reach ready state
- [ ] T102 [P] [US1] Write Playwright e2e at `tests/e2e/onboarding-returning.spec.ts` — complete onboarding; reload; verify passphrase-only prompt and successful decrypt

### Implementation for User Story 1

- [x] T103 [P] [US1] Generate PWA manifest at `static/manifest.webmanifest` with `start_url`, `display: standalone`, name, theme/background colors
- [x] T104 [P] [US1] Create PWA icon set at `static/icons/` (192px, 512px, maskable variants)
- [x] T105 [US1] Implement service worker at `src/service-worker.ts` caching the app shell (HTML/CSS/JS bundle, PDF.js worker, manifest, icons) for offline use; network-first for the Drive sync API, cache-first for all other assets
- [x] T106 [P] [US1] Implement PBKDF2-SHA-256 KDF wrapper at `src/lib/crypto/kdf.ts` (600,000 iterations, configurable for tests)
- [x] T107 [P] [US1] Implement AES-256-GCM encrypt/decrypt wrappers at `src/lib/crypto/aes.ts` (random IV per encrypt, returns IV+ciphertext+tag concatenated)
- [x] T108 [P] [US1] Implement salt management at `src/lib/crypto/salt.ts` (generate 16-byte random at first setup; persist via `repository.initializeEncryptionMetadata`)
- [x] T109 [US1] Implement local-DB encryption-at-rest in `src/lib/db/client.ts` (encrypt SQLite file on save / decrypt on load; key held in memory only)
- [x] T110 [P] [US1] Implement Google OAuth via Google Identity Services at `src/lib/sync/drive-auth.ts` requesting only `drive.file` scope; expose `signIn()`, `signOut()`, `getAccessToken()`
- [x] T111 [P] [US1] Build `PassphraseSetup.svelte` at `src/components/PassphraseSetup.svelte` with real-time strength meter (zxcvbn-ts) and minimum-strength gate
- [x] T112 [P] [US1] Build `IosInstallNudge.svelte` at `src/components/IosInstallNudge.svelte` with an animated Share→Add-to-Home-Screen guide; detects `display-mode: standalone` and dismisses itself (wired into onboarding `install` step; auto-advances on standalone relaunch)
- [x] T113 [US1] Implement iOS Safari detection + standalone-mode gate at `src/lib/app/platform.ts` (UA sniff + `window.matchMedia('(display-mode: standalone)')`)
- [x] T114 [US1] Create onboarding route at `src/routes/onboarding/+page.svelte` orchestrating: platform-check → install nudge (iOS only) → Google sign-in → passphrase setup → optional recovery code → ready
- [ ] T115 [P] [US1] Implement optional recovery code generation + encrypted-sidecar storage at `src/lib/crypto/recovery.ts`
- [x] T116 [US1] Add returning-user passphrase prompt at app launch: read cached salt → prompt for passphrase → derive key → attempt decrypt of local DB; on failure, show "wrong passphrase" without leaking timing info

**Checkpoint**: App is a real PWA. Local data is encrypted at rest. Onboarding works on all three target platforms. Phase 2 of v1 substantially complete.

---

## Phase 7: User Story 5 (US5) — Unified Searchable Filterable View

**Goal**: One chronological list of every transaction across all imported accounts with composable filters (account, date, amount) and full-text search across descriptions.

**Independent Test**: With statements from 2+ accounts imported, the unified view shows all transactions sorted by date; filtering by account narrows correctly; searching for a known merchant returns the right rows; clicking a row shows transaction detail with provenance.

### Tests for User Story 5

- [x] T130 [P] [US5] Write Vitest unit tests for search/filter logic at `tests/unit/app/search.test.ts` covering composed filters, FTS query escaping, pagination
- [ ] T131 [P] [US5] Write Playwright e2e at `tests/e2e/unified-view.spec.ts` — import 2 accounts; verify unified list, account filter, search, date range, amount range, sort, and detail-drawer

### Implementation for User Story 5

- [x] T132 [US5] Create unified transactions route at `src/routes/transactions/+page.svelte`
- [ ] T133 [P] [US5] Upgrade `src/components/TransactionTable.svelte` to handle 10,000+ rows via row virtualization (svelte-virtual-list or custom IntersectionObserver)
- [x] T134 [P] [US5] Build `FilterBar.svelte` at `src/components/FilterBar.svelte` with account multi-select, date-range picker, amount-range inputs, and a debounced search box
- [x] T135 [P] [US5] Implement composed search/filter service in `src/lib/app/search.ts` calling `repository.listTransactions()` with combined predicates and FTS5 MATCH for description text
- [ ] T136 [US5] Wire `transactions_fts` virtual table to repository: triggers keep it in sync with `transactions` table on insert/update
- [ ] T137 [P] [US5] Add column-header click-to-sort with asc/desc toggle in `TransactionTable.svelte`
- [ ] T138 [P] [US5] Build `TransactionDetailDrawer.svelte` at `src/components/TransactionDetailDrawer.svelte` showing all 9 provenance fields per FR-045 (raw_text, parser_name, parser_version, pdf_source_hash, etc.)
- [ ] T139 [P] [US5] Add "View source PDF hash" affordance in the detail drawer per FR-055

**Checkpoint**: All 5 P1 user stories are functional end-to-end on a single device. v1 is feature-complete except for cross-device sync.

---

## Phase 8: Cross-Cutting — Google Drive Sync

**Purpose**: Multi-device sync via the user's own Google Drive folder. Encrypted blob is source of truth; local SQLite is rebuildable cache. This phase has no story label because sync benefits every user story rather than being one of them.

**Note**: The spec categorizes multi-device sync as US-P2-C (target v1.1), but the constitution lists Google Drive sync as Phase 3 of v1. We resolve this by shipping sync in v1 to honor the constitution; without sync the app is single-device-only and the friend-sharing story is degraded. Each of the 5 P1 stories remains independently usable without sync.

### Tests for Sync

- [ ] T150 [P] Write Vitest unit tests for encrypted-blob framing (magic bytes, version, IV, ciphertext, GCM tag) at `tests/unit/sync/blob-format.test.ts`
- [ ] T151 [P] Write Vitest unit tests for sync-engine state transitions at `tests/unit/sync/sync-engine.test.ts` covering pull / push / conflict / network-down paths
- [ ] T152 [P] Write Playwright e2e at `tests/e2e/sync.spec.ts` using two browser profiles — import on A, sync, open on B, verify data appears

### Implementation for Sync

- [x] T153 Implement EncryptedBlob framing in `src/lib/sync/blob-format.ts` (encode/decode with magic 'MTRB', version, IV, ciphertext, GCM tag per `contracts/sync-provider.md`) — 100% coverage
- [x] T154 Implement `GoogleDriveProvider` at `src/lib/sync/drive-blob.ts` per `contracts/sync-provider.md` (folder-on-first-use, readBlob, writeBlob with optimistic-concurrency version check, statBlob, error taxonomy). ⚠️ Type-checks + follows Drive v3 REST contract, but the live network calls are NOT yet verified against the real Drive API — needs a browser run (user-gated).
- [x] T155 Implement `SyncEngine` at `src/lib/sync/sync-engine.ts` (configure, pull, push, sync, onStatusChange) with sync-authoritative conflict resolution (pull-then-re-push on ConcurrentModificationError) — tested with in-memory MockProvider
- [x] T156 Wire on-app-close push trigger via `visibilitychange` and `pagehide` events at `src/lib/sync/triggers.ts` (gated on engine being configured; 5/5 tests). Glue in `src/lib/sync/sync-controller.ts` (`initSyncIfReady`/`triggerSync`/`teardownSync`).
- [x] T157 [P] Build `SyncStatusIndicator.svelte` at `src/components/SyncStatusIndicator.svelte` showing idle / pulling / pushing / conflict / error states; mounted in `+layout.svelte` header, renders only once sync is configured
- [x] T158 [P] Add "Sync now" manual button (in `SyncStatusIndicator.svelte`) bound to `triggerSync()` (signs in on first use via GIS, then runs `SyncEngine.sync()`)
- [x] T159 Document Google OAuth project setup at `docs/setup-google-drive.md` (create GCP project, enable Drive API, create OAuth client ID, configure consent screen, `drive.file` scope)
- [x] T160 Add `PUBLIC_GOOGLE_OAUTH_CLIENT_ID` env var handling in `src/lib/sync/drive-auth.ts`; document in README and `.env.example`

**Checkpoint**: Sync working between user's devices. v1 is shippable.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, accessibility, CI guards, and manual smoke-test sign-off.

- [ ] T170 [P] Accessibility audit on all routes: keyboard navigation across drop zone, table, drawer, modals; screen-reader labels; `aria-live` regions for import progress; pass `pnpm test:a11y` (axe-core)
- [ ] T171 [P] Add CI guard in `.github/workflows/ci.yml` failing the build if production bundle exceeds 5 MB (`@web/bundle-size`)
- [ ] T172 [P] Add CI guard scanning the runtime asset graph for forbidden third-party fetches (Google Fonts, analytics SDKs); fail PR if any external host appears
- [ ] T173 [P] Add CI guard scanning `package.json` dependency tree for known analytics/telemetry packages (deny list); fail PR if any present
- [ ] T174 [P] Run Lighthouse CI; ensure PWA installability score is 100/100; fix any issues blocking install prompt
- [ ] T175 [P] Write `docs/SUPPORTED_BANKS.md` listing every supported bank, the fixture date, and the one-statement validation procedure
- [ ] T176 [P] Write `CONTRIBUTING.md` covering anonymization workflow, fixture management process, AGPL compliance for parser donations
- [ ] T177 [P] Write `SECURITY.md` (responsible disclosure email + scope)
- [ ] T178 [P] Add an `.env.example` at repo root listing required env vars (`PUBLIC_GOOGLE_OAUTH_CLIENT_ID`)
- [ ] T179 Manual smoke test on Phase 0: drop a real bank PDF on `pnpm dev`, verify GREEN banner and accurate transactions per `quickstart.md` smoke-test checklist
- [ ] T180 Manual smoke test on the full v1 user journey: onboarding → bank import → CC import → reconciliation drill → unified view → sync to second device, on Android Chrome, iOS Safari (post-install), and desktop Chrome
- [ ] T181 Configure custom domain on GitHub Pages (optional, only if user has one)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
- **US2 / Phase 3**: Depends on Foundational only. Must complete before any other story starts — this is the parser-validation gate.
- **US3 / Phase 4**: Depends on US2 (uses the same adapter machinery and adds DB persistence).
- **US4 / Phase 5**: Depends on US3 (needs CC statements in the DB to reconcile against).
- **US1 / Phase 6**: Depends on US3 (needs the repository to wrap with encryption-at-rest). Can be developed in parallel with US4 if desired but most easily after.
- **US5 / Phase 7**: Depends on US3 (needs DB persistence and FTS infrastructure).
- **Sync / Phase 8**: Depends on US1 (needs encryption layer and Google OAuth) and US3 (needs SQLite file to encrypt as blob).
- **Polish / Phase 9**: Depends on all of the above.

### Within Each User Story

- Tests are written FIRST (T040/T041/T042 before T043, etc.) and MUST fail before the implementation lands.
- Repository contracts (T067) before any feature that persists (T068+).
- Models / schema (T063) before services / repository (T067) before UI components.

### Parallel Opportunities

- All [P]-marked Setup tasks (T002-T012) can run in parallel after T001.
- All [P]-marked Foundational tasks (T022-T034 except T028→T029→T030 chain) can run in parallel.
- Within each user story, all [P]-marked tasks can run in parallel.
- US4 and US1 can be worked in parallel if two parallel work streams exist.

### Critical Path (longest sequential chain)

T001 → T020 → T021 → T028 → T029 → T030 (adapter foundation)
→ T045 → T046 → T050 → T052 (US2: prove parsing)
→ T063 → T065 → T067 → T068 (US3: persistence)
→ T082 → T083 (US4: reconciliation)
→ T106 → T107 → T109 (US1: encryption-at-rest)
→ T154 → T155 (Sync)
→ T179 → T180 (smoke tests)

Roughly **6 weeks** of focused solo-developer work as estimated in plan.md.

---

## Synthetic data strategy (2026-05-23)

Per user feedback 2026-05-23, **validation does NOT require the user to supply ever-larger amounts of real data.** We have enough real anonymized PDFs (Chase × 4 statements, Amex × 2, BofA × 2, Discover × 2, Robinhood × 2) to validate the parser against actual layouts. Beyond that point, additional confidence comes from **programmatically-generated synthetic statements** that cover edge cases real data may never hit:

- Sign-convention quirks (`-$100`, `($100)`, `100-`, `($ 100.50 )`)
- Sub-$1 amounts (`$0.05`, `.50`)
- Foreign-currency markers (e.g., `USD 100.00 @ 0.92 EUR`)
- Refunds linked to the original purchase (same merchant, partial vs full)
- Multi-line transaction descriptions (airline itinerary, hotel folio)
- Same-merchant same-day duplicates (separate $1.00 NSF reauthorizations)
- Year-boundary periods (`12/28 - 01/27` spanning a year)
- Leap-year dates (Feb 29 in 2024)
- Cash advances + balance transfers (separate APR sections)
- Late fees, annual fees, over-limit fees, returned-payment fees
- Multiple interest charges at different rates (purchase APR vs cash-advance APR)
- Statement credits, cashback rewards redemptions
- Disputed / chargeback / reversed transactions
- Authorized-user purchases (multiple buyers on one card)
- Very large amounts (≥ $10,000) and very small amounts ($0.01)
- Long merchant names that span the description column
- Special characters in merchant names (`café`, `& Co`, `LLC.`, `#42`)

The synthetic data layer is two related but distinct deliverables:

1. **Edge-case fixture library** — one synthetic `ImportSuccess` per edge case, used by adapter and matcher unit tests.
2. **Volume-scale generator** — produces N realistic transactions for UI stress tests (e.g., proves the unified view renders quickly at 5,000 transactions; informs the virtualization decision empirically, not by guesswork).

Research source: industry reference materials on CC statement composition (CFPB regulations, FCBA Schumer Box requirements, issuer billing-statement design documents) — see new task #58 for the research deliverable.

### MVP-of-MVP (Phase 0 only — the parser proof)

1. Complete Phase 1 (Setup, ~3 days).
2. Complete Phase 2 (Foundational, ~3 days).
3. Complete Phase 3 (US2 only — Bank Import, ~3-5 days).
4. **STOP and validate**: drop the user's real PDF; checksum GREEN; transactions correct.
5. If validation fails, do not proceed. The project is unviable on this stack until parsing works.

If Phase 0 succeeds, the rest is mechanical — none of Phase 4-8 carries unknown risk comparable to parsing.

### Incremental Delivery (post Phase 0)

1. Phase 4 (US3 CC Import) → demo: "I can see both my bank and CC transactions."
2. Phase 5 (US4 Reconciliation) → demo: "I can drill from a CC payment to what those $X bought." **This is the signature feature; v1 is meaningful even without onboarding and sync.**
3. Phase 6 (US1 Onboarding + Encryption) → demo: "Friends can use it safely."
4. Phase 7 (US5 Unified View) → demo: "I can search and filter across all accounts."
5. Phase 8 (Sync) → demo: "My data syncs to my laptop."
6. Phase 9 (Polish) → ship to the friends.

### Pause Points (when the user MUST be involved)

- **Before T045** (US2 implementation): user must send one anonymized bank statement to define chase-credit-card.
- **Before T070** (US3 implementation): user must send one anonymized credit card statement to define [CC-ISSUER].
- **Before T180** (final smoke test): user must run the full journey on their real devices.

---

## Notes

- [P] tasks = different files, no dependencies on other in-flight work.
- Story labels [US1]–[US5] map directly to the user stories in `spec.md`.
- Every adapter task assumes the user has provided the anonymized real statement; until then, those tasks are blocked on user input rather than on engineering work.
- After every task or logical group, commit. Per constitution governance, every PR must include or update the relevant golden-PDF fixture if the parser touches it.
- The checksum invariant tests (T041 and equivalent for every adapter) are non-negotiable per Principle II.
