=== IV&V REPORT — refund resolution + spending netting (2026-05-26) ===

Module: src/lib/app/categorization-glue.ts (US-P3-C refund tracking; resolveEffectiveCategory +
  summaryFromImports/detailedRowsFromImports netting)
Contract: specs/001-money-tracker-mvp/verification/refund-resolution.contract.md
VE: verification-engineer subagent (fresh context, agent a63b9715), PLAN+EXECUTE, full run.

Independence audit: VE read only the contract, the DATA contracts (categorization.ts types,
  store.ts ImportRecord, spending-summary.ts SummaryTransaction, adapters/types.ts — explicitly
  permitted, not the DUT), DECISIONS D12, spec.md US-P3-C, the framework, an unrelated promoted
  file (conventions), and infra. categorization-glue.ts was NEVER opened (mutant line/col shapes
  came from Stryker diffs, not source reading). → CLEAN.

Verification plan: R1–R6 + INV1–INV4 + error contract + 9 §6 edges → 29 functional cover points;
  traceability 100%.

Environment: constrained-random generator (1–3 imports × 1–5 txns, signed bigint amounts, every
  refund_of shape: none/self/dangling/link-to-other incl. refund-of-refund, ignored flags,
  custom_name; keys via transactionCategoryKey) + independent from-contract reference model
  (refResolveEffectiveCategory/refSummaryFromImports/refDetailedRows) + 4 scoreboards (~3000+
  DUT-vs-model comparisons, ZERO mismatches) + INV1 conservation (900 runs) + INV2 netting
  (300 + golden) + INV3 purity/determinism (500) + INV4 order-independence (200) + 3 metamorphic
  relations + hand-computed golden (P=−4200, R=+1500 refund_of=P, cat C → C total −2700).

Functional coverage: 100.0% (29/29). Holes: none.

Fault injection: mutation 98.21% (55/56 killed). The single survivor (line 30 `ann.refund_of !==
  key` self-guard → true) is PROVABLY EQUIVALENT: when refund_of === key, inheriting from
  annotations[key] is the same annotation, so the result is identical for every input — no
  stimulus can distinguish it. Reference-model self-mutation: corrupting R2 (return own instead of
  original's category) made the scoreboard FAIL 381/2669 + 148/400 → bench has teeth.

Discrepancies: NONE. The 4 public functions agree with the independent reference model on ~3500
  scenarios; conservation (INV1) holds exactly under arbitrary AND fully-linked refund linkage
  (relabelling never creates/destroys money — the load-bearing P1 property); one-hop (R3) verified
  (A→B→C resolves A to B's own category, never C's); the golden netting value matched.

Spec ambiguities logged (resolved from the data contracts; neither a bug, neither blocked sign-off):
  - [A1] `categorizableFromImports` is listed as a public entry point (§3) but has no behavioral
    requirement (§4). VE verified it black-box (one {key, description} per txn, stable keys, no
    throw/mutation). Recommend adding an explicit R0 to the contract.
  - [A2] R6 "description = custom_name if set else parsed" — "if set" undefined for empty-string.
    VE adopted the data-contract reading (pruneAnnotation treats '' as not-set → parsed); the DUT
    agreed. Recommend R6 state the empty-string semantics.
  Designer triage: both ACCEPTED as-is (DUT behavior is the desired behavior; contract-tightening
  only) — logged to BLOCKERS for morning.

Tests promoted: tests/unit/independent/refund-resolution.ivv.test.ts (29 tests; import depth fixed;
  removed 2 dead VE helpers + a stray eslint-disable; prettier+eslint clean).

Final suite: pnpm verify GREEN (992 tests). vitest.config.ts restored to the clean
  `['tests/unit/**/...']` include (a stale promoted-file entry was removed).

Honest residual (per VE): shared-spec blind spot (model + DUT both descend from contract §4 —
  mitigated by the 3 oracle-free conservation/netting/order checks + golden value); only the
  {amount, category} pairs are verified here (the category-total aggregation is spending-summary's,
  separately verified); one-hop is pinned by design; synthetic ImportRecord fixtures (pure logic
  over typed input, in scope); the equivalent self-guard mutant is structural, not a gap.

Decision: ACCEPTED. categorization-glue refund resolution is the verification-of-record for US-P3-C.
