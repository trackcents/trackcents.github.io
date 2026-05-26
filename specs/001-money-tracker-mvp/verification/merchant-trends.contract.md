# Verification Contract — merchant-trends

> Implementation-free. States WHAT the module must do + its interface, never HOW.

## 1. Module under verification

- **Source file(s)** (do NOT open): `src/lib/app/merchant-trends.ts`
- **Public entry points**: `merchantTrends`, `priceJumps`, `frequentMerchants`, `largestPurchases`, `centsToDecimal` is NOT here (that's export-csv). Types: `MerchantTxn`, `MerchantTrend`, `LargestPurchase`, `TrendOptions`.
- **Risk tier**: P2 (UX-truth analytics over money data; not a money-mutating path, but money-bearing).
- **Touches**: ☑ value/money math ☐ parsing/untrusted input ☐ persistent state ☐ concurrency/async ☐ authn ☐ running UI

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec-tracker-research-features.md` — §1a (pricewatch), §2 US-PW-A/B, §4 behavioral notes
- `reports/overnight-build/DECISIONS.md` — D6 (adapt price tracking to bank data)
- `.specify/memory/constitution.md` — Principle II (money = bigint cents, no float); the project rule "no amount-based classification" (memory `feedback_no_amount_based_classification`)
- The collaborator `normalizeDescriptor` is a verified dependency (its own module). Its contract: uppercases, strips digit runs and ACH boilerplate tokens and `#*:/\|-` punctuation, collapses whitespace, trims. You MAY read ONLY its signature + body in `src/lib/app/paycheck-detector.ts` as a contracted collaborator, like the recurring-detector contract did.

## 3. Public interface (signatures only)

```ts
interface MerchantTxn { posted_date: string; amount_minor: bigint; description: string; }
interface MerchantTrend {
  merchant_key: string; display_name: string; occurrences: number;
  total_spent_minor: bigint; average_amount_minor: bigint;
  first_date: string; last_date: string;
  first_amount_minor: bigint; last_amount_minor: bigint;
  previous_amount_minor: bigint | null; jump_minor: bigint; jump_pct: number | null;
}
interface LargestPurchase { posted_date: string; description: string; amount_minor: bigint; }
interface TrendOptions { since?: string; }

function merchantTrends(txns: readonly MerchantTxn[], opts?: TrendOptions): MerchantTrend[];
function priceJumps(txns: readonly MerchantTxn[], opts?: TrendOptions): MerchantTrend[];
function frequentMerchants(txns: readonly MerchantTxn[], opts?: TrendOptions): MerchantTrend[];
function largestPurchases(txns: readonly MerchantTxn[], opts?: TrendOptions & { limit?: number }): LargestPurchase[];
```

## 4. Behavioral requirements (WHAT)

- **R1 — Spending only.** Only OUTFLOWS (`amount_minor < 0`) are considered. Inflows (`>= 0`, incl. 0) are excluded from every function. A merchant whose only charges are inflows produces no trend.
- **R2 — Grouping.** Outflows are grouped by `normalizeDescriptor(description)`. A group whose normalized key is the empty string is dropped. `merchant_key` is that normalized key; `display_name` is the original `description` of the group's most-recent (latest `posted_date`) charge.
- **R3 — Minimum occurrences.** `merchantTrends` (and thus `priceJumps`/`frequentMerchants`, which derive from it) emit a merchant only if it has ≥ 2 qualifying charges. `largestPurchases` has no such minimum (it lists individual transactions).
- **R4 — Magnitudes & sums.** All reported amounts are magnitudes (≥ 0): `first/last/previous/average/total_spent` are absolute cents. `total_spent_minor` = sum of the group's charge magnitudes. `average_amount_minor` = `total_spent_minor` divided by `occurrences`, rounded to the nearest cent (half-up on the positive magnitude).
- **R5 — Chronology.** Within a merchant, charges are ordered by `posted_date` ascending. `first_*` is the earliest, `last_*` the latest. `previous_amount_minor` is the magnitude of the charge immediately before the latest (null iff only one charge — which can't happen given R3, so it is always non-null in `merchantTrends` output).
- **R6 — Price jump.** `jump_minor` = `last_amount_minor − previous_amount_minor` (signed: positive ⇒ the charge got more expensive). `jump_pct` = `jump_minor / previous_amount_minor × 100` (null iff previous is null or 0; previous is a magnitude of a non-zero charge so it is ≥ 1).
  - Worked: charges [1599, 1599, 1799] ⇒ previous=1599, last=1799, jump_minor=200, jump_pct≈12.5078.
- **R7 — `priceJumps` filtering & order.** Returns only merchants with `jump_minor ≠ 0`, ordered by `|jump_pct|` descending, ties broken by `|jump_minor|` descending.
- **R8 — `frequentMerchants` order.** All `merchantTrends` results ordered by `occurrences` descending, ties by `total_spent_minor` descending.
- **R9 — `merchantTrends` order.** Ordered by `total_spent_minor` descending, ties by `merchant_key` ascending.
- **R10 — `largestPurchases`.** Lists individual outflow transactions (magnitude), sorted by magnitude descending (ties: later date first is acceptable; any deterministic tiebreak), capped at `opts.limit` (default 10).
- **R11 — Window.** When `opts.since` is given, every function ignores transactions with `posted_date < since` (string compare on ISO dates is valid) BEFORE grouping/ranking.

## 5. Invariants & properties (ALL valid inputs)

- **INV1 — Conservation.** For each merchant, `total_spent_minor` = exact sum of the magnitudes of its (windowed) outflow charges. Re-summing the per-occurrence magnitudes reproduces the total (nothing created/lost).
- **INV2 — Non-negativity.** `total_spent_minor, average_amount_minor, first/last/previous_amount_minor` are all ≥ 0n and are bigint. `occurrences` ≥ 2 in `merchantTrends` output.
- **INV3 — Amount-scale metamorphic (constitution-safe).** Multiplying every transaction amount by a positive integer k scales `total/first/last/previous/average` by k and leaves `occurrences`, ordering by occurrence, `merchant_key`s, and `jump_pct` (a ratio) unchanged (modulo cent-rounding of average). This proves no decision depends on absolute amount size.
- **INV4 — Permutation invariance.** Output is invariant under input reordering (functions sort internally).
- **INV5 — Determinism & purity.** Same input ⇒ identical output; input array is not mutated.
- **INV6 — Count bound.** Number of `merchantTrends` results ≤ number of distinct non-empty normalized descriptors among outflows.

## 6. Domain edge cases that MUST be handled

Empty input; all-inflow input; a single charge per merchant (excluded); exactly 2 charges; zero-amount transactions (excluded as non-outflow); descriptors that normalize to ''; descriptors differing only by digits/`#` (must group); a price increase, a price decrease, and an unchanged latest charge; same-day charges; very large bigint magnitudes (±1e15); `since` excluding all / some / none; `limit` of 0 and larger-than-list.

## 7. Explicitly OUT of scope — do NOT report as bugs

- Item-level / unit-price tracking (needs receipts; deferred — DECISIONS D6/§5).
- Inflow/income trends (R1 limits to spending by design).
- Category awareness (this module is merchant-only).
- The internal tokenization rules of `normalizeDescriptor` (separate module/contract).
- Currency mixing: callers pass a single user's transactions; multi-currency aggregation is not modeled here.

## 8. Error contract (no silent failures)

This module is total over well-typed input: it does not throw. Inputs are already-typed `MerchantTxn[]` (money is bigint by type). There is no untrusted-string parsing here (that's csv-import). It must not crash on empty arrays or all-excluded inputs — it returns `[]`.

## 11. Known oracle hazards

- `jump_pct` is float; assert with tolerance, and prefer the exact bigint `jump_minor` as the primary oracle.
- INV3 scale-invariance of `average_amount_minor` holds only modulo cent-rounding — use exact multiples (k where totals stay integers) or assert average within ±1 cent.
- Tie-break order in R10 is deliberately loose; assert only the documented keys, not incidental ordering.
