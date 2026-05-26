# Verification Tasks: [MODULE]

> **The IV&V orchestration checklist.** This file persists WHICH PHASE the
> verification run is on, on disk, so a compacted/interrupted run resumes by
> re-reading it and continuing at the first `[ ]`. Mirrors spec-kit's `tasks.md`
> ticking mechanic verbatim (`- [ ]` → `- [x]`). The model is stateless across a
> gap; THIS FILE is the state.
>
> **Module**: [SRC PATH]   **Risk tier**: [P0|P1|P2|P3]   **Contract**: [CONTRACT PATH]
> **Resume rule**: read top-to-bottom, resume at the first `- [ ]` line.

## Format

`- [ ] VT### <phase> — <action> [→ artifact]`

## Phase 0 — Preconditions

- [ ] VT001 Module's own fast checks green (per `verif-kit.config.json` `verifyCmd`)
- [ ] VT002 Governing spec/design docs identified

## Phase 1 — Handoff (contract)

- [ ] VT010 Implementation-free contract written → `[CONTRACT PATH]`

## Phase 2 — PLAN pass (cheap; surface ambiguities, do NOT execute)

- [ ] VT020 Spawn blind verifier in MODE: PLAN
- [ ] VT021 Verification plan + cover points written → `[VPLAN PATH]`
- [ ] VT022 Spec-ambiguity list produced (each: quote+loc, two readings, current black-box behavior)
- [ ] VT023 Independence audit: verifier read no implementation body

## Phase 3 — PLAN GATE (resolve BEFORE executing)

- [ ] VT030 Each ambiguity triaged: GENUINE-AMBIGUITY / VE-MISREAD / OUT-OF-SCOPE
- [ ] VT031 Genuine ambiguities escalated to the human architect
- [ ] VT032 Decisions applied to contract/spec (and code if behavior changed)

## Phase 4 — EXECUTE pass (expensive; once, against clarified spec)

- [ ] VT040 Spawn fresh blind verifier in MODE: EXECUTE
- [ ] VT041 Environment built (generator + reference model + scoreboard + assertions + coverage model)
- [ ] VT042 Functional-coverage closure reached (vplan cover points all `[x]`)
- [ ] VT043 Security lens applied (if applicable per risk tier)
- [ ] VT044 Runtime/E2E lens applied (if a running app/UI)
- [ ] VT045 Mutation / fault-injection sign-off (score ≥ tier floor; bench-has-teeth confirmed)

## Phase 5 — Triage discrepancies

- [ ] VT050 Each discrepancy classified CONFIRMED-BUG / VE-MISREAD / SPEC-AMBIGUOUS
- [ ] VT051 Confirmed bugs fixed; re-run to green
- [ ] VT052 Spec ambiguities re-escalated to the human

## Phase 6 — Promote

- [ ] VT060 Accepted independent tests promoted → permanent suite (per `verif-kit.config.json` `independentTestsDir`)
- [ ] VT061 Full project verification suite green

## Phase 7 — Report

- [ ] VT070 Dated report written → `reports/ivv/`
- [ ] VT071 Honest residual stated (shared-spec blind spots, lenses not applied)

**Checkpoint**: when every box is `[x]`, the module is signed off (or its open
items are explicitly waived in the report with reasons).
