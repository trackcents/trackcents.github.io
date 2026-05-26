<!-- SPECKIT START -->

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
[specs/001-money-tracker-mvp/plan.md](specs/001-money-tracker-mvp/plan.md)

Related artifacts in the same directory:

- [spec.md](specs/001-money-tracker-mvp/spec.md) — feature specification (P1 user stories + roadmap)
- [research.md](specs/001-money-tracker-mvp/research.md) — Phase 0 technology decisions
- [data-model.md](specs/001-money-tracker-mvp/data-model.md) — concrete SQL schema
- [contracts/](specs/001-money-tracker-mvp/contracts/) — interface contracts (BankAdapter, StorageRepository, SyncProvider, PdfIntake)
- [quickstart.md](specs/001-money-tracker-mvp/quickstart.md) — developer setup + Phase 0 smoke test

Project constitution (binding rules for all work):
[.specify/memory/constitution.md](.specify/memory/constitution.md)

<!-- SPECKIT END -->

## Verification — risk-tiered

### Tier 1 — `pnpm verify` (after every change, ~60s)

Runs, in order: **format:check → lint → check (tsc) → test:cov (vitest with coverage thresholds enforced) → build**.

**Coverage thresholds ARE enforced** per file at the levels in the "Risk-tiered module table" below. A drop below the floor fails CI. This is intentional — money paths cannot lose coverage silently.

**Do not report a code change as "done" until `pnpm verify` passes.** No exceptions for "small" changes.

Tight inner loop alternative: `pnpm check && pnpm test` (skips coverage + build, ~5s). Use during exploration. FINAL "done" must be a green `pnpm verify`.

### Tier 2 — `pnpm validate:integration` (after touching any adapter, store, app/, or util/, ~10s)

Runs the integration boundary: cross-adapter exclusivity + every adapter's unit tests + the entire `tests/unit/regression/` directory.

**Mandatory rule**: when you add a new adapter, change an existing adapter, or refactor anything in `src/lib/app/` or `src/lib/db/`, `pnpm validate:integration` MUST be run AS WELL AS `pnpm verify` before claiming done. Two of our worst bugs (Chase rejected after Robinhood added; BofA real PDF failing) escaped because new code passed in isolation while old code broke.

### Tier 3 — `pnpm validate:integration:real` (BEFORE shipping any adapter change, ~30s)

Adds: real-PDF parse + checksum against the user's anonymized OneDrive corpus. Requires `ONEDRIVE_CHASE_DIR` env var pointing at the corpus directory.

**Mandatory rule for adapter PRs**: this MUST be green on the developer's machine before claiming any adapter feature done. Synthetic fixtures can deceive (the anonymizer collapses cells); real PDFs cannot.

### Tier 4 — `pnpm validate:deep` (before merging a feature, ~10 min)

Runs Tiers 1 + 2 + 3 + Playwright E2E + Stryker mutation testing. Slow. Run BEFORE opening a PR or when finishing a non-trivial feature.

### Risk-tiered module table

| Tier                     | Module                                                                                                                                | Coverage floor (line / branch) | Mutation floor | Required test types                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------- | ------------------------------------------------------------------ |
| **P0 — money truth**     | `money.ts`, `card-payment.ts`, `checksum.ts`, `transaction-stream.ts`, `reconciliation.ts`, `payment-drill.ts`, `transaction-view.ts` | 95 / 90                        | 80             | property + stateful + metamorphic + regression scenario per bug    |
| **P1 — ingestion truth** | `src/lib/adapters/**/adapter.ts`                                                                                                      | 80 / 60-75                     | 70             | synthetic fixture + env-gated real-PDF + cross-adapter exclusivity |
| **P2 — UX truth**        | `src/lib/app/transaction-view.ts` interactions, route components                                                                      | (covered via E2E)              | —              | pairwise filter test + one BDD scenario per user story             |
| **P3 — chrome**          | UI styling, animations, non-money helpers                                                                                             | not enforced                   | —              | manual smoke                                                       |

CI fails on P0/P1 floor violations. Downgrading a tier requires a written PR justification.

### What's deliberately NOT in any tier

- **Bundle-size CI guard**: spec says < 5 MB (SC-007); we're far from the limit. Add later via `@web/bundle-size` when we approach.
- **A11y audit**: zero a11y tests today; deferred to Polish phase (Phase 9, T170).
- **Adversarial review** (`/bug-hunt`): manual after complex features land. Different cadence.
- **TLA+ / Dafny formal verification**: overkill at this scope. Property + stateful + metamorphic cover the safety properties.

## Mutation testing — when to run

After landing non-trivial logic in `src/lib/util/`, `src/lib/app/`, or `src/lib/adapters/`, run `pnpm mutate` on the changed file. Target mutation score: **≥ 80 %** for new code in those directories. Surviving mutants reveal under-tested branches — write tests until they're killed, don't silently accept the survival.

The Stryker config under `stryker.config.json` mutates `src/lib/util/**/*.ts` and `src/lib/app/**/*.ts` by default. Adapter code is excluded because most of it is layout-specific regex where mutation testing produces low-signal noise.

## Automated hooks (no Claude action required)

Two hooks fire automatically per `.claude/settings.json`:

1. **Stop hook** — runs `node scripts/hook-stop.mjs` after every Claude turn. If source files changed, it runs `pnpm check + pnpm test` (~45s) and prints pass/fail. Output flows into the next prompt so failures cannot be silently shipped. Does nothing if no source was edited.

2. **PreCompact hook** — runs `node scripts/hook-precompact.mjs` just before context compaction. Writes a session-state snapshot to `reports/session-state.md`. The NEXT Claude session reads this to reconstruct what was in flight.

If hooks ever feel annoying (e.g., during a tight debug loop), disable in `.claude/settings.local.json` rather than removing them from the project file. Re-enable when feature work resumes.

## Independent Verification & Validation (IV&V) — `/ivv` — the verification of record

This is the project's answer to a real weakness: when the same context writes both the code and its tests, the test oracle just mirrors the author's understanding, so a misread spec produces a green-but-wrong result (the "oracle problem"). Grounded in NASA IV&V (SWE-141), differential/N-version testing, and 2025 multi-agent-verification research.

**How it works** — two separate contexts:

1. **Designer** (the main session, which wrote the code) produces an _implementation-free_ **verification contract** (`specs/<feature>/verification/<module>.contract.md`, from the template) describing WHAT the module must do + its interface, never HOW.
2. A fresh **`verification-engineer` subagent** — which **never sees the source** — runs **plan-gate-then-execute**:
   - **PLAN pass (cheap)**: from the contract + spec alone it writes a verification plan and **surfaces every spec ambiguity** (boundary/edge enumeration + light black-box probes). No stimulus, no mutation yet — minutes, not tens of minutes.
   - **Plan gate**: ambiguities are resolved by the Designer⇄VE dialogue + human escalation (steps 3–4) **before** any expensive work, so the spec is unambiguous before execution.
   - **EXECUTE pass (expensive, once)**: it architects the full **coverage-driven environment** (constrained-random stimulus → independent reference model + scoreboard → assertions → functional-coverage closure → mutation/fault-injection sign-off), writes it to `tests/ivv/`, runs it, and signs off. A sign-off-grade verification engineer, not a basic test author, applying software-industry practices beyond UVM where they bring real value — **conservation/balance invariants** (Beancount/GnuCash double-entry), **fuzzing + a persisted seed corpus** for parsers (SQLite/syzkaller), **anomaly/fault-injection**, and **Jepsen-style history-vs-consistency-model** checks for the future sync layer.
3. **Designer ⇄ VE dialogue** (anti-sycophancy enforced): for each item the Designer classifies CONFIRMED BUG / VE MISREAD / OUT-OF-SCOPE / SPEC AMBIGUOUS, with spec citations. The Designer must NOT blindly fix; the VE must NOT blindly concede. Both cite the spec, not each other's confidence.
4. **Genuine spec ambiguity escalates to the human** (client + architect) — the spec is the shared single point of failure (Knight & Leveson: same-spec workers make _correlated_ errors), so only the human can patch it.
5. Accepted independent tests are **promoted** from `tests/ivv/` → `tests/unit/independent/` and run in the permanent suite forever.

**Cadence (proportionality)**: full `/ivv` (PLAN + EXECUTE) runs **once per module when its logic is substantially complete** — not per micro-edit. A small post-sign-off fix just re-runs the promoted suite (`pnpm verify`); re-spawn the EXECUTE pass only if behavior/spec materially changed. Mutation runs only at sign-off. Skip `/ivv` for chrome/trivial logic.

**Honest limit**: independence reduces but does not eliminate correlated blind spots, because both sides read the same spec. The VE therefore leans on _oracle-independent_ checks (metamorphic, hand-computed golden values, real data), and `/ivv` reports an explicit "honest residual" of what it could not cover.

Run `/ivv` after implementing any non-trivial logic module (`src/lib/app/`, `src/lib/util/`, `adapter.ts`, `src/lib/db/`). It is the bug-FINDING gate; `/validate` is the regression-guarding gate that runs the already-accepted suite (including promoted IV&V tests).

## Verification rule for new features (also added to `.specify/templates/tasks-template.md`)

Every feature's task list MUST end with a "Phase Z: Verification gate" containing:

1. `/ivv` — independent verification (fresh-context testbench) on each non-trivial logic module; the verification of record
2. `/validate` — automated battery (incl. promoted IV&V tests) + writes a dated report to `reports/validation/`
3. `/verify` (built-in) — manual app run in browser
4. `/bug-hunt` for P0 features only — adversarial multi-agent review

`/speckit-tasks` now includes this phase automatically. `/speckit-implement` runs the verification tasks like any other task in the list, so you get an independently-verified, green test report at the end of every feature without having to remember to invoke it.

**Designer-authored tests vs IV&V**: the tests written alongside the code (including those `/speckit-implement` prompts for) are kept as a **fast sanity/smoke loop** — they catch typos and obvious breakage quickly — but they are NOT the verification of record and are known to share the author's blind spots. `/ivv` is what independently certifies the logic.

## Skills cheat-sheet (the verification toolbox)

Project-level custom skills live under `.claude/skills/`:

- **`/ivv`** — Independent Verification & Validation. Spawns a fresh `verification-engineer` subagent that never sees the source, has it independently author + run its own tests from the spec, then runs the Designer⇄VE dialogue and escalates spec ambiguity to you. The bug-FINDING gate / verification of record. Invoke after implementing any non-trivial logic module.
- **`/validate`** — runs the automated tier battery (Tier 1 + 2, optionally 3 / 4), including promoted IV&V tests, and reports findings as P0/P1/P2/P3. The regression-GUARDING gate. Invoke after any code change.
- **`/test-arch`** — designs the test plan for a NEW feature (which property / stateful / metamorphic / pairwise / regression / E2E tests to write). Invoke after `/speckit-tasks` and before `/speckit-implement`.
- **`/constitution-reviewer`** — audits the codebase against the binding constitution. Read-only.

Plus Claude Code's built-in skills that compose with these:

- **`/verify`** (built-in) — opens the running app in a real browser and observes behavior. Run AFTER `/validate` is green.
- **`/run`** (built-in) — launches the app for screenshot or manual click-through.
- **`/code-review`** (built-in) — reviews the current diff for correctness bugs.
- **`/security-review`** (built-in) — security review of pending changes.

And the spec-kit family for designing features in the first place: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`, etc.

**The recommended workflow for new features:**

```
/speckit-specify  →  /speckit-plan  →  /test-arch  →  /speckit-tasks
       →  /speckit-implement  →  /ivv  →  /validate  →  /verify  →  /code-review
```

`/ivv` (independent fresh-context verification) is the bug-finding gate; `/validate` (regression battery) runs after it. Not every feature needs every step. A P0 money-handling feature needs all of them. A P3 chrome tweak needs only `/validate` and `/verify`.

## Adversarial review skill (optional)

When closing out a complex feature, the user can run `/bug-hunt` (the danpeg/bug-hunt skill — Hunter / Skeptic / Referee multi-agent review) for an independent read. The skill is NOT installed by default; see [docs/bug-hunt-setup.md](docs/bug-hunt-setup.md) if installation is needed.

## Property-based testing

For pure logic with clear invariants (money math, FIFO attribution, date helpers, parsers), prefer property-based tests via `fast-check` over example-based tests. Examples in `tests/unit/util/money.properties.test.ts` and `tests/unit/app/transaction-stream.properties.test.ts`.
