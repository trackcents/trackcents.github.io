# Feature spec addendum — Rocket-Money-inspired + manual-tracker features

> Extends the v1 spec with features the user requested after using Rocket Money
> (screenshots studied 2026-05-26) + manual-entry tracker ideas. Stays within the
> constitution: PDF/manual data only (NO bank linking/Plaid), on-device, money as
> bigint cents, no amount-based classification, no telemetry. Where a Rocket Money
> feature depends on bank links or paid bill-negotiation, it is OUT of scope.

## Placement (which screen / module each feature lives in)

| Feature | User story | Screen / module |
| --- | --- | --- |
| Recurring/subscription detection + bill calendar + per-year totals | US-P3-A | new `/recurring`; logic `src/lib/app/recurring-detector.ts` (generalizes paycheck-detector to outflows) |
| Transaction actions: rename, note, tags, ignore/exclude, mark-recurring, split, create-rule | US-P3-E + new | `src/lib/app/categorization.ts`/annotation overlay + a transaction-detail sheet; table + Today |
| Tags (define, tag, filter/group) | US-P3-E | annotation overlay `tags: string[]`; `/transactions` filter; spending "Tags" tab |
| Spending screen upgrades: period W/M/Q/Y, income-vs-spend bars, net income, include-bills toggle, frequent merchants, largest purchases, fees & interest, needs-categorization queue | US-P2-B+ | `/dashboard` (or a `/spending` view) + `src/lib/app/spending-summary.ts` extensions |
| Refund tracking (link refund → purchase; reduces category totals) | US-P3-C | annotation overlay `refund_of` + aggregation adjustment |
| Review-Categories quick flow (one card at a time) | US-P2-A+ | `/categories/review` |
| Manual transaction entry + Cash pseudo-account | US-P3-B | `src/lib/app/manual-entry.ts` + `/transactions` "Add" |
| Export to CSV | US-P4-D | `src/lib/app/export-csv.ts` + button |
| Per-category monthly budgets + over-budget alerts | US-P4-A | `/budget` + `src/lib/app/category-budget.ts` |
| Savings goals | US-P4-B | `/goals` (research-dependent) |

## Behavioral notes (reasoned; see reports/overnight-build/DECISIONS.md)

- **Recurring**: a normalized-descriptor merchant with ≥2 charges at ~biweekly/monthly cadence is
  "recurring"; next-due = last + median gap. Structure-based, never amount-based. User can override.
- **Ignore**: `ignored` flag on the annotation; excluded from all spend aggregations, shown greyed.
- **Split**: annotation `split: {category_id, amount_minor}[]` summing to the txn amount; original parse
  immutable; aggregation distributes across the split.
- **Refund**: annotation `refund_of: <txnKey>`; the refund's positive amount reduces the linked
  purchase's category total (not double-counted as income).
- **Tags**: many-to-many free labels; orthogonal to the single category.
- All new editable fields live in the existing local categorization/annotation store (encrypted at rest);
  cross-device sync of these is the deferred merge-extension task (#79), unchanged.

## Out of scope (Rocket Money features we deliberately skip)
Bank-link auto-import (Plaid), bill negotiation / "cancel for you" concierge, credit-score monitoring,
"experts will lower your bills" — all require third-party services / paid ops, against constitution III/XIII.
