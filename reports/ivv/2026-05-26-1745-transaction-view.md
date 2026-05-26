=== IV&V REPORT — transaction-view (US-P1-E unified view) (2026-05-26) ===

Module: src/lib/app/transaction-view.ts (`toUnifiedRows`, `accountKeyString`,
`listAccounts`, `applyFilter`, `sortRows`). Tier: Core / P2 UX-truth — the US-P1-E
unified transactions view (flatten → filter by date/account/amount/search/type → sort).
Pure functions the route composes.

**Lean staged run: Stage 1 only, ~6 min. The last unverified core-logic module.**

Independence: VE read only the contract + spec (US-P1-E) + constitution + public type
declarations + framework; never transaction-view.ts or the Designer's tests (incl.
filter-pairwise). Built an independent from-spec reference model (with EXACT decimal
dollars→cents, not float×100) + scoreboard (~1000 comparisons).

RESULT: **SIGNED OFF at Stage 1, no bugs.** 53 cover points, 100% closure.

Checked (all pass): `applyFilter` conjunctive semantics — account-set, INCLUSIVE date
bounds, abs-amount INCLUSIVE bounds (a row whose |amount| equals the cent bound is kept),
token-AND case-insensitive substring search, types set; **AND-decomposition metamorphic
across all 10 dimension pairs (the CLAUDE.md-mandated pairwise filter check)**; subset +
idempotent + empty-filter-identity; `toUnifiedRows` flatten count = Σ txns + provenance
round-trip + deterministic order; `listAccounts` ⇔ `accountKeyString`; `sortRows` 5 keys ×
asc/desc, stable, true permutation, no mutation; purity/determinism.

Two §11 hazards probed:
- **Amount-bound float (Principle II watch):** PASS at all cent-exact bounds (10.05, 0.29,
  0.01, 999.99, 10.00, 0.10) — the DUT correctly rounds dollars→cents and handles the float
  traps (10.05×100 = 1005.0000001, 0.29×100 = 28.9999996) a naive truncation would mis-bound.
- **`accountKeyString` injectivity (the D20 sibling):** PASS — 540 adversarial combos
  (bank_name containing `::`, `|`, tabs; last_4 `1|234`) found NO collision between distinct
  accounts. Unlike the 2-part `cardKeyString` (D20, which WAS collision-prone), this 3-part
  key's middle field is a TYPED ENUM, so the straddling collision is unreachable. Confirmed
  the earlier production-unreachable assessment — and that no fix is needed here.

Discrepancy: NONE (bug). **A1 (SPEC AMBIGUITY, resolved — not a bug):** a filter amount
bound finer than one cent (e.g. `$2.675`) is spec-silent on rounding; the DUT rounds
half-up to 268¢, which is self-consistent (min/max agree, no off-by-one). The VE caught
and corrected its OWN unsound test expectation here rather than mislabel the code. Resolved
(DECISIONS D27): round-half-up-to-cent is the accepted behavior (the cent is the unit;
matches how amount inputs are entered); cent-granularity is guaranteed correct; optionally
the UI could clamp the input to 2 decimals later (low priority, no code change now).

Tests promoted: tests/unit/independent/transaction-view.ivv.test.ts (46 tests; an unused
reference comparator was removed on promotion for lint, with the directed/property checks
unchanged). Final suite: **pnpm verify GREEN — 1395 tests**, build OK.

Honest residual: shared-spec blind spot (mitigated by metamorphic AND-decomposition +
conservation + collision-search + hand goldens); full Stryker deferred (lean gate, no bug;
teeth proven via reference-model self-mutation); `toUnifiedRows` same-day DISPLAY order is
import_index-based (acceptable for display, NOT a money-truth determinism issue); the Svelte
route is out of scope (E2E elsewhere).

=== CORE VERIFICATION CAMPAIGN: COMPLETE ===
With this sign-off, EVERY core/P0 logic module is now independently verified:
money, checksum (import gate), card-payment, reconciliation, transaction-stream (FIFO),
payment-drill (the full US-P1-D pipeline) + transaction-view (US-P1-E) + the earlier
refund/split/category-budget/transfer/recurring/csv-import/merchant-trends/budget-window/
spending-summary/sync-engine. Session IV&V found + fixed 4 real P0-core bugs (D19/D20/D22/D25);
the remaining modules verified clean. No core-logic module remains unverified.
