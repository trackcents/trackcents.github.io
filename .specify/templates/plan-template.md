# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each item below, state how this plan honors the principle, or — if it violates — document the violation in **Complexity Tracking** with explicit justification. See `.specify/memory/constitution.md` for full text.

- [ ] **I. Privacy Is Absolute** — No cloud or local AI reads bank statements. No plaintext user data leaves the device. Any cloud storage uses client-side encryption with a user-held key.
- [ ] **II. Accuracy Is Non-Negotiable** — Money stored as integer minor units (cents). Checksum invariant (parsed total = stated statement total) enforced as a hard import gate. No floats for money. No silent parser failures.
- [ ] **III. Zero Infrastructure Cost** — Steady-state cost is $0/month. Hosting is static. Sync uses the user's own cloud storage account. No paid SaaS in the data path. ($20/mo cap if unavoidable.)
- [ ] **IV. Plug-And-Play For End Users** — Onboarding is "open URL → sign in → set passphrase → use." No installs, no CLI, no setup scripts. PWA across Android / iOS / desktop. iOS Safari home-screen-install nudge enforced.
- [ ] **V. Open Source From Day One** — Code on GitHub, AGPL-3.0. Privacy claims verifiable from the source.
- [ ] **VI. Layered Architecture; Data Carries Full Provenance** — Layer 1 (per-bank adapters) → Layer 2 (normalized DB) → Layer 3 (app logic). Every transaction row carries `bank_name`, `account_type`, `account_nickname`, `account_last_4`, `statement_id`, `raw_text`, `parser_name`, `parser_version`, `pdf_source_hash`. App logic does NOT branch on banks.
- [ ] **VII. Parsing Is Deterministic** — PDF.js + layout-aware extraction + per-bank regex. No LLM-based parsing.
- [ ] **VIII. One-Statement Validation Per Bank** — Each supported bank has at least one anonymized golden-PDF fixture in the repo. Adding a new bank means adding one parser + one fixture.
- [ ] **IX. AI Use Is Bounded And Opt-In** — Only AI usage permitted is client-side categorization classifier (Transformers.js, ~25 MB). User can disable. No AI sees raw PDFs.
- [ ] **X. Encryption Specifics** — AES-256-GCM via Web Crypto API; PBKDF2-SHA-256 @ 600k iterations with per-user salt; passphrase separate from Google sign-in.
- [ ] **XI. Sync-Authoritative, Local-As-Cache** — Cloud blob is source of truth. Local SQLite is rebuildable cache. Per-field LWW for editable fields.
- [ ] **XII. Schema Covers Multi-Currency / Refunds / Transfers / Idempotency Day One** — `amount_minor`, `currency`, `fx_rate`, `amount_home_minor`; status enum; transfer + `linked_transaction_id`; idempotency unique index.
- [ ] **XIII. No Hidden Data Outflow** — No analytics, no telemetry, no third-party SDKs, no runtime CDN fetches. All assets same-origin.
- [ ] **XIV. Tech Stack Commitments Respected** — Svelte 5 + Tailwind + shadcn-svelte + ECharts + PDF.js + wa-sqlite + Google Drive sync + GitHub Pages. Deviations require constitutional amendment.
- [ ] **XV. Phased Delivery** — This plan respects the phase ordering: Phase 0 (parsing) → Phase 1 (schema/storage) → Phase 2 (PWA/encryption) → Phase 3 (sync) → Phase 4 (dashboards) → Phase 5+ (extras).

**If any box cannot be checked**, jump to Complexity Tracking and document the violation with rationale before continuing.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
