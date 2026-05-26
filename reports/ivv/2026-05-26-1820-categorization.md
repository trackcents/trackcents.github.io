=== IV&V REPORT — categorization (US-P2-A rule engine + annotation overlay) (2026-05-26) ===

Module: src/lib/app/categorization.ts (`matchRule`, `firstMatchingRule`, `applyRules`,
`setManualCategory`, `setAnnotation`, `pruneAnnotation`, `deleteCategory`,
`transactionCategoryKey`). Tier: Core, money-adjacent — categorization decides which bucket
spending lands in (drives the spending-by-category dashboards), so a clobbered user choice or
a mis-match corrupts the money picture. (The refund-netting/split-distribution in
categorization-glue.ts was signed off earlier; this run covers the RULE ENGINE + annotation CRUD.)

**Lean staged run: Stage 1 only, ~5 min.**

Independence: VE read only the contract + spec (US-P2-A) + framework + public declarations;
never the public-function bodies or the Designer's tests. Independent from-spec reference
models for matchRule/firstMatchingRule; applyRules verified property-style (a mirror would
share blind spots).

RESULT: **SIGNED OFF at Stage 1, no bugs.** 35 cover points, 100% closure.

Headline safety properties (the reason this module was worth verifying) — all hold:
- **INV1 — manual category is IMMORTAL under applyRules:** over 800 runs with random rule sets,
  a manually-categorized transaction is NEVER overwritten by any rule. The "manual override
  sticks" promise (US-P2-A) is upheld.
- **INV2 — user extras survive rule re-apply:** note/tags/ignored/custom_name/is_recurring/
  refund_of/split are preserved whether the txn gets a rule category, keeps a manual one, or
  matches nothing — and for txns not even in the current batch.
- **R5 rule labels recomputed** (a no-longer-matching rule category is lost, not sticky);
  **R7 no orphan** empty annotations; **INV3 idempotent**; **INV4 pure** (new maps, no mutation).

Classic bug-class probes (all clean):
- **Empty pattern (`contains:''`/`regex:''`/`{}`) matches NOTHING** — no silent tag-everything.
- **Invalid regex → false, never throws.** Regex precedence over contains. Case sensitivity both ways.
- **`enabled` semantics:** `enabled===false` skipped, `enabled===undefined` is ENABLED (the
  inversion bug probed and absent).
- **deleteCategory:** clears the deleted category from manual annotations (→null, keep extras),
  drops rule-only ones, leaves no dangling reference, untouched elsewhere.

Discrepancies: NONE. One minor under-specification (NOT a bug): for a previously rule-sourced
annotation with no extras that now matches nothing, the contract allows EITHER dropping the
entry OR keeping it with `category_id:null`; the VE's check accepts both (asserts only that the
prior rule category does not survive). Optional spec tightening, no defect.

Tests promoted: tests/unit/independent/categorization.ivv.test.ts (32 tests, strict-TS +
eslint --no-ignore + prettier clean). Final suite: **pnpm verify GREEN — 1427 tests**, build OK.

Honest residual: full Stryker deferred (lean gate, no bug; teeth proven via reference-model
self-mutation — injecting the tag-everything bug failed the scoreboard as expected); shared-spec
blind spot mitigated by oracle-free metamorphic INV1/INV2/INV3; applyRules verified property-style
not via a full reference model (deliberate, per oracle-hazard guidance); categorization-glue.ts +
the UI + persistence out of scope.

Note: this was the last genuinely-distinct unverified pure-logic module. With it, independent
verification covers the entire money-truth core, the full US-P1-D pipeline, the US-P1-E view, the
import gate, and now the US-P2-A categorization rule engine.
