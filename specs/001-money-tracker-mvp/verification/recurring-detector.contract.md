# Verification Contract — recurring-detector

> Implementation-free. WHAT the module does + interface. Verifier authors its env
> from this alone; never reads the source.

## 1. Module
- Source (do NOT open): `src/lib/app/recurring-detector.ts`
- Public: `detectRecurring(txns: readonly RecurringTxn[]): RecurringStream[]`
- Risk: P2 logic (no money math beyond median magnitude; date arithmetic).

## 2. Spec sources
- `specs/001-money-tracker-mvp/spec-rocketmoney-features.md` (US-P3-A recurring), `.specify/memory/constitution.md`,
  memory rule: **no amount-based classification** — detection uses descriptor + spacing ONLY, never amount.

## 3. Interface
```typescript
interface RecurringTxn { posted_date: string /*ISO YYYY-MM-DD*/; amount_minor: bigint; description: string; }
type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'irregular';
interface RecurringStream {
  stream_key: string; display_name: string; direction: 'inflow' | 'outflow';
  cadence: Cadence; occurrences: number; last_date: string; next_due: string | null;
  typical_amount_minor: bigint; confidence: 'high' | 'medium' | 'low';
}
function detectRecurring(txns): RecurringStream[];
```
`normalizeDescriptor` (from `src/lib/app/paycheck-detector.ts`, exported) groups by descriptor (upper-cases, strips digits/ACH tokens/punctuation).

## 4. Behavioral requirements
- **R1** A descriptor (normalized) appearing ≥2 times forms one stream; <2 → excluded. Each input txn with amount 0 OR empty normalized descriptor is skipped.
- **R2** Cadence from the MEDIAN gap (days) between consecutive sorted dates: 6–8 weekly, 12–16 biweekly, 26–33 monthly, else irregular.
- **R3** `next_due` = last_date + round(median gap) for non-irregular; `null` for irregular.
- **R4** `direction` = inflow if >half the occurrences are positive amounts, else outflow.
- **R5** `typical_amount_minor` = median of the absolute amounts (always ≥ 0).
- **R6** `occurrences` = group size; `last_date` = latest posted_date; `display_name` = the latest occurrence's original description.
- **R7** confidence: high if ≥3 occurrences AND regular AND non-irregular cadence; medium if regular non-irregular; else low. ("regular" = max gap deviation from median ≤ max(4, 25% of median).)
- **R8** Output sorted by `next_due` ascending; nulls (irregular) last.

## 5. Invariants
- INV1 Every output stream's `occurrences ≥ 2`. INV2 `typical_amount_minor ≥ 0n` always. INV3 stream count ≤ number of distinct normalized descriptors. INV4 pure: input array not mutated; deterministic. INV5 a `next_due`, when present, is strictly after `last_date`.

## 6. Edge cases
empty input; all-same-day duplicates (median gap 0 → not a stream); 2 vs 3+ occurrences; mixed inflow/outflow under one descriptor; descriptors differing only by digits group together; large bigint amounts; irregular spacing.

## 7. Out of scope
Amount-based heuristics (forbidden); merchant-logo/icon mapping (UI); calendar rendering; the `/recurring` Svelte screen.

## 8. Error contract
Total function — never throws on valid `RecurringTxn[]`; returns `[]` for empty/no-recurring.

## 11. Oracle hazards
Hand-derive cadence/next_due for golden cases; date math via UTC day-count. Median for even counts = average of the two middle (document if DUT differs — that's a finding).
