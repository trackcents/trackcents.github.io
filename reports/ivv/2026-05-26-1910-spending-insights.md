=== IV&V REPORT — spending-insights (US-INSIGHT month-over-month deltas) (2026-05-26) ===

Module: src/lib/app/spending-insights.ts (compareCategorySpending, latestTwoMonthKeys,
topMovers, monthOverMonthInsight). Tier: Core, money-adjacent. New feature (Copilot/Monarch
"vs last month") built spec-first (US-INSIGHT §8) on the signed-off spendingByCategoryByMonth.

Lean staged run: Stage 1 only, ~4 min. RESULT: **SIGNED OFF, no bugs.** 17 cover points, 100%
closure. Independent reference model + scoreboard (~1400 comparisons, clean).

Verified: INV1 conservation (Σcurrent/previous/delta reconcile, incl. >2^53 bigints); INV3
delta = current−previous exact; INV2 completeness/uniqueness; INV4 ranking determinism
(permutation-invariant; |delta|↓→current↓→id↑ null-last); INV5 purity; INV6 pct null-iff-
previous-0 + sign + hand cases (10000→15000=+50%, 200000→0=−100%, 0→3000=null); latestTwoMonthKeys
/ topMovers / monthOverMonthInsight + edges. Teeth proven via reference-model self-mutation.
Full Stryker deferred (lean gate, no bug).

Promoted: tests/unit/independent/spending-insights.ivv.test.ts. Designer test:
tests/unit/app/spending-insights.test.ts (11). Wired: a compact "Spending vs last month" strip
on /today (top 3 increases/decreases, shown once ≥2 months of data exist). Final suite:
**pnpm verify GREEN — 1461 tests**, build OK, deployable.

This was built per the user's "complete the in-progress feature, then stop" instruction; it is
the LAST feature added this session. Honest residual: pct float exactness beyond sign+hand-cases
out of scope (display-only); shared-spec blind spot mitigated by oracle-free conservation +
permutation metamorphic.
