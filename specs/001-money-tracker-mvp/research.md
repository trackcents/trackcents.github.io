# Phase 0 Research — Money Tracker v1

**Branch**: `001-money-tracker-mvp` | **Date**: 2026-05-23 | **Plan**: [plan.md](./plan.md)

This document resolves the technology questions and trade-offs that the implementation plan depends on. Every decision is in **Decision / Rationale / Alternatives considered** format.

---

## R1. PDF parsing strategy — deterministic, browser-only, no AI

**Decision** (REVISED 2026-05-23 after deeper research): Use **PDF.js** as the SOLE PDF engine for v1. Bank-specific parsers are written in TypeScript on top of PDF.js's positional text-item output (`getTextContent()` returning items with X/Y transform matrices). **Monopoly's GitHub repository is used as a written REFERENCE for per-bank regex/anchor patterns** that we re-implement in TypeScript — Monopoly itself is NOT imported, embedded, or invoked at runtime.

**Rationale**:
- Constitution Principle VII forbids AI for parsing. PDF.js (Apache-2.0, Mozilla-maintained, ~3M weekly npm downloads, monthly releases) is deterministic, runs in all modern browsers, and is the engine that ships inside Firefox itself.
- PDF.js's `getTextContent()` returns text items with full transform matrices (x/y/scale/font size). This is the substrate we need for layout-aware row/column reconstruction.
- Apache-2.0 → AGPL-3.0 is a confirmed one-way-compatible license combination (per FSF and ASF), so PDF.js can live inside our AGPL-3.0 codebase.
- Bundle cost is reasonable: ~300 KB minified for the text-extraction path + ~1 MB for the worker. Acceptable for a PWA on a basic laptop.

**Why Pyodide + Monopoly was REJECTED** (this was my earlier tentative plan; deeper investigation killed it):
- Monopoly is a Python library, but it depends on `pdftotext` — a C++ binary from Poppler (`libpoppler-cpp-dev`). Pyodide cannot load native C++ binaries; it runs CPython compiled to WebAssembly with a sandboxed filesystem.
- PyMuPDF (the closest alternative Python PDF library) is officially "experimental" in Pyodide and breaks `micropip.install()` in current releases.
- Pyodide itself adds a ~10 MB initial download. Even if a Pyodide-compatible PDF parsing library existed, the cost is unjustified for a basic-laptop user.
- The plan of "Pyodide + Monopoly bootstrap for 20+ banks" was based on a false premise. It does not work.

**What we keep from Monopoly's work**:
- Their per-bank configuration patterns (regex anchors, header detectors, sign conventions) are a documented, AGPL-3.0 body of knowledge. Since our project is also AGPL-3.0, we can lift their patterns into our TypeScript adapters with attribution.
- Their checksum-validation philosophy (validate totals before declaring an import successful) directly inspired our checksum invariant.
- Their adapter ARCHITECTURE (one folder per bank with `name`, `statement_configs`, `identifiers`) is the pattern we mirror in `src/lib/adapters/<bank>/`.

**Alternatives considered**:
- *PDFium-WASM* (`@hyzyla/pdfium`): MIT-licensed, faster runtime than PDF.js for some operations, drop-in alternative. **Held in reserve** as a fallback if PDF.js misbehaves on a specific bank's PDFs. Decision: stick with PDF.js as primary because of larger community, more documentation, and Mozilla's maintenance commitment.
- *MuPDF-WASM*: excellent quality, but AGPL-3.0 dual-license model (commercial license available) adds licensing complexity. Decision: not adopted, but acceptable if we ever need higher-quality text extraction.
- *Cloud OCR / cloud LLM extraction*: rejected — violates Principle I.
- *Local LLM extraction (WebLLM, MinerU-style with HuggingFace models)*: rejected — violates Principle VII; the user's own MinerU-based script pulls ~5 GB of models, which is unfriendly to their stated "basic laptop" constraint.
- *Tesseract.js for scanned PDFs*: not in v1 scope. Plan to evaluate for v2 if scanned-image PDFs become a real need.
- *Pure line-by-line regex without positional information*: rejected — known to silently misattribute amounts when a bank adds a header line.

**Single biggest risk to watch for** (war story from the research agent): PDF.js's `getTextContent()` returns items in PDF content-stream order, which is the order the PDF generator emitted glyphs — NOT visual order. Some bank generators emit "all dates for the page, then all descriptions, then all amounts" rather than row-by-row. A naïve "group by Y coordinate" works for some banks and not others. The defensive pattern is **always cluster by Y first, then sort each cluster by X**, with a ~3 pt tolerance band for sub-pixel jitter. Test each bank's parser on at least 3 real statements from different months before declaring the bank supported — banks change layouts at fiscal-year boundaries.

---

## R2. SQLite-WASM binding and storage backend

**Decision**: Use **wa-sqlite** (rhashimoto/wa-sqlite) with the **OPFS VFS** as the primary backend. Fall back to the **IndexedDB VFS** on browsers without OPFS support (older Safari, some Firefox versions).

**Rationale**:
- SQLite is the right database for embedded financial data (Principle XIV mandates it).
- wa-sqlite is the more capable WASM build today (compared to sql.js): it supports custom VFS, OPFS, and async operations.
- OPFS (Origin Private File System) is faster than IndexedDB for binary blobs and is supported on Chrome / Edge / Safari 17+ / Firefox 111+. Where unavailable, IndexedDB VFS is an automatic fallback.
- Single `.sqlite` file per user makes encryption-at-rest trivial (encrypt the whole file as one blob when syncing).

**Alternatives considered**:
- *sql.js (kripken/sql.js)*: simpler API but no OPFS support; everything lives in IndexedDB which is slower and has eviction risks on iOS Safari.
- *Dexie / IDB raw*: not relational; we'd reinvent foreign keys, indexes, transactions. The schema in data-model.md depends on real SQL.
- *DuckDB-WASM*: powerful but oriented toward analytical queries over columnar data; overkill for our row-level financial workload and bigger bundle.

---

## R3. Encryption primitives

**Decision**: **AES-256-GCM** via the browser's **Web Crypto API**. Key derived from the user's passphrase via **PBKDF2-SHA-256 at 600,000 iterations** with a per-user **server-issued salt** (the salt is non-secret; "server-issued" here means generated at first setup and stored alongside the encrypted blob in the user's Drive).

**Rationale**:
- Constitution Principle X specifies this exact set of primitives.
- Web Crypto API is built into every modern browser. Zero dependency on third-party crypto libraries. Audited and hardware-accelerated where available.
- PBKDF2-SHA-256 at 600k iterations is consistent with the Bitwarden default; not the strongest available (Argon2id is stronger) but Argon2 requires a WASM library and Web Crypto doesn't natively expose it yet.
- AES-256-GCM provides confidentiality + integrity in one primitive. Detects tampering automatically.

**Alternatives considered**:
- *Argon2id (via hash-wasm or argon2-browser)*: stronger against GPU brute-force but adds ~80 KB of WASM. May be added in a future revision when Web Crypto supports it natively. PBKDF2 600k is acceptable for our threat model.
- *libsodium.js*: provides Argon2 + XChaCha20-Poly1305 but is 200 KB and overkill for our needs.
- *Roll our own crypto*: never. Use the platform.

---

## R4. Google Drive integration

**Decision**: Use **Google Identity Services (GIS)** for OAuth + **Google API JavaScript client (gapi)** for Drive REST calls. Request the **`drive.file`** scope (read/write access only to files the app itself creates). Store the encrypted blob in a single dedicated folder named e.g. `MoneyTracker/` inside the user's Drive.

**Rationale**:
- `drive.file` is the minimum scope that lets us read/write our own files. The app cannot see any other Drive content the user has. This is the strongest privacy posture available with Drive.
- GIS is Google's current recommended OAuth library (post-2022). It returns short-lived access tokens; refresh is browser-driven.
- A single folder is easier for the user to inspect, delete, or back up than scattered files.

**Alternatives considered**:
- *Full `drive` scope*: rejected — gives the app access to everything in the user's Drive. Unnecessary and a red flag during Google verification.
- *Service account*: not applicable for user-owned data; service accounts have their own Drive.
- *Dropbox / OneDrive*: deferred to a future iteration. The sync layer abstracts the storage provider so adding OneDrive later requires only a new provider implementation.

---

## R5. UI framework — Svelte 5 specifically

**Decision**: **Svelte 5** with **SvelteKit** configured for SPA / static export via `adapter-static`. Pinned to a stable Svelte 5 minor version (e.g. `5.6.x`) for the first year. Use **Runes** (`$state`, `$derived`, `$effect`) as the reactivity model.

**Rationale**:
- Svelte 5 compiles away — the shipped bundle is closer to vanilla JavaScript than React or Vue would produce.
- Runes are the latest reactivity API and the going-forward direction of the framework.
- SvelteKit's `adapter-static` produces pure static files publishable to GitHub Pages with zero server.
- Compatible with shadcn-svelte for component primitives and Tailwind for styling.

**Alternatives considered**:
- *React + Vite*: larger runtime, more churn in best practices (React Server Components, React Compiler all reshape patterns yearly). Adoption is wider but solo-dev productivity is better in Svelte.
- *Vue 3*: comparable in many ways but smaller ecosystem of finance-app primitives.
- *Preact + Signals + HTM*: lighter still, no build step possible, but lacks first-class SvelteKit-style routing and the shadcn ecosystem.
- *Vanilla JS + Web Components*: pure but expensive for a solo developer building a non-trivial UI with charts and drill-downs (the senior architect reviewer flagged this as a likely false economy).

---

## R6. Charts — ECharts

**Decision**: **Apache ECharts 6** for charts. Lazy-loaded (only when the dashboard view is opened, which is Phase 2+/v1.1). Not included in Phase 0 bundles.

**Rationale**:
- One library covers pie, stacked bar, sankey (useful for the "$800 paid → these transactions" drill visualization), treemap, time-series.
- Apache 2.0 license. Maintained by Apache. Used by major enterprises.
- ~200 KB gzipped baseline; tree-shakeable.

**Alternatives considered**:
- *Chart.js*: smaller and friendlier for simple cases but doesn't do sankey or treemap as cleanly.
- *D3 + Observable Plot*: best for custom exploratory viz; more work for canonical chart types.
- *Recharts*: React-only; rejected with framework choice.

---

## R7. Build & host pipeline

**Decision**: **Vite** as the build tool (already part of SvelteKit). **pnpm** as the package manager. **GitHub Actions** for CI. **GitHub Pages** for hosting (free, supports HTTPS, auto-deploys from a branch).

**Rationale**:
- Vite is the default build tool that ships with SvelteKit; no choice to make.
- pnpm has the most efficient disk usage for a multi-package mono-style repo, even though we're single-package today.
- GitHub Actions is the natural CI for a GitHub-hosted repo. Free for public repos at our usage levels.
- GitHub Pages is fully free, supports custom domains, automatic HTTPS via Let's Encrypt.

**Alternatives considered**:
- *Cloudflare Pages*: equivalent capabilities, slightly faster edge network. Named as drop-in alternative in the constitution.
- *Vercel / Netlify*: have free tiers but with usage caps that could trigger paid plans unpredictably.

---

## R8. Testing strategy

**Decision**:
1. **Vitest** for unit tests (parsers, crypto wrappers, schema helpers, reconciliation matchers).
2. **Playwright** for end-to-end browser tests (drop PDF, see transactions, complete onboarding, drill-through).
3. **Golden-PDF fixtures** under `tests/fixtures/<bank>/`: one anonymized real statement per supported bank, plus the expected parsed JSON. Snapshot-tested. Checksum invariant tested for each.
4. **CI gate**: tests MUST pass on every PR. Parser snapshot drift fails CI.
5. **Manual smoke test**: every PR author runs the end-to-end flow locally before merging (per constitution governance).

**Rationale**:
- Vitest runs in the same context as Vite, fast iteration.
- Playwright drives real browsers (Chromium, Firefox, WebKit) which is essential for an offline-first PWA with browser-specific behaviors (iOS Safari OPFS).
- Golden fixtures are the only credible way to defend against silent parser drift over years.

**Alternatives considered**:
- *Jest*: slower in Vite projects, less native fit.
- *Cypress*: WebKit support is weaker than Playwright's.
- *Property-based testing (fast-check)*: useful for reconciliation matcher; can be added later in v1.1+.

---

## R9. Phasing within v1 — what gets built first

**Decision**: Implement the 5 P1 user stories in the following order:

1. **Phase 0** (Week 1): **US-P1-B** for ONE bank. Bare HTML + Vite + PDF.js + one adapter (the user's most-used bank) + checksum gate. Hardcoded to that one bank. No DB — just render to a table in memory. *Goal: prove parsing works on real data.*
2. **Phase 1** (Week 2-3): Add SvelteKit + wa-sqlite + the full schema. Add **US-P1-C** (credit card import) using a second adapter. Add **US-P1-D** (reconciliation drill-through). Idempotency.
3. **Phase 2** (Week 4-5): Wrap as PWA (manifest, service worker, OPFS). Add encryption layer (Web Crypto + PBKDF2). Add **US-P1-A** (onboarding with passphrase + iOS install nudge). Add **US-P1-E** (unified searchable filterable view).
4. **Phase 3** (Week 6): Add Google Drive sync. Encrypted blob upload/download. On-close sync + manual sync button.

**Rationale**:
- Phase 0 isolates the riskiest unknown (parsing accuracy on user's real banks) into the smallest possible deliverable. If it fails, ~1 week is lost — not 6 weeks.
- Each subsequent phase adds one well-defined layer. Each phase ends with something demoable.
- The reviewer agent specifically endorsed this ordering during the architecture debate.

**Alternatives considered**:
- *Build the full onboarding + encryption first, then parsing*: rejected — buries the riskiest unknown.
- *Try to parallelize phases*: rejected — solo developer, no parallelization possible.

---

## R10. Bank choice for Phase 0 — which bank to support first

**Decision**: **Pending user input.** The user needs to send one anonymized real statement from their most-used bank. The Phase 0 adapter is then written in TypeScript on top of PDF.js, using Monopoly's GitHub patterns as a written reference if the bank is one Monopoly already supports.

**Rationale**:
- Phase 0 is for validating the riskiest assumption, which means testing on a statement that actually matters to the user.
- Constitution Principle VIII (one-statement validation per bank) requires we have one real statement before declaring a bank supported.
- We CANNOT proceed to Phase 0 implementation until the user sends one anonymized statement.

**Alternatives considered**:
- *Build for a synthetic / public-sample statement first*: rejected — provides no real signal that parsing will work for the user.
- *Build for all 20 of Monopoly's banks at once*: rejected — overcommits before validating.

---

## R11. Account-detection on first import (account_nickname capture)

**Decision**: When the user drops a PDF and the parser identifies a previously-unseen `account_last_4` for a bank, the import flow displays a small modal asking the user to assign a nickname (e.g. "BoA Visa", "Chase Checking"). The nickname becomes part of the Account row in the schema. Subsequent imports for the same `(bank_name, account_last_4)` reuse the nickname without prompting.

**Rationale**:
- A nickname is needed for the user to recognize accounts in the unified view (FR-041).
- Auto-deriving nicknames from PDFs is unreliable (banks vary in how they name their own products).
- Prompting only once per new account is minimal friction.

**Alternatives considered**:
- *Use account_last_4 as the display label*: ugly and not memorable.
- *Auto-derive from bank metadata in the PDF*: inconsistent across banks; deferred to the parser-fills-it-if-it-can pattern (parser can suggest a default, user can accept or override).

---

## R12. Reconciliation matching algorithm

**Decision**: Match a bank-statement "PAYMENT TO [card]" transaction to a credit card statement when ALL of the following hold:

1. The credit card identifier in the bank-tx description matches the CC statement's account (by `account_nickname` substring match, OR by `account_last_4` if present in the description).
2. The amount of the bank-tx (positive value) equals the CC statement's printed payment amount (or "new balance previous" for some card formats) to the cent.
3. The bank-tx date falls within ±10 days of the CC statement's payment-due-date or post-period-end. (Configurable in `UserSettings`.)

If exactly one CC statement matches, the link is auto-persisted. If zero match, the bank-tx is left unlinked with an "import the matching CC statement" call to action. If multiple match (rare), the user is prompted to choose.

**Rationale**:
- A purely amount-based match is ambiguous when multiple payments of the same amount exist.
- A purely description-based match fails for cards whose payment description doesn't include the card name clearly.
- The combination of (card identifier + amount + date window) is robust in practice and matches how a human would reconcile.

**Alternatives considered**:
- *Always require the user to manually link*: rejected — defeats the "1-click drill" success criterion (SC-004).
- *Use fuzzy matching on description*: rejected — non-deterministic, hard to audit.
- *Match on the credit card's "previous balance" or "starting balance"*: useful as a secondary heuristic; deferred unless the primary algorithm proves insufficient.

---

## R13. Multi-level checksum strategy — the gate works on any statement

**Problem identified** (raised by the user 2026-05-23): the original FR-013 / FR-014 assumed every statement prints aggregate `total_debits` and `total_credits` lines that the adapter can compare against. This is not universally true — about 20-30% of bank statements (especially smaller banks, some international, and some legacy formats) omit aggregate totals and only print opening + closing balances.

If our checksum gate only checks aggregate totals, those statements would either (a) be falsely refused because the gate has no data, or (b) be silently accepted with no real verification — both unacceptable.

**Decision**: Adopt a multi-level checksum strategy. The adapter populates whatever reconciliation fields it can extract; the checksum gate runs every check that has data and requires AT LEAST ONE strong check to pass. If ANY available check disagrees with parsed transactions, the import is refused.

**The four levels (in order of priority)**:

| Level | Check formula | Fields required from `ParsedStatement` | Strength | When it applies |
|---|---|---|---|---|
| **A — Balance reconciliation** | `opening_balance + sum(all_transactions) == closing_balance` | `opening_balance_minor` + `closing_balance_minor` | **Strongest** — uses every parsed transaction | Virtually every bank statement (~99%); standard bookkeeping requirement |
| **B — Aggregate totals** | `abs(sum(debits)) == total_debits_minor` AND `sum(credits) == total_credits_minor` | `total_debits_minor` + `total_credits_minor` | Strong — independent secondary verification | ~70-80% of US/Canadian bank statements; less common internationally |
| **C — Statement balance (credit cards)** | `previous_balance + sum(charges) - sum(payments) - sum(credits) == new_balance` | `previous_balance_minor` + `statement_balance_minor` | Strong for cards | Most credit card statements |
| **D — Transaction count** | Number of parsed transactions equals printed count (e.g., "23 transactions this period") | adapter-supplied count | Weak (supplementary) | Some statements print this |

**Rules**:
1. Every adapter MUST populate enough fields to satisfy AT LEAST ONE of Level A, B, or C. Level D alone is insufficient — it only catches "missed an entire transaction," not "got an amount wrong by $5."
2. The checksum gate runs EVERY applicable level (whichever fields the adapter populated). All applicable levels must pass. If any fails, the import is refused with a level-specific diff message.
3. If the adapter populates only Level D, the gate refuses the import as "insufficient verification available" — the human must review manually.

**Why both balance and aggregate totals when both are available**: bank statements with both fields provide redundant verification. If `opening + sum = closing` AND `abs(sum(debits)) = printed_debits`, we have two independent algebraic relations both satisfied — much stronger than either alone. They protect against different parser bugs (Level A catches missing/extra transactions; Level B catches sign-flip errors that would cancel in Level A).

**Implementation impact**:
- `ParsedStatement.total_debits_minor` and `total_credits_minor` become OPTIONAL.
- `ParsedStatement.opening_balance_minor` and `closing_balance_minor` become the most-commonly-populated fields.
- A new `parser_provides` field on `ParsedStatement` declares which levels this adapter supports (so the gate knows what to run).
- The `statements` table gains a `checksum_strategy_used` column for audit visibility.

**Alternatives considered**:
- *Trust the adapter (no gate)*: rejected — violates Principle II.
- *Require Level B only*: rejected — would prevent ~20-30% of statements from being importable.
- *Make Level D sufficient*: rejected — too weak to catch amount-level parser bugs.

---

## Resolved NEEDS CLARIFICATION

None. All technical context items in plan.md are concrete. The only genuinely-open item is the user's specific bank choice for Phase 0 (R10), which is a user input not a technology decision.
