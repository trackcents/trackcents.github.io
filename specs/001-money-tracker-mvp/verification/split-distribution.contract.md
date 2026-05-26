# Verification Contract — split distribution in summaryFromImports (US-SPLIT)

> Implementation-free. WHAT, not HOW. Focused on the NEW split behavior added to
> `summaryFromImports` (the refund/category behavior was verified separately —
> see refund-resolution.contract.md; do not re-derive that, but DO confirm split
> composes correctly with `ignored`).

## 1. Module under verification
- **Source (do NOT open)**: `src/lib/app/categorization-glue.ts`
- **Public entry point under test**: `summaryFromImports(imports, annotations)`.
- **Risk tier**: P1 (spending-aggregation money path).
- **Touches**: ☑ value/money math ☐ parsing ☐ persistence ☐ concurrency ☐ authn ☐ UI

## 2. Authoritative spec sources
- `specs/001-money-tracker-mvp/spec-rocketmoney-features.md` (split modelling) + `spec-tracker-research-features.md` (US-SPLIT).
- `.specify/memory/constitution.md` — Principle II (bigint cents; conservation).
- You MAY read the TYPES in `src/lib/app/categorization.ts` (TransactionAnnotation, TransactionSplit, transactionCategoryKey), `src/lib/db/store.ts` (ImportRecord), `src/lib/app/spending-summary.ts` (SummaryTransaction). Do NOT read categorization-glue.ts.

## 3. Public interface (signatures only)
```ts
interface TransactionSplit { category_id: string | null; amount_minor: bigint; } // SIGNED, same sign as the parent txn
// annotation may carry: split?: TransactionSplit[]  (and category_id/source/ignored/refund_of/…)
function summaryFromImports(imports: ImportRecord[], annotations: Record<string, TransactionAnnotation>): SummaryTransaction[];
// SummaryTransaction = { posted_date: string; amount_minor: bigint; category_id: string | null }
```

## 4. Behavioral requirements (split-specific)
- **R1 — Unsplit unchanged.** A transaction whose annotation has no `split` (absent or empty array) contributes exactly ONE SummaryTransaction: its full `amount_minor`, with its effective category (own category, or — if `refund_of` is set — the linked original's category).
- **R2 — Split distributes.** A transaction with a non-empty `split` contributes ONE SummaryTransaction PER split part — `{posted_date: txn date, amount_minor: part.amount_minor, category_id: part.category_id}` — IN PART ORDER, INSTEAD of the single full-amount row.
- **R3 — Remainder row.** After the parts, if `remainder = txn.amount_minor − Σ(parts) ≠ 0n`, emit ONE more row `{posted_date, amount_minor: remainder, category_id: effective category of the txn}`. If the parts sum exactly to the txn amount, NO remainder row is emitted.
- **R4 — Ignored wins.** A transaction whose annotation has `ignored === true` contributes NO rows at all, even if it has a split.
- **R5 — posted_date.** Every emitted row (parts and remainder) carries the transaction's own `posted_date`.

## 5. Invariants (the load-bearing ones)
- **INV1 — CONSERVATION (the key property).** For EVERY non-ignored transaction, the sum of the `amount_minor` of all rows it emits equals the transaction's own `amount_minor` — for unsplit, exact-split, partial-split, AND over-split (parts exceed the whole → negative remainder). Therefore the grand total of `summaryFromImports` equals the raw signed sum of all non-ignored transactions, regardless of any splits.
- **INV2 — Row count.** A non-ignored split transaction emits `parts.length` rows when the parts sum exactly to the whole, else `parts.length + 1`. An unsplit non-ignored txn emits 1. An ignored txn emits 0.
- **INV3 — Determinism & purity.** Same inputs ⇒ identical output; inputs not mutated.
- **INV4 — Part fidelity.** Each part's `amount_minor` and `category_id` appear verbatim as an emitted row (parts are NOT re-signed or re-bucketed by the aggregator).

## 6. Edge cases
Unsplit txn (1 row); empty split array (treated as unsplit, 1 row); exact split (n rows, no remainder); partial split (n+1 rows, remainder to txn category); over-split where parts exceed the whole (remainder has OPPOSITE sign — still conserved); single-part split equal to the whole (1 row, no remainder); split on an inflow (positive parts); split with a part category_id null; ignored + split (0 rows); split where a part is 0n; multiple split transactions in one import; a refund_of txn that ALSO has a split (split takes the distribution; remainder uses the effective/refund category).

## 7. Out of scope
- WHERE splits are authored (the transaction-detail UI) and whether parts "should" sum to the whole (the UI guides; the aggregator conserves regardless).
- The refund category-resolution itself (verified in refund-resolution.contract.md) — here only confirm split composes with it for the remainder row.
- detailedRowsFromImports (display list) — unchanged by split.

## 8. Error contract
Total over well-typed input; does not throw. Money is bigint by type.

## 11. Oracle hazards
INV1 conservation is the oracle-FREE load-bearing check — prefer it over re-deriving expected rows. Use hand-computed golden row-sets for the exact/partial/over-split worked examples. Note the sign convention: split parts are SIGNED (same sign as the parent); an over-split yields an opposite-sign remainder — conservation still holds and that is correct, not a bug.
