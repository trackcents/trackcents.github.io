# Verification Contract — category-budget (US-P4-A)

> Implementation-free. WHAT, not HOW.

## 1. Module under verification
- **Source (do NOT open)**: `src/lib/app/category-budget.ts`
- **Public entry points**: `netSpendingByCategory`, `computeCategoryBudgets`, `budgetTotals`. Types: `CategoryBudget`.
- **Risk tier**: P1 (money aggregation — spend-vs-limit).
- **Touches**: ☑ value/money math ☐ parsing ☐ persistence ☐ concurrency ☐ authn ☐ UI

## 2. Authoritative spec sources
- `specs/001-money-tracker-mvp/spec.md` — US-P4-A (per-category budgets + over-budget alerts).
- `reports/overnight-build/DECISIONS.md` — D14.
- `.specify/memory/constitution.md` — Principle II (bigint cents, no float; `pct` is display-only float).
- You MAY read the `SummaryTransaction` type in `src/lib/app/spending-summary.ts` (data contract).

## 3. Public interface (signatures only)
```ts
interface SummaryTransaction { posted_date: string; amount_minor: bigint; category_id: string | null; }
interface CategoryBudget {
  category_id: string; limit_minor: bigint; spent_minor: bigint;
  remaining_minor: bigint; pct: number; over: boolean;
}
function netSpendingByCategory(txns: readonly SummaryTransaction[]): Map<string | null, bigint>;
function computeCategoryBudgets(limits: Record<string, bigint>, txns: readonly SummaryTransaction[]): CategoryBudget[];
function budgetTotals(rows: readonly CategoryBudget[]): { limit_minor: bigint; spent_minor: bigint; remaining_minor: bigint };
```

## 4. Behavioral requirements
- **R1 — Net spending.** `netSpendingByCategory`: for each `category_id` (incl. `null`), the signed sum of `amount_minor`, then mapped to a spending magnitude = `max(0, −sum)`. A category whose signed sum is ≥ 0 (net inflow / break-even) maps to `0n`, never negative. (This nets refunds, which arrive as positive amounts already relabeled to the original's category.)
- **R2 — Budget rows.** `computeCategoryBudgets`: one `CategoryBudget` per entry of `limits` whose `limit_minor > 0n`. Entries with `limit_minor <= 0n` are omitted. `spent_minor` = the category's net spending (R1), or `0n` if it has none. `remaining_minor = limit_minor − spent_minor` (may be negative). `pct = Number(spent_minor)/Number(limit_minor)*100`. `over = spent_minor > limit_minor` (strictly greater; exactly-at-limit is NOT over).
- **R3 — Ordering.** Rows sorted by `pct` descending (most-over / closest-to-limit first), ties broken by `category_id` ascending.
- **R4 — budgetTotals.** Sums `limit_minor` and `spent_minor` across the given rows; `remaining_minor = limit − spent`.

## 5. Invariants
- **INV1 — Non-negativity & type.** `spent_minor ≥ 0n` and all `*_minor` are bigint. `pct ≥ 0`.
- **INV2 — remaining identity.** For every row, `remaining_minor === limit_minor − spent_minor`. For totals, `remaining === limit − spent` and `limit === Σ limit_minor`, `spent === Σ spent_minor`.
- **INV3 — over ⇔ remaining<0.** `over === (remaining_minor < 0n)` === `(spent_minor > limit_minor)`.
- **INV4 — Determinism & purity.** Same inputs ⇒ identical output; inputs not mutated; independent of `limits` key iteration order and `txns` order.
- **INV5 — Refund netting.** Adding a positive (refund) amount in category C reduces C's `spent_minor` by that amount, down to a floor of 0 (never negative).

## 6. Edge cases
Empty txns; empty limits; a limit with no matching spend (spent 0); spend with no limit (omitted); `limit_minor` exactly equal to spend (over=false, remaining 0); refund making a category net-zero or net-inflow (spent 0); category_id `null` spending (has no limit → never a row); very large bigint; `pct` for a tiny limit vs huge spend (large finite number, no overflow into Infinity for representable bigints).

## 7. Out of scope
- WHERE limits are persisted (budget-store.ts; not this module).
- The month-windowing of txns (the caller pre-filters to a month).
- `null`-category budgets (you can't set a limit on "uncategorized").
- `pct` exactness beyond display (it's a float by design; the bigint fields are the money oracle).

## 8. Error contract
Total over well-typed input; does not throw. Money is bigint by type.

## 11. Oracle hazards
INV2 (remaining identity) and INV5 (refund netting) are the strong oracle-independent checks — prefer them. `pct` is float; assert with tolerance and treat `remaining_minor`/`over` (exact bigint/bool) as the primary oracles.
