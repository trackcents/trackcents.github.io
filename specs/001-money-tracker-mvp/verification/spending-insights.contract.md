# Verification Contract — spending-insights (US-INSIGHT month-over-month deltas)

> Implementation-free contract for the independent verifier. WHAT + interface, never HOW.

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/spending-insights.ts`
- **Public entry points**: `compareCategorySpending`, `latestTwoMonthKeys`, `topMovers`, `monthOverMonthInsight` (+ `CategoryDelta`/`TopMovers` types).
- **Risk tier**: **Core, money-adjacent.** Computes how each category's spend changed vs the prior period — a user-facing insight ("you spent more on X"). Money is bigint cents; a wrong delta misleads the user.
- **Right-sizing:** **LEAN — Stage 1 only.** Headline = the conservation + ranking-determinism properties + the pct/edge cases. No mutation marathon. A few minutes.

## 2. Spec sources
- `specs/001-money-tracker-mvp/spec-tracker-research-features.md` §8 (US-INSIGHT).
- Constitution Principle II (bigint money; the percentage is a DISPLAY Number only).
- Inputs come from the signed-off `spendingByCategoryByMonth` (positive spend magnitudes per category per 'YYYY-MM').

## 3. Public interface (signatures only)
```ts
interface CategoryDelta {
  category_id: string | null;
  current_minor: bigint;    // positive spend magnitude this period (0 if absent)
  previous_minor: bigint;   // positive spend magnitude last period (0 if absent)
  delta_minor: bigint;      // current − previous (signed; >0 = spent MORE)
  pct_change: number | null;// (delta/previous)*100; null iff previous==0
}
export function compareCategorySpending(
  current: ReadonlyMap<string|null,bigint>, previous: ReadonlyMap<string|null,bigint>): CategoryDelta[];
export function latestTwoMonthKeys(
  byMonth: ReadonlyMap<string, ReadonlyMap<string|null,bigint>>): { current: string; previous: string } | null;
interface TopMovers { increased: CategoryDelta[]; decreased: CategoryDelta[]; }
export function topMovers(deltas: readonly CategoryDelta[], n: number): TopMovers;
export function monthOverMonthInsight(
  byMonth: ReadonlyMap<string, ReadonlyMap<string|null,bigint>>):
  { current: string; previous: string; deltas: CategoryDelta[] } | null;
```
Input maps hold POSITIVE spend magnitudes (per `spendingByCategory`). The maps will not contain negative values (callers pass spend magnitudes); you need not handle negative inputs.

## 4. Behavioral requirements
- **R1 — `compareCategorySpending`:** exactly one `CategoryDelta` per category present in EITHER map; `current_minor`/`previous_minor` default to `0n` when the category is absent that period; `delta_minor === current_minor − previous_minor`; `pct_change === null` iff `previous_minor === 0n`, else `(Number(delta_minor)/Number(previous_minor))*100`.
- **R2 — ranking:** sorted biggest-mover-first by `|delta_minor|` desc, then `current_minor` desc, then `category_id` asc (null sorts LAST). Result is INPUT-ORDER-INDEPENDENT (permuting either map yields the same ordered output).
- **R3 — `latestTwoMonthKeys`:** the two lexicographically-greatest month keys as `{current, previous}` (current is the greatest); `null` when fewer than two months.
- **R4 — `topMovers(deltas, n)`:** `increased` = up to `n` rows with `delta>0` sorted by delta desc; `decreased` = up to `n` rows with `delta<0` sorted by delta asc (most-negative first); rows with `delta===0` excluded from both; `n<=0` ⇒ both empty.
- **R5 — `monthOverMonthInsight`:** picks the latest two months (R3) and returns their `compareCategorySpending`; `null` when fewer than two months.

## 5. Invariants
- **INV1 — Conservation:** `Σ current_minor === Σ(current map values)`; `Σ previous_minor === Σ(previous map values)`; `Σ delta_minor === Σcurrent − Σprevious`. (Nothing created/lost in the comparison.)
- **INV2 — Completeness & uniqueness:** the set of `category_id` in the output equals the union of keys of the two input maps; no duplicates.
- **INV3 — Delta correctness:** every row's `delta_minor === current_minor − previous_minor` (bigint-exact).
- **INV4 — Ranking determinism:** permuting the input maps' insertion order does not change the output (deep-equal).
- **INV5 — Purity:** the input maps are not mutated.
- **INV6 — pct semantics:** `pct_change` is `null` exactly when `previous_minor===0n`; otherwise its sign matches `sign(delta_minor)` and `0` when delta is `0`.

## 6. Edge cases
- A category only in current (previous 0 → pct null, delta>0); only in previous (current 0 → delta<0, pct=−100); both 0 (won't occur since a key implies a value, but if present → delta 0, pct 0). Empty maps → empty list. Large bigints (>2^53) — delta is bigint-exact; pct is display only. Ties in |delta| (deterministic tiebreak). `topMovers` with n larger than available (returns all). `latestTwoMonthKeys`/`monthOverMonthInsight` with 0/1/≥2 months.

## 7. Out of scope
- The exact float value of `pct_change` beyond sign + hand-computed clean cases (it's display-only; bigint deltas are the source of truth). The Svelte Home strip that renders this. A mutation marathon.

## 8. Error contract
Total on well-shaped input; never throws. `latestTwoMonthKeys`/`monthOverMonthInsight` return `null` (not throw) when <2 months.

## 11. Oracle hazards
- **Conservation (INV1) + delta correctness (INV3) are the oracle-free headlines** — a re-implementation would share blind spots; prefer the conservation identities + hand-computed goldens + the permutation-invariance metamorphic relation (INV4). The pct is display-only — verify null-iff-previous-0 + sign + a couple of hand cases (100→150 ⇒ +50%), not exact float equality.
