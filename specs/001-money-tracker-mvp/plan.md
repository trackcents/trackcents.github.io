# Implementation Plan: Money Tracker v1 Foundation (P1 stories only)

**Branch**: `001-money-tracker-mvp` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-money-tracker-mvp/spec.md`

## Summary

Implement the P1 MVP scope of the Money Management Tool: a static PWA that lets the user drop bank and credit card PDF statements, parses them deterministically with checksum-validated accuracy, stores transactions in a local SQLite-WASM database with full source provenance, lets the user drill from a "payment to credit card" bank transaction to the actual transactions on that credit card statement, and presents a unified searchable view across all imported accounts. Encryption, Google Drive sync, and onboarding flows are included in v1 but layered after parsing is proven.

This plan covers only the 5 P1 user stories (US-P1-A through US-P1-E). P2/P3/P4 stories are explicitly out of scope for v1 — they become separate feature branches in future iterations.

**Within v1, work is further phased** to de-risk the riskiest unknown first:

- **Phase 0 (v1)**: Parser proof-of-concept. Single HTML page + PDF.js + ONE bank's adapter + checksum gate. No database, no UI polish, no encryption, no sync. *Goal: prove parsing works on one of the user's real banks.*
- **Phase 1 (v1)**: SQLite-WASM schema and persistence; second bank adapter (a credit card); reconciliation drill-through (US-P1-D); idempotency.
- **Phase 2 (v1)**: PWA wrapper (service worker, manifest, OPFS persistence); encryption layer (Web Crypto API + PBKDF2); onboarding flow (US-P1-A); unified searchable view (US-P1-E).
- **Phase 3 (v1)**: Google Drive sync (user's own Drive, encrypted blob, sync-authoritative).

P2 features (categorization, dashboards, paycheck-to-bills budget) and beyond are explicitly excluded from this plan.

### Adapter development workflow — sample-first, real-data-later

Once Phase 0 began we learned that the "official sample PDFs" banks publish (Chase, Bank of America) are **marketing/educational documents**, not clean fixture data — they tend to be either summary-only (Chase's is a single-page summary card with no transaction listing) or heavily annotated multi-account marketing layouts (BoA's). They are useful but partial.

The pragmatic workflow that resulted, applied to every bank:

1. **If an official sample exists** — download it, write the adapter against whatever fields it *does* cover (typically the Account Summary box, statement period, account-last-4). Commit the sample as the initial fixture. Adapter ships at version `0.1.0` covering partial parsing only.
2. **For the transaction listing** — wait for the user to supply ONE anonymized real statement. The transaction-parsing logic is added in a follow-up adapter version (typically `0.2.0`). The anonymized real statement replaces or supplements the partial sample as the regression fixture.
3. **A bank is "supported" per [Constitution Principle VIII](../../.specify/memory/constitution.md#viii-one-statement-validation-per-bank)** only once both the Account Summary AND the transaction listing parse correctly against a real statement (anonymized) with the multi-level checksum gate passing.

Banks without official sample PDFs (American Express, Discover) skip step 1 and go directly to the anonymized-real-statement workflow.

This is a deviation from the original plan, which assumed bank-published samples would be complete. Documenting it here so future contributors understand why some `tests/fixtures/<bank>/sample.pdf` files are marketing-only and what they're used to test.

### Validation strategy — synthetic data over volume (added 2026-05-23)

Per user feedback, **we do NOT ask the user for ever-more real data to validate features.** One anonymized statement per bank is enough to prove the parser handles that bank's layout. Beyond that, additional coverage — edge cases, transaction-type permutations, large-volume UI stress tests — comes from **programmatically-generated synthetic statements** (task #58).

The synthetic generator covers:

- **Edge-case fixture library** — one synthetic `ImportSuccess` per real-world quirk (sign conventions, sub-$1 amounts, foreign currency, refunds, multi-line descriptions, year-boundary periods, leap-year dates, cash advances, balance transfers, every fee type, multiple APR interest, statement credits, disputed/reversed, authorized users, special chars in merchant names, very large / very small amounts).
- **Volume-scale generator** — produces N realistic transactions for UI stress tests, e.g., to empirically decide whether the unified view needs virtualization at 5,000 rows.

This means: the user's job is to supply ONE anonymized real statement per new bank. The synthetic generator handles the rest. Research source for what to put on synthetic statements: CFPB Regulation Z (12 CFR §1026.7), FCBA Schumer Box requirements, issuer billing-statement design documentation.

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode required). TypeScript-only. No Python runtime in the browser.

**Primary Dependencies**:
- Svelte 5 (pinned to latest stable minor for year 1) + SvelteKit in SPA mode (`adapter-static`).
- Tailwind CSS 4 + shadcn-svelte component primitives.
- ECharts 6 for charts (lazy-loaded in Phase 2+ only; not in Phase 0).
- PDF.js (Mozilla, Apache-2.0) for PDF text extraction with X/Y positions — the SOLE PDF engine.
- wa-sqlite for SQLite-WASM with OPFS VFS; IndexedDB VFS fallback for browsers without OPFS.
- Web Crypto API (built into the browser) for AES-256-GCM and PBKDF2-SHA-256.
- Google API JavaScript client (gapi / GIS) for Drive OAuth and folder-scoped file access.
- **Monopoly's GitHub repo is used as a REFERENCE for per-bank patterns** (regex anchors, sign conventions), re-implemented in TypeScript on top of PDF.js. Monopoly itself is NOT imported or invoked at runtime — it depends on the `pdftotext` C++ binary which cannot run inside Pyodide.

**Storage**:
- Primary local store: SQLite database in OPFS (Origin Private File System) via wa-sqlite. Single `.sqlite` file per user.
- Fallback local store: IndexedDB VFS on browsers without OPFS support.
- Sync target (Phase 3): Encrypted blob in the user's own Google Drive folder (single dedicated folder, user-granted scope).

**Testing**:
- Vitest for unit tests (parsers, schema helpers, crypto wrappers, reconciliation matchers).
- Playwright for end-to-end browser tests (drop PDF → see transactions; passphrase flow; drill-through navigation).
- Golden-PDF fixtures: one anonymized real statement per supported bank, with expected parsed JSON. Snapshot tests compare parser output against expected JSON; checksum invariant tests assert sum-equals-printed-total.

**Target Platform**:
- Static Progressive Web App served from GitHub Pages over HTTPS.
- Browser support: latest 2 versions of Chrome, Edge, Firefox, Safari. iOS Safari 17+ for OPFS. Android Chrome.
- No backend.

**Project Type**: Single-project frontend web application (Option 1 below). No separate backend or mobile codebase.

**Performance Goals**:
- Initial bundled assets (HTML + JS + CSS + fonts + icons): < 5 MB compressed.
- PDF parse + checksum validation: < 2 seconds per typical 5-page statement on a 2020-era laptop.
- Transaction list view: render 10,000 transactions smoothly with virtualization (no full-list re-render on filter change).
- Offline cold start: < 3 seconds to interactive after service worker cache hit.

**Constraints**:
- Offline-capable for parsing and viewing existing data (no network needed after first load).
- Zero analytics, telemetry, or third-party tracking.
- All runtime assets same-origin or bundled.
- $0/month operating cost at steady state.
- No floating-point arithmetic for money — integer cents (BigInt for sums > 2^53).
- Checksum gate enforced on every statement import; no silent partial inserts.

**Scale/Scope**:
- ~3-5 users at v1 launch (developer + couple of friends).
- 4-8 distinct banks/issuers across the user base.
- Each user: 2-5 accounts, ~3-5 years of statements once backfilled, ~10,000-30,000 lifetime transactions.
- Data size per user (compressed encrypted blob): < 5 MB even at long-term scale.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

All items below are checked because the v1 design honors every constitutional principle. The narrative explains how each is honored, with FR / SC references back to the spec.

- [x] **I. Privacy Is Absolute** — No AI is invoked anywhere in v1. PDF parsing runs in browser memory via deterministic code (FR-010 to FR-019). All persistence (Phase 2+) is encrypted client-side before any cloud touches it (FR-050, FR-051). Google Drive (Phase 3) holds only ciphertext blobs.
- [x] **II. Accuracy Is Non-Negotiable** — Schema uses `amount_minor INTEGER` (integer cents). BigInt for any aggregation that exceeds 2^53. Checksum gate is mandatory before any insert (FR-013, FR-014, SC-003, SC-010). Refused imports do not partially insert.
- [x] **III. Zero Infrastructure Cost** — Static hosting on GitHub Pages (free). Sync writes to user's own Google Drive (free, within their quota). No server we operate, ever. No paid SaaS in the data path.
- [x] **IV. Plug-And-Play For End Users** — Single URL onboarding. iOS Safari home-screen-install detection enforced (FR-001). No installers, no CLIs.
- [x] **V. Open Source From Day One** — Repository public on GitHub. License AGPL-3.0. Every claim in the spec is independently verifiable by reading the source.
- [x] **VI. Layered Architecture; Data Carries Full Provenance** — Project structure (below) physically separates Layer 1 adapters (`src/lib/adapters/<bank>/`) from Layer 2 database (`src/lib/db/`) from Layer 3 application logic (`src/lib/app/`). Every Transaction row carries all 9 provenance fields (FR-017, FR-018; data-model.md enforces this in schema).
- [x] **VII. Parsing Is Deterministic** — Parsers are PDF.js + layout-aware extraction + per-bank regex/anchors written in TypeScript. Monopoly's GitHub repo is used only as a documentation reference for bank-specific patterns; Monopoly is not imported or executed at runtime (it depends on a C++ binary that cannot run in the browser). No LLM invoked anywhere.
- [x] **VIII. One-Statement Validation Per Bank** — Each supported bank in v1 ships with at least one anonymized golden PDF in `tests/fixtures/<bank>/` plus its expected parsed JSON. CI fails if the parser drifts.
- [x] **IX. AI Use Is Bounded And Opt-In** — v1 uses NO AI. Categorization classifier reserved for the P4 story; not in this plan.
- [x] **X. Encryption Specifics** — AES-256-GCM via Web Crypto API. Key derived via PBKDF2-SHA-256 @ 600,000 iterations with per-user server-issued salt. Passphrase separate from Google OAuth credentials (FR-002, FR-003, FR-004, FR-007).
- [x] **XI. Sync-Authoritative, Local-As-Cache** — Phase 3 design treats the Drive blob as source of truth. Local SQLite is rebuildable from sync. Per-field LWW with column-level timestamps planned for editable fields (deferred to P2 categorization story; v1 fields are all import-time immutable except account_nickname).
- [x] **XII. Schema Covers Multi-Currency / Refunds / Transfers / Idempotency Day One** — data-model.md defines `amount_minor`, `currency`, `fx_rate`, `amount_home_minor`, `status` enum, `transaction_type` enum including `transfer`, `linked_transaction_id`, and a unique idempotency index on `(account_id, posted_date, amount_minor, description_hash)`. v1 UI does not surface all of these but the schema reserves them.
- [x] **XIII. No Hidden Data Outflow** — No analytics SDK, no telemetry, no Sentry, no Google Fonts, no third-party CDN at runtime. All assets bundled or same-origin. CI rule enforces a denylist on runtime fetches.
- [x] **XIV. Tech Stack Commitments Respected** — Stack is exactly what the constitution mandates: Svelte 5 + Tailwind + shadcn-svelte + ECharts + PDF.js + wa-sqlite + Google Drive + GitHub Pages. No deviations.
- [x] **XV. Phased Delivery** — This plan implements only P1 stories. Within P1, work is sub-phased Phase 0 → 1 → 2 → 3 to de-risk parsing first.

All boxes checked. No entries required in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-money-tracker-mvp/
├── spec.md                      # Feature specification (already written)
├── plan.md                      # This file
├── research.md                  # Phase 0 output (technology research, decisions)
├── data-model.md                # Phase 1 output (concrete SQL schema)
├── quickstart.md                # Phase 1 output (developer setup + smoke test)
├── contracts/
│   ├── bank-adapter.md          # Layer 1 BankAdapter interface contract
│   ├── storage-repository.md    # Layer 2 repository contract
│   ├── sync-provider.md         # Phase 3 sync provider contract
│   └── pdf-intake.md            # UI intake flow contract
└── checklists/
    └── requirements.md          # Spec quality checklist (already written)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── adapters/                # Layer 1: per-bank PDF parsers
│   │   ├── types.ts             # BankAdapter interface + Transaction shape
│   │   ├── detector.ts          # Identifies which bank a PDF came from
│   │   ├── _layout/             # Shared layout-aware extraction helpers (PDF.js wrappers)
│   │   ├── chase/               # Per-bank adapter folders (one parser per bank)
│   │   │   ├── adapter.ts
│   │   │   └── fixtures.ts      # References to test fixtures
│   │   ├── bofa/
│   │   └── ...                  # One folder per supported bank/issuer
│   ├── db/                      # Layer 2: SQLite-WASM persistence
│   │   ├── schema.sql           # Authoritative SQL schema
│   │   ├── migrations/          # Versioned migrations (0001_initial.sql, ...)
│   │   ├── client.ts            # wa-sqlite + OPFS bootstrap
│   │   ├── repository.ts        # All read/write functions (one file, no ORM)
│   │   └── types.ts             # Generated TypeScript types from schema
│   ├── app/                     # Layer 3: bank-agnostic application logic
│   │   ├── import.ts            # Orchestrates: detect → parse → checksum → insert
│   │   ├── reconciliation.ts    # Bank CC-payment ↔ CC statement matching
│   │   ├── search.ts            # Unified filter/search logic
│   │   └── account-naming.ts    # First-seen account nickname prompt logic
│   ├── crypto/                  # Encryption layer (Phase 2)
│   │   ├── kdf.ts               # PBKDF2-SHA-256 wrapper
│   │   ├── aes.ts               # AES-256-GCM wrapper (Web Crypto API)
│   │   └── salt.ts              # Per-user salt management
│   ├── sync/                    # Phase 3: Google Drive sync
│   │   ├── drive-auth.ts        # OAuth + folder-scope flow
│   │   ├── drive-blob.ts        # Read/write encrypted blob to Drive
│   │   └── sync-engine.ts       # Push/pull + conflict resolution
│   └── pdf/                     # PDF.js helpers (Phase 0)
│       └── extract.ts           # Text + positional extraction (TypeScript only)
├── routes/                      # SvelteKit pages (SPA mode)
│   ├── +layout.svelte           # App shell
│   ├── +page.svelte             # Landing / quick-import (Phase 0 entry point)
│   ├── onboarding/+page.svelte  # Phase 2: passphrase setup, iOS install
│   ├── transactions/+page.svelte # Unified view (Phase 2)
│   ├── statements/[id]/+page.svelte # Statement detail + drill-through (Phase 1)
│   └── settings/+page.svelte
├── components/                  # Reusable Svelte components
│   ├── PdfDropZone.svelte
│   ├── TransactionTable.svelte
│   ├── ChecksumDiff.svelte
│   ├── PassphraseSetup.svelte
│   ├── IosInstallNudge.svelte
│   └── ...
├── app.css                      # Tailwind base + theme
├── app.html                     # PWA shell with manifest + service worker registration
└── service-worker.ts            # Caches app shell, lazy-loads heavy assets

static/
├── manifest.webmanifest         # PWA manifest
├── icons/                       # App icons for home-screen install
└── (no third-party WASM runtimes — PDF.js loads its own worker from the bundle)

tests/
├── unit/                        # Vitest unit tests (parsers, crypto, schema, reconciliation)
├── integration/                 # Multi-module flows
├── e2e/                         # Playwright browser tests
└── fixtures/
    ├── chase/
    │   ├── 2024-01-checking.pdf       # Anonymized golden statement
    │   └── 2024-01-checking.expected.json   # Expected parsed transactions
    └── ...                            # One folder per supported bank

.specify/                              # Spec-Kit artifacts (already exists)
.claude/                               # Claude Code skills (already exists)
```

**Structure Decision**: Single-project frontend web application. SvelteKit is configured with `@sveltejs/adapter-static` so the build output is purely static files publishable to GitHub Pages. There is no backend codebase. The three architectural layers (adapters / db / app) are physically separated as sibling directories under `src/lib/` so the bank-agnostic rule (Principle VI) is enforceable by lint rules (no imports from `app/` into `adapters/` and no per-bank imports in `app/`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitutional violations. This section intentionally left empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | _(none)_   | _(none)_                            |
