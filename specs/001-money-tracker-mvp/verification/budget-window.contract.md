# Verification Contract — Budget-month grouping (`budget-window.ts`)

> Implementation-free. Describes WHAT the module must do and its interface, never HOW.
> Produced by the Designer for the IV&V `verification-engineer`. Do NOT open the source file named below.

## 1. Module under verification

- **Source file (do NOT open)**: `src/lib/app/budget-window.ts`
- **Increment / task**: US-P2-D Increment 2, task #61
- **Risk tier**: P2 (budget-planning logic; money-adjacent but performs no money arithmetic)

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/design-paycheck-windows.md` — the budget-window design note. Especially:
  - "Approach → Step 2 — Window definition"
  - "Addendum → Anchoring + grouping (replaces Step 2 above)"
  - "Addendum → MVP cut-list" (what is built vs deferred)
- `.specify/memory/constitution.md` — Principle II (money is integer minor units / `bigint`, never floats).

## 3. Public interface (signatures only)

```ts
// Which budget month the FIRST (earliest) detected paycheck funds.
export interface BudgetAnchor {
  year: number; // 4-digit calendar year, e.g. 2026
  month: number; // calendar month, 1 (Jan) – 12 (Dec)
}

export interface BudgetWindow {
  index: number; // sequential 0-based, chronological
  budget_month: string; // "YYYY-MM" — the budget month this window funds
  paychecks: Paycheck[]; // the 1 or 2 paychecks funding this window, chronological
  start_date: string; // ISO YYYY-MM-DD — the window's first paycheck's posted_date
  end_date: string | null; // ISO YYYY-MM-DD — day before next window opens; null for the last window
  complete: boolean; // true iff the window has its full 2 paychecks
}

export function groupIntoBudgetWindows(paychecks: Paycheck[], anchor: BudgetAnchor): BudgetWindow[];

// `Paycheck` (defined elsewhere; quoted here so you need not open its source):
interface Paycheck {
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // positive, minor units (cents)
  description: string;
  import_index: number;
  transaction_index: number;
  confidence: 'high' | 'medium' | 'low';
  stream_key: string;
}
```

## 4. Behavioral requirements (the WHAT)

- **R1 — Anchored labeling.** The budget month that the FIRST (earliest) paycheck funds is given by the caller as `anchor`. The first window's `budget_month` equals the anchor. The anchor's calendar month may differ from the paycheck's own posted_date month (a paycheck posted in late May may fund June) — the function must NOT derive the budget month from the paycheck dates; it uses the anchor.
- **R2 — Two paychecks per budget month.** Paychecks are grouped, in chronological order, into windows of two consecutive paychecks each.
- **R3 — Trailing single.** If the paycheck count is odd, the final window contains the one leftover paycheck.
- **R4 — Window boundaries.** `start_date` is the window's first paycheck's `posted_date`. `end_date` is the day immediately before the next window's `start_date`. The final (most recent) window has `end_date = null` (it is still in progress; the next pair hasn't arrived).
- **R5 — Label advance.** Across windows, `budget_month` advances by exactly one calendar month per window, starting from the anchor, formatted "YYYY-MM". This wraps correctly across year boundaries.
- **R6 — Complete flag.** `complete` is true exactly when the window holds two paychecks.
- **R7 — Ordering / robustness.** Output windows are in chronological order with sequential `index` from 0. The function must produce correct chronological grouping even if the input array is not pre-sorted by date.
- **R8 — Empty input.** Zero paychecks yields zero windows.
- **R9 — Deterministic same-date ordering.** When two or more paychecks share the same `posted_date`, their order (and therefore which window each lands in) MUST be deterministic and independent of the caller's input array order: ties break by `import_index`, then by `transaction_index`, both ascending. (Resolved by architect 2026-05-23.)

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Conservation.** Every input paycheck appears in exactly one output window; none lost or duplicated.
- **INV2 — Amount-blind.** The grouping depends only on dates/order and the anchor, never on `amount_minor`. Scaling or changing amounts must not change the window structure, dates, labels, or counts.
- **INV3 — Date-translation.** Shifting every paycheck's `posted_date` by a constant number of days shifts each window's `start_date`/`end_date` by the same amount, while structure (counts, completeness) and `budget_month` labels are unchanged.
- **INV4 — Count.** Number of windows equals ceil(n / 2) for n paychecks.
- **INV5 — Contiguity.** Windows are non-overlapping and contiguous in time: each non-final window's `end_date` is exactly one day before the next window's `start_date` — EXCEPT when that would fall before the window's own `start_date` (possible only when consecutive windows share an identical `start_date`, e.g. 3+ paychecks on one date), in which case `end_date` is clamped to equal `start_date`. (Clamp resolved by architect 2026-05-23.)
- **INV6 — No inverted window.** For every window, `start_date <= end_date` whenever `end_date` is non-null. A window may be zero-length (`start_date == end_date`) but never inverted.

## 6. Domain edge cases that MUST be handled

- 0, 1, 2, 3, 4, 5 paychecks.
- Two paychecks sharing the same `posted_date` (e.g., a split direct deposit on one day).
- Three or more paychecks sharing one identical `posted_date` (degenerate; exercises the INV5 clamp / INV6).
- Unsorted input (R7) AND same-date ties whose input order is permuted (R9 — output must be identical).
- Anchor whose month is December (label must roll into the next year).
- Long series spanning a full year or more.

## 7. Explicitly OUT of scope / deferred — do NOT report these as bugs

Per `design-paycheck-windows.md` "MVP cut-list → Deferred":

- **3-paycheck-month auto-detection / "savings-suggested" labeling** — deferred. The function does NOT special-case months with 3 paychecks; it just pairs chronologically. Do not test for any savings/bonus labeling.
- **Attribution of outflows/transactions to windows** — a later increment; not in this function.
- **Carry-forward / deficit math** — a later increment; not in this function.
- **Detecting the anchor automatically** — out of scope; the anchor is supplied by the caller.

## 8. Error contract (no silent failures — Constitution-aligned)

- An invalid `anchor.month` (not an integer in 1–12) MUST cause the function to **throw**, not silently mislabel. The error message should reference `anchor.month`.
- A valid `anchor.year` is an integer in **1970–9999** inclusive (1970 = a sane floor; no digital bank statements predate it). Any value outside that range MUST **throw**, referencing `anchor.year`. Test both sides of the boundary: 1969 throws, 1970 valid, 9999 valid, 10000 throws. (Range resolved by architect 2026-05-23.)
- Decide from the spec what "valid" means and test both sides of each boundary.

## 9. Known oracle hazards (Knight & Leveson note)

- **Budget-month label arithmetic across year boundaries.** Compute expected "YYYY-MM" labels by hand from the anchor + window index; do not trust round-tripping through any date object. Watch December→January wrap and multi-year spans.
- **"Day before" date math.** Derive expected `end_date` independently (e.g., from the next window's `start_date` minus one calendar day), accounting for month/year boundaries.
