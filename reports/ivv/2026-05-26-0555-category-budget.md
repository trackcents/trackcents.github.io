=== IV&V REPORT — category-budget (US-P4-A) (2026-05-26) ===

Module: src/lib/app/category-budget.ts (per-category monthly budgets + over-budget)
Contract: specs/001-money-tracker-mvp/verification/category-budget.contract.md
VE: verification-engineer subagent (fresh context, agent a51238cb), PLAN+EXECUTE, full run.

Independence audit: VE read only the contract, the SummaryTransaction type from spending-summary.ts
  (permitted data contract), the constitution, spec US-P4-A, DECISIONS D14/D15, the framework, an
  unrelated promoted file (conventions), and run configs. category-budget.ts was NEVER opened (two
  source lines surfaced only via Stryker mutant diffs after authoring, used solely to justify
  survivors). → CLEAN.

Verification plan: R1–R4 + INV1–INV5 + error contract + 12 §6 edges → 23 cover points; traceability 100%.

Environment: constrained-random generator (signed bigint amounts incl. inflows/refunds/zero,
  categories incl. null, integer-like ids to stress key-order, limits +/0/−, overlapping & disjoint)
  + independent from-contract reference model + 3 scoreboards (~1400+ comparisons, exact bigint/bool,
  pct stripped) + INV1–INV5 properties (400–600 runs each) + 3 metamorphic relations
  (permutation/split/unbudgeted-augmentation invariance) + hand-computed goldens (112.5%, 30%, floor-0,
  exact-at-limit).

Functional coverage: 100.0% (23/23). Holes: none.

Fault injection: mutation 87.23% (41/47) — above the P0 floor (80). All 6 survivors proven EQUIVALENT
  (the `sum<0n` vs `sum<=0n` floor at break-even where −0n===0n; the 5 tie-break secondary-comparator
  mutants dead because category_id is unique per row). Reference-model self-mutation: scoreboard FAILED
  as expected on an off-by-one remaining, a dropped refund floor, and a >=/> over-boundary → bench has teeth.

Discrepancies: NONE. The DUT matched the contract on every oracle (exact bigint INV2/INV5, goldens,
  metamorphic relations, reference model).

Spec ambiguity logged (non-blocking): [A1] R1 map membership for net-inflow/break-even categories —
  the contract doesn't state whether `netSpendingByCategory` lists an inflow-only category with 0n or
  omits it. Moot for budgets (R2 normalizes missing→0n) and the DUT+model agreed across 600 runs.
  Recommend a one-line §4/§6 clarification. Designer triage: ACCEPTED as-is (no behavioral impact);
  logged for the architect.

Tests promoted: tests/unit/independent/category-budget.ivv.test.ts (30 tests). Promotion cleanup:
  removed a dead/unwired totals scoreboard + its orphaned reference model (budgetTotals stays covered
  by an INV2 property + 2 hand-computed golden tests — stronger than a ref-model scoreboard) and a
  stray eslint-disable; import depth fixed; prettier+eslint clean.

Final suite: pnpm verify GREEN (1043 tests).

Honest residual (per VE): shared-spec blind spot (mitigated by oracle-free INV2/INV5 + metamorphic +
  goldens); pct is display float (asserted with tolerance; remaining_minor/over are the money oracles);
  out of scope — budget persistence (budget-store.ts), month-windowing (caller), null-category rows; the
  6 equivalent mutants rest on "one row per limit key ⇒ unique category_id" (re-evaluate if duplicate
  rows are ever emitted).

Decision: ACCEPTED. category-budget is the verification-of-record for US-P4-A.
