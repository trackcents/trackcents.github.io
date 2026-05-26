# Verification Contract — spending-summary (dashboard money aggregation)

> Implementation-free. WHAT the module computes + its interface, never HOW. The
> verifier authors its environment from this contract alone and never reads the source.
> Produced by: the Designer. Consumed by: the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/spending-summary.ts`
- **Public entry points**: `monthKey`, `summarize`, `spendingByCategory`, `netByMonth`,
  `spendingByCategoryByMonth`, `sortedMonths`
- **Risk tier**: P0-adjacent (money aggregation — bigint cents, conservation matters)
- **Touches**: ☑ value/money math ☐ parsing ☐ persistent state ☐ concurrency ☐ authz ☐ UI

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec.md` — US-P2-B (spending dashboards: by-category pie,
  over-time stacked, net cash flow per month).
- `.specify/memory/constitution.md` — Principle II (money is integer minor units / bigint, never float).

## 3. Public interface (signatures only)

```typescript
interface SummaryTransaction { posted_date: string; amount_minor: bigint; category_id: string | null; }
interface CashFlow { inflow_minor: bigint; outflow_minor: bigint; net_minor: bigint; }

function monthKey(isoDate: string): string;                                    // 'YYYY-MM' prefix
function summarize(txns: readonly SummaryTransaction[]): CashFlow;
function spendingByCategory(txns: readonly SummaryTransaction[]): Map<string | null, bigint>;
function netByMonth(txns: readonly SummaryTransaction[]): Map<string, CashFlow>;
function spendingByCategoryByMonth(txns: readonly SummaryTransaction[]): Map<string, Map<string | null, bigint>>;
function sortedMonths(byMonth: ReadonlyMap<string, unknown>): string[];
```

## 4. Behavioral requirements (the WHAT)

Sign convention (matches the adapters): `amount_minor < 0` = money OUT (spending);
`amount_minor > 0` = money IN; `amount_minor === 0` contributes to neither.

- **R1 — monthKey** returns the first 7 chars of an ISO date: `monthKey('2026-03-09') === '2026-03'`.
- **R2 — summarize.** `inflow_minor` = sum of all positive amounts (positive magnitude); `outflow_minor`
  = sum of the absolute values of all negative amounts (POSITIVE magnitude); `net_minor` = `inflow − outflow`.
  Worked: `[-500, 2000, -1500]` → `{inflow:2000, outflow:2000, net:0}`. `[0, -100]` → `{inflow:0, outflow:100, net:-100}`.
  Empty → all `0n`.
- **R3 — spendingByCategory.** Groups ONLY outflows (amount < 0) by `category_id`, value = sum of the
  positive magnitudes. Inflows (≥ 0) are excluded entirely. `category_id === null` is its own bucket.
  A category with no outflows does not appear.
- **R4 — netByMonth.** Buckets transactions by `monthKey(posted_date)`; each value is `summarize` of that
  month's transactions. Months with no transactions do not appear.
- **R5 — spendingByCategoryByMonth.** Outer key = month, inner key = category id (or null), value =
  outflow magnitude for that (month, category). Inflows excluded. Empty inner buckets do not appear.
- **R6 — sortedMonths** returns the map's keys sorted ascending (lexicographic 'YYYY-MM' == chronological).

## 5. Invariants & properties (hold for ALL valid inputs — the conservation laws)

- **INV1** — `summarize(txns).net_minor` == the exact signed bigint sum of all `amount_minor`.
- **INV2** — `inflow_minor − outflow_minor === net_minor`, and both magnitudes are ≥ 0.
- **INV3 (conservation)** — Σ over categories of `spendingByCategory(txns)` values === `summarize(txns).outflow_minor`.
- **INV4 (conservation)** — Σ over months of `netByMonth` net === overall net; Σ over months of monthly
  outflow === overall outflow; Σ over months of monthly inflow === overall inflow.
- **INV5 (conservation)** — recombining `spendingByCategoryByMonth` across all months per category ===
  `spendingByCategory` for that category.
- **INV6 (exactness)** — all arithmetic is exact bigint; no precision loss at any magnitude (test
  amounts spanning ±1, ±MAX_SAFE_INTEGER±k, ±10^30). No float ever appears.

## 6. Domain edge cases that MUST be handled

- Empty list; all-inflow; all-outflow; all-zero; a single transaction.
- A `category_id` of `null` mixed with non-null categories.
- Many months across multiple years (ordering); same month different categories.
- Very large bigint magnitudes (overflow-free — bigint has no overflow, but verify exactness).
- Duplicate (date, amount, category) rows — counted independently (no dedup; this module sums, it
  does not de-duplicate).

## 7. Explicitly OUT of scope / deferred — do NOT report as bugs

- **Multi-currency.** v1 assumes a single home currency; the module sums `amount_minor` without fx
  conversion. Mixing currencies is the CALLER's responsibility (spec US-P3-F defers fx). Do not flag
  "sums across currencies" — there is no currency field on `SummaryTransaction` by design.
- `monthKey` on a malformed (non-ISO) date — callers pass ISO `YYYY-MM-DD` (the store validates this at
  the persistence boundary via Zod). `monthKey` just slices the first 7 chars; testing garbage-in is
  out of scope.
- Category NAMES / display formatting / chart rendering — that's the UI, not this module.

## 8. Error contract

Pure total functions — no throwing on valid input. They never mutate their input array. They return
empty maps / zeroed CashFlow for empty input rather than throwing.

## 11. Known oracle hazards

- The safe oracle is the **conservation law** (parts re-sum to the whole) — hand-deriving an exact
  expected value per case is unnecessary and error-prone; prefer the metamorphic/conservation
  properties in §5 plus a few hand-computed golden examples (R2/R3 worked examples).
- bigint equality: compare with `===` on bigint (not Number) and never route a cent value through
  `Number` in the oracle (precision). Multiset/sum comparisons must accumulate in bigint.
