<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.0.1  (PATCH — wording clarification, no principle change)
Modified principles:
  - Principle VII (Parsing Is Deterministic): removed the "or run via Pyodide" clause from Step 4. Deeper research (specs/001-money-tracker-mvp/research.md §R1) confirmed Monopoly cannot run inside Pyodide because it depends on the pdftotext C++ binary from Poppler. Now reads: "ported to JavaScript" only. This is a wording clarification — the principle's intent (deterministic parsing, AI forbidden) is unchanged.
  - Principle XIV (Tech Stack Commitments): removed the "Monopoly via Pyodide as a near-term bootstrap option" mention from the PDF parsing bullet. Same reason. Stack still mandates PDF.js + layout-aware + per-bank regex; Monopoly retained as a documentation reference for per-bank patterns only.
Added sections: none
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md       ✅ no change required (Constitution Check section was already updated in earlier work and uses correct language)
  - .specify/templates/spec-template.md       ✅ no change required
  - .specify/templates/tasks-template.md      ✅ no change required
  - .specify/templates/checklist-template.md  ✅ no change required
Load-bearing principles review (per the constitution's own governance rule that amendments be reviewed against I/II/III/VI):
  - I. Privacy Is Absolute             — UNCHANGED. PDF.js-only is more privacy-aligned than the Pyodide option would have been (smaller surface).
  - II. Accuracy Is Non-Negotiable     — UNCHANGED. Multi-level checksum strategy (research.md §R13) actually strengthens this principle.
  - III. Zero Infrastructure Cost      — UNCHANGED. Removing Pyodide removes a ~10 MB first-load cost.
  - VI. Layered Architecture           — UNCHANGED. Three-layer separation preserved.
Deferred items: none
-->

# Money Management Tool Constitution

> A private, offline-first personal finance tool for individual use and ~2-4 personal friends.
> Built by a solo developer with AI assistance. Open source. Not a commercial product.

## Core Principles

### I. Privacy Is Absolute (NON-NEGOTIABLE)

No AI service — cloud OR local — is permitted to read bank statement contents. Bank statement PDFs and parsed transactions MUST NOT leave the user's device in any unencrypted form. Any cloud storage of user data MUST use client-side encryption with a key derived from a passphrase the user controls (zero-knowledge architecture). The developer, the hosting provider, and the sync storage provider (Google, etc.) MUST be incapable of decrypting user data.

**Rationale**: Financial data is among the most sensitive personal information. The user has explicitly committed to "no hacker should be able to steal the data, at any cost." This rules out any architecture that places plaintext data on systems we do not physically control.

### II. Accuracy Is Non-Negotiable (NON-NEGOTIABLE)

Money MUST be stored as INTEGER minor units (cents). JavaScript floating-point numbers are FORBIDDEN for any monetary value. All arithmetic MUST use BigInt or a Decimal library. A checksum invariant — the sum of parsed transactions MUST equal the printed statement totals to the cent — is enforced as a HARD IMPORT GATE. Any statement whose checksum does not match is REFUSED at import time and flagged for manual review. Silent parsing errors are unacceptable.

**Rationale**: The user has stated "if numbers are wrong, the tool is pointless." Finance code MUST fail loudly rather than silently miscount. Float-based money math compounds rounding errors invisibly; integer cents do not.

### III. Zero Infrastructure Cost At Steady State

Target operating cost MUST be $0/month. The application is hosted as static files (GitHub Pages or Cloudflare Pages). User data sync uses each user's OWN cloud storage account (Google Drive primary, OneDrive/Dropbox as future options), NOT infrastructure we own or pay for. We MUST NOT run a server that touches user data. If a paid fallback is ever required, total monthly cost MUST NOT exceed $20/month.

**Rationale**: This is a personal tool shared with friends, not a commercial product. Sustained infrastructure costs would discourage long-term use and create a moral hazard around shutting down friends' data access.

### IV. Plug-And-Play For End Users

The end-user setup MUST be: open a URL, sign in with Google (or equivalent OAuth), set an encryption passphrase, start using. NO installs. NO command-line steps. NO setup scripts. The app MUST work on Android, iOS, and Windows/macOS/Linux laptops via a single Progressive Web App. On iOS Safari, the app MUST detect non-standalone mode on first run and require Add-to-Home-Screen before passphrase setup, to survive the 7-day storage eviction policy.

**Rationale**: Friends are non-technical and will not install Python, Docker, or follow tutorials. If onboarding is harder than installing a real app, no one but the developer will ever use it.

### V. Open Source From Day One

Source code MUST be published publicly on GitHub. License is AGPL-3.0 (chosen for compatibility with Monopoly, which we may incorporate, and to ensure derivatives remain open). Privacy claims MUST be verifiable by any reader of the code. No "trust us" claims allowed.

**Rationale**: Verifiability is what distinguishes the zero-knowledge claim from marketing. Closed-source apps that "respect your privacy" cannot be independently audited; ours can.

### VI. Layered Architecture: Data Carries Full Provenance, Code Is Bank-Agnostic (NON-NEGOTIABLE)

The system MUST be organized in three layers:

- **Layer 1 — Bank Adapters**: One module per supported bank. Input: PDF. Output: Transaction objects in the normalized schema.
- **Layer 2 — Normalized Database**: SQLite-WASM in browser OPFS. ONE schema for all transactions regardless of source bank.
- **Layer 3 — Application Logic**: categorization, reconciliation, charts, sync. Operates on normalized data. MUST NOT branch on specific banks.

EVERY Transaction row MUST carry full source provenance:
`bank_name`, `account_type` (credit card / checking / savings), `account_nickname`, `account_last_4`, `statement_id`, `raw_text` (original PDF line, byte-for-byte), `parser_name`, `parser_version`, `pdf_source_hash`.

The data layer MUST NOT strip bank information. Source attribution is required for drill-down, reconciliation, audit, and filtering. The CODE is bank-agnostic; the DATA is bank-attributed.

**Rationale**: Adding a new bank should require writing one Layer 1 adapter and nothing else. Conversely, the user must always be able to answer "where did this transaction come from?" — losing that traceability would make the tool useless for audit.

### VII. Parsing Is Deterministic

PDF parsing MUST use deterministic methods only. No AI/LLM is permitted for parsing transactions out of PDFs. The approach:

1. PDF.js for text extraction with X/Y positional coordinates.
2. Layout-aware extraction that groups text into rows (by Y) and columns (by X) to recover table structure.
3. Per-bank regex/patterns where layout-aware extraction is insufficient.
4. Monopoly's parser configurations (AGPL-3.0) MAY be ported to JavaScript where they cover a supported bank. Monopoly itself is NOT invoked at runtime — it depends on the `pdftotext` C++ binary which cannot run inside Pyodide (see specs/001-money-tracker-mvp/research.md §R1).

**Rationale**: Parsing errors in finance code are catastrophic. Deterministic parsers fail predictably and visibly; LLM-based parsers can hallucinate plausible-looking wrong answers. The checksum gate (Principle II) catches both, but deterministic parsing makes failures easier to diagnose and fix.

### VIII. One-Statement Validation Per Bank

To add support for a new bank, the user provides ONE anonymized real statement. That statement becomes a saved regression test fixture in the repository. The parser is considered "supported" when the checksum invariant passes against that fixture. If the bank later changes its format, the checksum gate catches it automatically at next import — no six-month verification burden, no silent drift.

**Rationale**: The verification cost of "test with six months × ten banks" would prevent the tool from ever shipping. One fixture per bank, combined with the checksum gate (Principle II), is sufficient because bank statement formats are stable and format changes are caught loudly by the gate.

### IX. AI Use Is Bounded And Opt-In

The ONLY permitted use of AI in this application is OPTIONAL transaction categorization via a small client-side classifier (Transformers.js, ~25 MB embedding model, runs in browser via WebAssembly, no network calls after first download). The model only ever sees parsed transaction descriptions, NEVER raw PDFs or full statement content. Categorization is always user-overridable. The user MUST be able to disable AI categorization entirely and fall back to rules-based categorization. No other AI use cases are permitted without a constitutional amendment.

**Rationale**: AI for low-risk, easily-correctable tasks (categorization) is a useful productivity multiplier. AI for high-risk, hard-to-detect tasks (parsing financial data, sending data to cloud services) is unacceptable. This principle draws the line.

### X. Encryption Specifics

User data encryption MUST use AES-256-GCM via the browser's Web Crypto API. The encryption key MUST be derived from a user-chosen passphrase via PBKDF2-SHA-256 with 600,000 iterations and a per-user salt issued at first setup (the salt is non-secret). The passphrase MUST be separate from the user's Google account sign-in credentials. The encrypted blob in Google Drive (or alternative storage) MUST be opaque to the storage provider. By default, no password recovery is possible (true zero-knowledge); an OPTIONAL recovery code may be offered to users at their choice, with explicit warning that anyone holding the recovery code has the same power as the passphrase.

**Rationale**: These primitives are the well-trodden path used by Bitwarden, 1Password, Signal, and similar privacy-first tools. The two-factor structure (Google for auth, passphrase for decryption) means a compromise of either does not yield user data.

### XI. Sync-Authoritative, Local-As-Cache

The encrypted blob in the user's cloud storage MUST be the source of truth. The local SQLite cache is rebuildable on demand by re-downloading and decrypting. Sync triggers MUST include: on app close, on a manual "sync now" button, and on a configurable automatic schedule (default: on every change). Conflict resolution MUST use per-field last-write-wins with column-level timestamps for editable fields (category, note, etc.), NOT row-level LWW.

**Rationale**: iOS Safari evicts local storage after 7 days of no interaction unless the app is installed to the Home Screen. Treating local storage as a cache (rebuildable from the source of truth in the cloud) eliminates this as a data-loss risk.

### XII. Schema Includes Multi-Currency, Refunds, Transfers, And Idempotency From Day One

The Transaction schema MUST include at minimum:

- Multi-currency: `amount_minor`, `currency`, `fx_rate`, `amount_home_minor`.
- Transaction status enum: `pending`, `posted`, `disputed`, `reversed`.
- Transaction type enum including `transfer` with `linked_transaction_id` to prevent double-counting transfers between user's own accounts.
- Refunds modeled as transactions linked to the original purchase (NOT as negative-amount purchases).
- A unique index on `(account_id, posted_date, amount_minor, description_hash)` to make re-imports idempotent.

**Rationale**: Retrofitting currency, status semantics, or transfer modeling into a money schema after it has data is a brutal migration. Get these right on day one even if v1 only uses some of them.

### XIII. No Hidden Data Outflow

The application MUST NOT contain any analytics, telemetry, crash reporting service, third-party advertising SDK, or user-behavior tracking. All assets (fonts, icons, JS libraries) MUST be bundled with the app or loaded from the same origin. NO runtime fetches from third-party CDNs.

**Rationale**: A single innocuous-looking analytics SDK undoes the entire privacy posture. Default-deny on external network calls is the only durable way to enforce this.

**Amendment (2026-05-25, approved by the architect — single narrow exception):** The Google Identity Services script (`https://accounts.google.com/gsi/client`) MAY be loaded at runtime, but ONLY: (a) lazily, on a user-initiated sign-in action — never on app load; (b) solely to authenticate the user for sync to **their own** Google Drive (`drive.file` scope); and (c) with no other third-party runtime code. This is permitted because it is **user-initiated authentication, not analytics/telemetry/advertising/tracking**, and it does not weaken the privacy posture — the synced blob is client-side-encrypted (AES-256-GCM), so Google stores only ciphertext it cannot read. This is the ONLY sanctioned third-party runtime script; default-deny stands for everything else, and any further exception requires the same explicit, documented approval.

### XIV. Tech Stack Commitments

The chosen stack is fixed for the foreseeable future. Deviations require a constitutional amendment.

- **Frontend framework**: Svelte 5 (pinned to a stable minor version for at least the first year) + Tailwind CSS + shadcn-svelte components.
- **Charts**: ECharts.
- **PDF parsing**: PDF.js (Mozilla) for text extraction; layout-aware + regex for per-bank logic. Monopoly's repo (AGPL-3.0) is permitted as a documentation reference for per-bank patterns to be re-implemented in TypeScript, but Monopoly is NOT imported or invoked at runtime.
- **Local database**: wa-sqlite via OPFS. Fallback to IndexedDB VFS on browsers without OPFS support.
- **Sync transport**: User's own Google Drive (primary). Named fallbacks (do not require amendment): Cloudflare Workers + R2, or a $5 Hetzner VPS running CouchDB / PocketBase.
- **App hosting**: GitHub Pages (primary). Drop-in alternative: Cloudflare Pages.
- **Language**: TypeScript throughout. No JavaScript-only source files.

**Rationale**: Locking the stack prevents the recurring failure mode of "let's add framework X for feature Y." Re-evaluation should be deliberate, not casual.

### XV. Phased Delivery

Development MUST follow phased delivery. Later phases MUST NOT begin until earlier phases are validated end-to-end.

- **Phase 0**: Validate PDF parsing on one real bank, end-to-end (no DB, no UI, no sync). Single HTML file produces the parsed transactions table from one PDF.
- **Phase 1**: Schema, local storage, categorization rules engine, reconciliation linking (bank ↔ credit card).
- **Phase 2**: PWA wrapper, encryption layer, passphrase setup flow.
- **Phase 3**: Google Drive sync.
- **Phase 4**: Dashboards and visualizations.
- **Phase 5+**: Additional features from the user's feature backlog.

**Rationale**: Parsing is the single thing that can kill the project. If it does not work on real statements, nothing else matters. De-risking the riskiest unknown first is the discipline that distinguishes a shipped tool from an abandoned one.

## Tech Stack Commitments

(See Principle XIV for the locked-in stack.) Additional supporting requirements:

- **Build tool**: Vite.
- **Package manager**: pnpm preferred; npm acceptable.
- **Testing**: Vitest for unit tests; Playwright for end-to-end browser tests; golden-PDF fixtures (anonymized real statements) for parser regression tests.
- **CI**: GitHub Actions. Tests MUST pass on every PR. Checksum invariant tests MUST be among the gating tests.
- **Code style**: Prettier + ESLint with TypeScript strict mode enabled.

## Development Workflow & Phasing

(See Principle XV for phase definitions.) Workflow rules:

- The Spec-Driven Development workflow (Spec-Kit) is the primary process: `/speckit-constitution → /speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement`.
- Each feature gets its own feature branch (created automatically by spec-kit's git extension).
- Implementation MUST NOT begin until a plan exists. A plan MUST NOT exist until a spec exists. A spec MUST NOT contradict the constitution.
- Every implementation PR MUST include or update the relevant golden-PDF fixture if it touches a parser.
- Every PR MUST be tested manually by the author against the real flow (drop a PDF, see results) before merging.

## Governance

This constitution supersedes all other practices. It is the contract between the developer, the AI coding agent (Claude), and any future contributors.

**Amendment procedure**:

1. Any change to a principle, the tech stack, or governance MUST be proposed as a written amendment with documented rationale.
2. Amendments MUST identify which principle is being changed and why.
3. Amendments MUST be reviewed against the spirit of Principles I (Privacy), II (Accuracy), III (Zero Cost), and VI (Layered Architecture). These four are load-bearing.
4. Approved amendments MUST update the version per semantic versioning rules below, update the "Last Amended" date, and re-validate the dependent templates (plan, spec, tasks).

**Versioning policy** (semantic versioning):

- **MAJOR**: Backward-incompatible principle removals or redefinitions.
- **MINOR**: New principle added, or existing principle materially expanded.
- **PATCH**: Wording clarifications, typo fixes, non-semantic refinements.

**Compliance review**:

- Every `/speckit-plan` MUST include a Constitution Check section that explicitly lists how each affected principle is honored.
- Any violation of a principle MUST be either resolved before merging OR documented under Complexity Tracking in the plan with explicit justification.
- The default answer to any new feature request that weakens Privacy, Accuracy, or Zero-Cost is NO.

**Version**: 1.0.1 | **Ratified**: 2026-05-23 | **Last Amended**: 2026-05-23
