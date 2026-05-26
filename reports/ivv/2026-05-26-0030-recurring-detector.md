=== IV&V REPORT — recurring-detector (2026-05-26) ===

Module: src/lib/app/recurring-detector.ts (US-P3-A, recurring/subscription detection)
Contract: specs/001-money-tracker-mvp/verification/recurring-detector.contract.md
VE: verification-engineer subagent (fresh context, agent af12f293), PLAN+EXECUTE.

Independence audit: VE read only the contract, spec-rocketmoney-features.md, constitution,
  the PUBLIC interface of recurring-detector.ts (types + signature, NOT the body), the
  contracted collaborator `normalizeDescriptor`, the shared framework, an unrelated promoted
  file (conventions), and config. No DUT body, no Designer test for the DUT. → CLEAN.

Verification plan: R1–R8 + INV1–INV5 + error contract + §6 edges → 40 functional cover
  points; traceability 100% (every requirement/invariant/edge maps to ≥1 cover point + check).

Environment: constrained-random generator (noisy descriptors, ISO dates, signed bigint incl.
  zero; controlled cadence streams across every band + off-band) + independent from-spec
  reference model (`refDetectRecurring`) + scoreboard over ~1450+ corpora (CLEAN, zero
  mismatches) + INV1–INV5/R8 assertions (300 runs each) + 4 metamorphic relations
  (amount-scale, permutation, date-translation, idempotence) + 14 hand-derived golden values.

Functional coverage: 100.0% closure (40/40 cover points). Holes: none.

Fault injection: mutation score 89.3% → 88.8% after hardening (P0 floor is 80). All 21
  surviving mutants individually justified as EQUIVALENT (UTC time-suffix cancels in day-count;
  median order-statistic invariant under comparator perturbation; >0/<0 vs >=/<= equivalent
  given the upstream zero-amount filter; underspecified sort tie-break) or unreachable-defensive
  (median-empty guard on a ≥2-occurrence stream). Reference-model self-mutation check: injecting
  an off-by-one cadence band produced exactly 1 scoreboard mismatch → the bench has teeth.

Discrepancies: 0 → bugs fixed 0 / VE misreads 0 / out-of-scope 0 / spec ambiguities 2 (noted,
  non-blocking — resolved by the contract's own §6, see triage below).

Designer⇄VE triage of the 2 noted ambiguities:
  1. Same-day duplicates (R1 "≥2 = stream" vs §6 "gap 0 → not a stream"). Classification:
     SPEC RESOLVES IT — §6 is the explicit edge rule; the DUT excludes gap-0 groups and the VE's
     model agreed. No code change. Logged for the architect as a wording-tighten opportunity
     (make R1 cross-reference §6) but not a defect.
  2. R8 tie-break order among equal next_due / among multiple nulls. Classification: OUT-OF-SCOPE
     (spec deliberately silent; any stable order is compliant). The DUT's order is acceptable; if
     a deterministic secondary key is ever wanted, that is a spec addition, not a bug. No change.

Tests promoted: tests/unit/independent/recurring-detector.ivv.test.ts (45 tests; import depth
  fixed; prettier+eslint clean; runs in the permanent default suite).

Final suite: pnpm verify GREEN (promoted test included).

Honest residual (independence cannot eliminate):
  - Shared-spec blind spot (Knight & Leveson): the reference model and DUT both descend from the
    same contract and read the same `normalizeDescriptor`; a misreading baked into the CONTRACT
    would be invisible to the scoreboard. Mitigated (not eliminated) by metamorphic + golden checks;
    only the human architect can validate the contract against true product intent.
  - `normalizeDescriptor` treated as a verified collaborator (its own module/contract); a bug in
    its tokenization would be inherited identically by both DUT and model.
  - No real imported-statement recurring-stream corpus exercised (none exists; contract scope is
    pure logic on already-normalized RecurringTxn[]). Real irregular-billing jitter is covered only
    synthetically.
  - Mutation ran via the default vitest config (Stryker-vs-custom-config limitation), reverted to
    net-zero; the self-mutation check is the independent teeth-confirmation.

Decision: ACCEPTED. recurring-detector is the verification-of-record for US-P3-A.
