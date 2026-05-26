# Verification Contract — refund resolution + spending netting (US-P3-C)

> Implementation-free. WHAT, not HOW.

## 1. Module under verification

- **Source file(s)** (do NOT open): `src/lib/app/categorization-glue.ts`
- **Public entry points**: `resolveEffectiveCategory`, `summaryFromImports`, `detailedRowsFromImports`, `categorizableFromImports`.
- **Risk tier**: P1 (affects the spending-aggregation money path — a refund must not be double-counted).
- **Touches**: ☑ value/money math ☐ parsing ☐ persistent state ☐ concurrency ☐ authn ☐ UI

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec-tracker-research-features.md` — US-P3-C (refunds) is in the broader spec; `spec.md` US-P3-C: "Link a refund transaction to the original purchase. Refunds reduce category totals correctly, not double-counted."
- `reports/overnight-build/DECISIONS.md` — D12 (refund nets by inheriting the original's category).
- `.specify/memory/constitution.md` — Principle II (bigint cents, no float).
- You MAY read the types in `src/lib/app/categorization.ts` (TransactionAnnotation incl. `refund_of`), `src/lib/db/store.ts` (ImportRecord), and `src/lib/app/spending-summary.ts` (SummaryTransaction) — these are the data contracts, not the DUT.

## 3. Public interface (signatures only)

```ts
function resolveEffectiveCategory(
  annotations: Record<string, TransactionAnnotation>,
  key: string
): string | null;

function summaryFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): SummaryTransaction[]; // { posted_date, amount_minor: bigint, category_id: string|null }

function detailedRowsFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): DetailedRow[]; // adds key, description, bank_name, ignored, refund_of?

// annotation key = `${pdf_source_hash}#${txIndex}` (transactionCategoryKey).
```

## 4. Behavioral requirements

- **R1 — Own category by default.** With no `refund_of`, `resolveEffectiveCategory(ann, key)` = the annotation's own `category_id` (or null if absent/unset).
- **R2 — Refund inherits original's category.** If `annotations[key].refund_of === origKey` and `annotations[origKey]` exists, the effective category = `annotations[origKey].category_id ?? null` — NOT the refund's own category.
- **R3 — One hop only.** A refund of a refund is NOT chased: resolution follows `refund_of` exactly once. (If origKey itself has a refund_of, that is ignored.)
- **R4 — Safe fallback.** If `refund_of` is `''`, equals `key` (self), or points to a missing key, fall back to the transaction's own `category_id`.
- **R5 — Netting in summaryFromImports.** Each non-ignored transaction contributes `{posted_date, amount_minor, category_id: resolveEffectiveCategory(...)}`. Ignored transactions (`ignored === true`) are omitted entirely. Consequence (the load-bearing property): a refund linked to a purchase lands in the SAME category, so summing signed amounts nets the refund against the purchase.
- **R6 — detailedRowsFromImports.** Emits one row per transaction (incl. ignored, flagged), `description` = custom_name if set else parsed description, `category_id` = the row's OWN annotated category (NOT resolved — display shows the row's own label), and `refund_of` present iff the annotation has a non-empty refund_of.

## 5. Invariants & properties

- **INV1 — Conservation / no double-count.** For any set of transactions where every refund is linked to a purchase in the same dataset, the sum of all `summaryFromImports` amounts EQUALS the raw signed sum of all non-ignored transaction amounts (refund linking only RELABELS the category; it never changes totals). Linking a refund must not create or destroy money.
- **INV2 — Netting reduces the original category.** Given purchase P (−p, category C) and refund R (+r, refund_of=P), the sum of amounts with effective category C decreases by r relative to R being uncategorized. Specifically C's total = −p + r.
- **INV3 — Determinism & purity.** Same inputs ⇒ identical output; inputs not mutated.
- **INV4 — Idempotent labelling.** `resolveEffectiveCategory` does not depend on iteration order of the annotations record.

## 6. Edge cases that MUST be handled

Empty imports; no annotations; refund_of → missing key; refund_of === own key (self); refund_of → a key that is itself a refund (one-hop only, not chased); refund of an uncategorized purchase (effective = null); an ignored refund (omitted from summary entirely); multiple refunds of the same purchase; a refund whose own category differs from the original (original wins).

## 7. Out of scope — do NOT report as bugs

- WHETHER a transaction "should" be a refund (the user links it; no auto-detection here).
- The actual category-total aggregation (that's spending-summary.ts, separately verified) — here only verify the {amount, category} pairs handed to it.
- Multi-hop refund chains (R3 pins one hop by design).
- Cross-device sync of refund_of (deferred, task #79).

## 8. Error contract

Total over well-typed input; does not throw. A `refund_of` pointing nowhere is a safe fallback (R4), not an error. Money is bigint by type.

## 11. Known oracle hazards

INV1 conservation is the strongest oracle-independent check (sum is invariant under relabelling) — prefer it over re-deriving expected category assignments. Use hand-computed golden values for the worked P+R netting example.
