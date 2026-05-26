=== IV&V REPORT — transfer-detector (US-P3-D) (2026-05-26) ===

Module: src/lib/app/transfer-detector.ts (detect transfers between the user's own accounts)
Contract: specs/001-money-tracker-mvp/verification/transfer-detector.contract.md
VE: verification-engineer subagent (fresh context, agent a8765dd5), PLAN+EXECUTE, full run.

Independence audit: VE read only the contract, spec.md US-P3-D, the constitution, the framework, run
  configs, and an UNRELATED test (conventions). transfer-detector.ts body NEVER opened (only export
  line-numbers via grep + Stryker mutant diffs). No Designer test for the module read. → CLEAN.

Verification plan: R1–R7 + INV1–INV6 + error contract + 10 §6 edges → 29 cover points; traceability 100%.

Environment: constrained-random generator (4 accounts, planted equal-and-opposite pairs among noise,
  same-account decoys, off-by-1-cent decoys, gap-boundary straddles, competing-inflow decoys, hints) +
  a dedicated order-stress generator + independent from-contract greedy reference model + scoreboard
  (1100+ DUT-vs-model comparisons, clean) + INV1 permutation-invariance (300) + purity/no-mutation (200,
  frozen inputs) + INV2–INV6 structural assertions (560+ each) + 24 hand-computed directed cases.

Functional coverage: 100.0% (29/29). Holes: none.

Fault injection: mutation 71.57% (73/102) — above the P1 floor (70); strengthened from 58.82% by adding
  contention/tie/ordering cases. All 27 survivors justified EQUIVALENT or conditionally-equivalent
  (symmetric date-suffix removal; magnitude-0 single-mutation-unreachable given exact-magnitude R3;
  unique-key comparator branches; and the final output `.sort()` comparator mutants — EMPIRICALLY shown
  unkillable because the pairs array reaches `.sort()` already in (out_date, key) order). Reference-model
  self-mutation: scoreboard FAILED as expected on a strict-`<` window mutant → bench has teeth.

Discrepancies: NONE. The DUT correctly implements the greedy R5 logic (earliest-date outflow wins
  shared-inflow contention; same-date ties by outflow key; strictly-smaller gap wins; gap-ties by lowest
  inflow key; used-once; output sorted by out_date asc then outflow_key) and INV1–INV6.

Spec-clarity notes logged (non-blocking; DUT+model agree everywhere):
  [A1] R5 outflow PROCESSING order isn't stated explicitly (only the inflow choice is). INV1+R7 force a
       deterministic order; VE modeled (out_date asc, outflow_key asc) and the DUT agreed on all
       contention cases + 1100+ runs. Recommend pinning it in the contract.
  [A2] R5 tie-break "e.g. by inflow key" — the "e.g." is a suggestion; harden to "by inflow key ascending".
  [A3] The final output `.sort()` is redundant given the processing order already yields sorted pairs
       (harmless belt-and-suspenders; why those comparator mutants survive).
  Designer triage: all ACCEPTED as-is (DUT behavior is correct + desired); contract-tightening only.

Tests promoted: tests/unit/independent/transfer-detector.ivv.test.ts (32 tests; import depth fixed;
  stray eslint-disable removed; prettier+eslint clean).

Final suite: pnpm verify GREEN (1088 tests).

Honest residual (per VE): shared-spec blind spot (mitigated by oracle-free INV2/INV4/INV6 +
  permutation-invariance + hand-computed values); date semantics assumed ISO/UTC (type is `string`; no
  malformed-date fuzz since R8 says total over well-typed input); the equivalent-sort-mutant
  justifications hold for the current internal data flow (re-run if a refactor changes it); 3-way/split
  transfers + the UI confirm/exclude are out of scope (§7).

Decision: ACCEPTED. transfer-detector is the verification-of-record for US-P3-D.
