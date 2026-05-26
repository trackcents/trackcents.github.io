# Verification Contract — transfer-detector (US-P3-D)

> Implementation-free. WHAT, not HOW.

## 1. Module under verification
- **Source (do NOT open)**: `src/lib/app/transfer-detector.ts`
- **Public entry points**: `detectTransfers`. Types: `TransferTxn`, `TransferPair`, `TransferOptions`.
- **Risk tier**: P1 (decides what counts as spending vs an internal move — money-adjacent).
- **Touches**: ☑ value/money math ☐ parsing ☐ persistence ☐ concurrency ☐ authn ☐ UI

## 2. Authoritative spec sources
- `specs/001-money-tracker-mvp/spec.md` — US-P3-D ("Detect and link transfer between own accounts so they don't show up as spending").
- `.specify/memory/constitution.md` — Principle II (bigint cents); the no-amount-based-classification rule (this is STRUCTURAL pairing, not size→meaning).

## 3. Public interface (signatures only)
```ts
interface TransferTxn { key: string; account_id: string; posted_date: string; amount_minor: bigint; description: string; }
interface TransferPair {
  outflow_key: string; inflow_key: string; amount_minor: bigint;
  out_account_id: string; in_account_id: string; out_date: string; in_date: string;
  gap_days: number; confidence: 'high' | 'medium';
}
interface TransferOptions { maxGapDays?: number; }
function detectTransfers(txns: readonly TransferTxn[], opts?: TransferOptions): TransferPair[];
```

## 4. Behavioral requirements
- **R1 — Pair definition.** A pair is an OUTFLOW (amount_minor < 0) in account A matched to an INFLOW (amount_minor > 0) in a DIFFERENT account (account_id ≠) whose magnitude equals the outflow's magnitude (|out| === in) and whose dates are within `maxGapDays` (default 5) inclusive.
- **R2 — Same-account never pairs.** Two transactions with the SAME account_id are never paired, even if equal-and-opposite and same-day.
- **R3 — Magnitude exactness.** Magnitudes must be exactly equal (bigint); a 1-cent difference does not pair.
- **R4 — Window.** `gap_days = |in_date − out_date|` in whole days; a pair with gap > maxGapDays is rejected. Boundary (gap === maxGapDays) is accepted.
- **R5 — Used at most once.** Each transaction (by key) appears in at most one pair. When an outflow has multiple eligible inflows, the SMALLEST-gap one is chosen (ties broken deterministically, e.g. by inflow key); the chosen inflow is then unavailable to later outflows.
- **R6 — Confidence.** `'high'` iff either leg's description matches a transfer hint (transfer/xfer/to savings/to checking/wire/zelle/move to/online banking transfer, case-insensitive); else `'medium'`.
- **R7 — Output fields & order.** Each pair carries both keys, the magnitude (≥ 0), both account_ids, both dates, gap_days, confidence. Output sorted by out_date ascending (ties by outflow_key).

## 5. Invariants
- **INV1 — Determinism & purity.** Same multiset of inputs ⇒ identical output regardless of input order; input array not mutated.
- **INV2 — Disjoint keys.** Across all returned pairs, every outflow_key is unique, every inflow_key is unique, and no key is used as both.
- **INV3 — Magnitude ≥ 0 & bigint.** amount_minor in every pair is a positive bigint equal to the magnitudes of both legs.
- **INV4 — Cross-account.** out_account_id ≠ in_account_id for every pair.
- **INV5 — Window respected.** 0 ≤ gap_days ≤ maxGapDays for every pair.
- **INV6 — Count bound.** Number of pairs ≤ min(#outflows, #inflows).

## 6. Edge cases
Empty input; only outflows / only inflows; equal-and-opposite but SAME account (no pair); two inflows competing for one outflow (closest gap wins, other stays free); two outflows competing for one inflow (only one pairs — used-once); gap exactly maxGapDays (accept) vs maxGapDays+1 (reject); magnitude off by 1 cent (no pair); zero-amount txns (neither outflow nor inflow → ignored); descriptor hint vs none (confidence); maxGapDays = 0 (only same-day pairs).

## 7. Out of scope
- WHETHER the user actually wants a detected pair excluded (the UI confirms; this only SUGGESTS).
- Three-way / split transfers (one outflow to two inflows) — only 1:1 pairing.
- Building account_id from imports (the caller derives it from bank+type+last4).
- Actually excluding from spending (the `ignored` annotation does that elsewhere).

## 8. Error contract
Total over well-typed input; does not throw. Money is bigint by type.

## 11. Oracle hazards
INV2 (disjoint keys) + INV4 (cross-account) + INV6 (count bound) are oracle-free structural checks — prefer them. The greedy closest-gap choice is the one spot a reference model must replicate exactly; verify it with directed competing-candidate cases and hand-computed expectations, not only the scoreboard.
