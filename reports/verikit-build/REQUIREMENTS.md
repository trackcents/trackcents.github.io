# VeriKit — master requirements & build ledger

> Spec-kit-style, on-disk, ticking checklist. This file is the single "where are
> we?" source of truth for the VeriKit build and SURVIVES context compaction —
> any session can read it + `experiments/ve-validation/PROGRESS.md` +
> `verikit/STATUS.md` + `verikit/docs/speckit-study-and-comparison.md` and resume.
> Mark items `[x]` as they complete; keep IDs stable. (Mirrors how spec-kit's
> tasks.md persists progress.)

**Vision.** A portable, publishable, **better-than-spec-kit** verification tool —
"spec-kit for verification." Drop it into ANY project; a fresh-context AI agent
that never sees the implementation verifies it from the spec alone, intelligently
generates test cases (with optional online research), builds a coverage-driven
self-checking environment, runs security + runtime/E2E checks, and signs off or
reports real bugs — with reproducible, recorded evidence.

## Origin requirements (everything the client asked for, 2026-05-23 night)

- **R1** Independent, fresh-context verifier that NEVER sees source (NASA IV&V technical independence). ✅ done (verification-engineer agent).
- **R2** Coverage-driven, self-checking ENVIRONMENT (vplan → constrained-random → reference model + scoreboard → assertions → functional-coverage closure → mutation sign-off), 30-yr-veteran grade, NOT basic tests. ✅ done.
- **R3** Beyond-UVM software practices applied where valuable: differential/reference-model, fuzzing + persisted corpus, conservation/balance invariants, anomaly/fault-injection, Jepsen-style history checks. ✅ done (in charter).
- **R4** Plan-gate-then-execute: surface spec ambiguities cheaply FIRST, human resolves, THEN expensive run. ✅ done.
- **R5** Anti-sycophancy Designer⇄VE dialogue; genuine spec ambiguity escalates to the human architect. ✅ done.
- **R6** Proportionate cadence (once per completed module; small fixes re-run promoted suite; mutation at sign-off). ✅ done.
- **R7** **Validate the verifier itself** via blind bug-injection study with recorded, reproducible results + honest misses + false-positive control. 🟡 in progress (batch 1 scored 4/4 + 0 FP; batch 2 cases 05–07 authored, agents running; honest-miss cases added).
- **R8** **Mirror spec-kit's structure**: persisted ticking plan/tasks that survive compaction; generic templates + scripts + slash-command; installable into ANY repo. ⬜ todo (blueprint agent running).
- **R9** **Better than spec-kit**: enumerate spec-kit's disadvantages and beat each. ⬜ todo.
- **R10** **Security / cyber-engineer lens**: auth bypass, cross-user/tenant data access (IDOR), injection, secret leakage; for the money tool — no user can read another's data or bypass login via source-level flaws. ⬜ todo (charter + a security case).
- **R11** **Runtime / behavioral lens**: for web apps, drive the real app via Playwright/MCP and test it live. ⬜ todo (charter + a web-app case).
- **R12** **Intelligent test-case generation**: research prompt-engineering + AI techniques deeply; the agent generates the RIGHT cases from the design + its own knowledge. ⬜ todo (research + charter).
- **R13** **Online access for the verifier**: may search the web for corner cases / similar designs and inherit known edge cases. ⬜ todo (add WebSearch/WebFetch to VE).
- **R14** **Validate on real GitHub industry-grade projects**: mine bug-fix commit history (reconstruct the pre-fix bug) or plant representative bugs; cover corner cases. ⬜ todo.
- **R15** **spec-kit ↔ VeriKit integration**: spec-kit auto-invokes VeriKit; analyze same-session vs separate cloud sessions. ⬜ todo (blueprint agent feeding this).
- **R16** Reusable for ALL future projects (calculator, shop, mobile app, library, browser). ⬜ todo (genericity work).
- **R17** Honest framing always — measure the real detection rate; never claim 100%/perfection; document residual blind spots. ✅ ongoing discipline.

## Build phases (tick as completed)

### Phase V1 — Validate the verifier (R7)
- [x] V1.1 Harness + 4 cases (calc/roman/cart/lru), blind agents, detection 4/4, 0 false positives.
- [x] V1.2 Reproducible scorer (`experiments/ve-validation/score.mjs`) → results.json + table; exits nonzero on ground-truth mismatch; contamination check.
- [x] V1.3 Auditable independence: oracle (impls + answer keys) relocated OUT of the case dir the VE reads.
- [x] V1.4 Honest-miss cases added (06-dedupe perf = guaranteed miss; 07-variance numerical = honest-hard) + shared-blind-spot case (05-unicode metamorphic).
- [x] V1.5 Batch 2 scored (05–07): 05 unicode DETECTED (oracle-free, avoided shared-blind-spot); 06 dedupe honest-miss → correctly CONFORMS; 07 variance detected-but-UNSOUND-MR → false positive on correct (lesson logged in charter). `results.json` + `FINDINGS.md` written.
- [ ] V1.6 Expand to ≥10 cases across ≥6 domains / ≥8 bug classes (add: timezone/DST, idempotency/retry, CSV silent-wrong, integer-overflow, concurrency/async race, API-contract/mutation). + a re-run of a bounded-k variance case to show the MR-soundness fix.
- [x] V1.7 `FINDINGS.md` — honest numbers (5/5 catchable detected, 1 honest miss, 1 false positive surfaced by the scorer) + threats to validity.

### Phase V2 — Spec-kit-grade structure (R8, R16)
- [x] V2.1 Spec-kit study blueprint DELIVERED at `verikit/docs/speckit-study-and-comparison.md` (key: copy the on-disk `[ ]→[x]` ticking in tasks.md verbatim; genericity = SKILLs shell out to path-resolving scripts returning JSON; integration via `after_implement` hook + Phase Z; default to in-session fresh subagent, separate cloud sessions only for P0/evidence; 12-item TODO). Building from it = V2.2+.
- [x] V2.2 `vplan-template.md` + `verification-tasks-template.md` written in spec-kit's exact `- [ ]`→`- [x]` ticking grammar (compaction-survivable). `verikit/templates/`.
- [x] V2.3 Generic, project-agnostic `verification-engineer` agent + generalized `verification-contract-template.md` + `verikit-verify` SKILL (plan-gate-then-execute, config-driven, resume-from-first-unchecked-box) — all DONE under `verikit/`.
- [x] V2.4 Scripts in BOTH shells (`scripts/powershell/` + `scripts/bash/`: vk-common, vk-check-prerequisites "where-are-we?" JSON oracle, vk-setup-verification) + cross-platform `install.mjs` + `install.md` + `verikit.json` manifest + documented spec-kit `after_implement` + Phase Z integration seams. **Both smoke-tested**: installer lays down a complete 23-file manifest-tracked install into a temp repo; the oracle correctly resolves paths + existence + resume state from disk.
- [x] V2.5 README + TS framework pack + `evidence/batch-1.md` + `docs/methodology.md` (IV&V/CDV/Knight&Leveson/SQLite/Jepsen/OWASP A01/test-gen research/bug-injection, with the MR-soundness lesson) — all DONE. **Phase V2 (spec-kit-grade structure) COMPLETE.**

### Phase V3 — New verification lenses (R10, R11, R12, R13)
- [x] V3.1 WebSearch/WebFetch added to the VE (both `.claude/agents` and `verikit/agents`) + `onlineResearch` config block + a domain-research guardrail (research the DOMAIN, never the implementation).
- [x] V3.2 Security/cyber-engineer lens written into the generalized charter + vplan Phase V4, grounded in OWASP A01 (IDOR/horizontal & vertical privilege escalation/auth bypass/injection/secret leakage); auth-bypass = P0. (Still TODO: a security CASE in the study — V4.2.)
- [x] V3.3 Runtime/E2E lens (Playwright/MCP, config-driven) in the charter + vplan Phase V5. (Still TODO: a real web-app E2E case — V4.2.)
- [x] V3.4 Intelligent-test-generation methodology researched (boundary-value + equivalence-partitioning + property/metamorphic, arXiv 2501.14465 / 2505.09830) and encoded as a first-class section in the charter.

### Phase V4 — Real-world validation (R14)
- [ ] V4.1 Pick 2–3 real GitHub projects; mine a bug-fix commit or plant a representative bug; run VeriKit blind; record.
- [ ] V4.2 A web-app E2E case + a security case (auth-bypass / cross-user access).

### Phase V5 — Integration + ship (R9, R15)
- [ ] V5.1 spec-kit↔VeriKit integration (hook / Phase Z) + same-session-vs-separate-session analysis & recommendation.
- [ ] V5.2 "Better than spec-kit" doc (spec-kit gaps → VeriKit answers).
- [ ] V5.3 Final overseer pass; publishable package.

## Parallel agents in flight (this build)
- 3× blind VE detection on cases 05–07 (results pending → V1.5).
- 1× spec-kit deep-study & comparison → writes `verikit/docs/speckit-study-and-comparison.md` (→ V2.1).
- (Earlier) overseer review completed: verdict NEEDS REAL WORK; its demands are folded into V1.2–V1.7, V3, V4 above.

## Honest status line (update each session)
As of 2026-05-24 (overnight): verifier built + validated on **7 cases**, reproducible scorer + auditable independence + honest misses in place. Result: 5/5 catchable bugs detected, 1 honest miss correctly held out (dedupe), 1 false positive surfaced by the scorer (variance unsound MR — lesson encoded). Spec-kit replication blueprint delivered. **Done since:** built VeriKit package core — ticking `vplan` + `verification-tasks` templates (V2.2), portability `verikit.config.example.json`, generalized project-agnostic `verification-engineer` agent (V2.3 agent), README (V2.5 readme), and all four V3 lenses (security/runtime/online/intelligent-test-gen) encoded in the generalized charter + vplan.
**Package COMPLETE & installable (Phase V2 done):** generalized agent (4 lenses incl. security/runtime) + `verikit-verify` SKILL + 3 ticking templates + config + TS framework pack + README + methodology + cross-platform scripts + `install.mjs` (smoke-tested) + manifest + `better-than-speckit.md`.
**Validation study now 10 cases, fully green:** 9/9 catchable detected (incl. security/IDOR, date end-of-month, CSV parser) · 1/1 honest miss · 0 false positives · 0 contamination (`node experiments/ve-validation/score.mjs` → ✅). Two false-positives (variance, CSV) were found by the scorer → lessoned → resolved on the record. **Runtime/E2E lens DEMONSTRATED** (real Playwright run: app boots + critical route, 1 passed 23.2s). **Spec-kit integration dogfooded** (after_implement hook). Remaining: final overseer review (running) → act on it → write the final user summary; real-GitHub-bug study + concurrency/overflow cases = documented future work.
**Remaining (next wakeups):** (V2.4) cross-platform scripts `verikit/scripts/{powershell,bash}/` (vk-common, vk-check-prerequisites JSON oracle, vk-setup-verification) + `install.{ps1,sh,md}` + `verikit.json` manifest + the `after_implement` integration seam; (V2.5) `docs/methodology.md`; (V1.6/V4) more cases — concurrency/timezone/overflow/idempotency/CSV + a security auth-bypass/IDOR case + a runtime web-app E2E case + a bounded-k variance case (spawn blind VE agents, score); (V5) spec-kit↔VeriKit integration seams per blueprint Part D; then re-spawn the ruthless overseer on the assembled package. Next session: read this file + `verikit/docs/speckit-study-and-comparison.md` + `verikit/README.md`, continue at the first `[ ]`/`[~]` box.
