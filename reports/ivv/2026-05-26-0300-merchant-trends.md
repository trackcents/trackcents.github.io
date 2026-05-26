=== IV&V REPORT — merchant-trends (2026-05-26) ===

Module: src/lib/app/merchant-trends.ts (US-PW-A/B, pricewatch-inspired spend/price trends)
Contract: specs/001-money-tracker-mvp/verification/merchant-trends.contract.md
VE: verification-engineer subagent (fresh context, agent ad4e3fa5), PLAN+EXECUTE, full run.

Independence audit: VE read only the contract, spec-tracker-research-features.md, DECISIONS D6,
  the constitution, the contracted collaborator `normalizeDescriptor` (signature+body only), the
  framework, and config. It grepped only the `export` lines of merchant-trends.ts to confirm the
  public surface — NO function body opened, NO Designer test read. → CLEAN.

Verification plan: R1–R11 + INV1–INV6 + error contract + 14 §6 edges → 37 functional cover points;
  traceability 100%.

Environment: constrained-random generator (noisy normalize-collapsing descriptors, signed bigint
  incl. 0/inflows, same-day + out-of-order ISO dates) + independent from-spec reference model
  (refMerchantTrends/refPriceJumps/refFrequentMerchants/refLargestPurchases) + 4 scoreboards
  (~1500+ DUT-vs-model comparisons, CLEAN) + INV1–INV6 properties (300 runs each) + 4 metamorphic
  relations (amount-scale INV3, permutation INV4, determinism, window-monotonicity) + hand-computed
  golden values (R6 worked example).

Functional coverage: 100.0% (37/37). Holes: none.

Fault injection: mutation 75.0% total / 79.75% of covered mutants; every survivor justified
  (dead defensive guards unreachable given R3/R6; symmetric comparator secondary arms that differ
  only on deliberately-unspecified ties; the contract-waived R10 loose tiebreak). Reference-model
  self-mutation check: scoreboard FAILED as expected on a floored-average and a flipped jump sign →
  bench has teeth.

DISCREPANCY (the value of this run):
  [A1 → CONFIRMED BUG, fixed] Same-day tie ordering. The VE's oracle-free metamorphic relation INV4
  (permutation invariance) exposed that merchantTrends sorted each merchant's charges by posted_date
  ONLY (stable sort), so two same-day charges to one merchant kept INPUT order — the same data
  imported in a different order produced a different "latest charge"/price-jump. The VE conservatively
  classified this as a spec ambiguity (R5 silent on ties; INV4 claims full invariance) and offered two
  readings: (i) reword INV4 to exclude same-day ties, or (ii) deterministic secondary tiebreak.
  Designer decision (DECISIONS D13): reading (ii) — a finance tool MUST be import-order-independent
  (constitution accuracy/reproducibility ethos). FIX: within a merchant, sort by posted_date → amount
  asc → description; hardened largestPurchases to a full total order too. INV4 now holds
  UNCONDITIONALLY. The reference model + the directed same-day test were re-pinned to the decided
  order (they had encoded the old stable behavior); the scoreboard remains independent on everything
  else. Re-ran: 119/119 IV&V tests green.

Triage of the other items: none — the DUT matched the reference model on every other comparison and
  reproduced the R6 golden value exactly.

Tests promoted: tests/unit/independent/merchant-trends.ivv.test.ts (41 tests; import depth fixed;
  prettier+eslint clean; runs in the permanent suite).

Final suite: pnpm verify GREEN (959 tests).

Honest residual (per VE): shared-spec blind spot (model + DUT both derive grouping from the same
  normalizeDescriptor + contract — mitigated by metamorphic + golden values, not eliminated);
  jump_pct float asserted with tolerance (bigint jump_minor is the primary money oracle); no
  real-statement corpus (pure logic on already-typed MerchantTxn[]); runtime/UI is the separate
  /trends E2E concern.

Decision: ACCEPTED. The IV&V process found and we fixed a real determinism bug. merchant-trends is
  the verification-of-record for US-PW-A/B.
