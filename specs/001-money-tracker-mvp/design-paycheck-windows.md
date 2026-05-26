# Design Note — Paycheck-Window Budgeting (US-P2-D)

**Status**: Deferred — depends on SQLite-WASM persistence (task #43) and at
least 2 supported banks (Chase + one CC issuer minimum).

**Origin**: User feedback 2026-05-23, in their own words:

> "I might have paid a credit card bill, but that money actually comes from my
> first two paychecks. Right? So how do we associate that amount to those
> first two paychecks instead of associating it to third paycheck?"

The user wants a budgeting view that answers: *"For each pair of biweekly
paychecks, here's the income (paychecks + any other deposits like Zelle from
friends), here's where every dollar went (CC payments, bills, transfers,
direct purchases), and here's what's left."*

## Why this is genuinely hard

Money is fungible.  Once a paycheck hits a checking account, dollars from it
are indistinguishable from dollars already there.  Any attribution algorithm
is therefore *opinion*, not *fact* — but the opinion needs to be defensible
and let the user override it.

Three issues amplify the difficulty:

1. **Biweekly income, monthly bills**: 26 paychecks/year vs 12 statement
   periods.  Two months of the year have THREE paychecks, complicating
   "pair-of-paychecks" windowing.
2. **CC payments bridge time**: A CC payment in May covers purchases made
   March–April.  Attributing the *payment* to the May window misses the
   purchasing intent; attributing it to the original purchase windows
   requires linking to the CC statement.
3. **Non-paycheck income**: Zelle from friends, tax refunds, refunds from
   merchants, gift income, interest paid, etc.  All must roll into the
   window's "income side" even though they're irregular.

## Approach

### Step 1 — Paycheck auto-detection

A `paycheck` is a recurring credit transaction with all of:
- `transaction_type === 'deposit'`
- Description matches the payroll regex (`/Payroll|Direct\s+Dep(?:osit)?|SSI|SOC\s+SEC|Treas\s+\d+/i`)
- Same description appears in ≥3 prior periods within the last 90 days, with
  inter-arrival times around 14 days (±2 days)

Output: an array of `Paycheck { date, amount_minor, description, source }`.

A second pass classifies non-paycheck deposits as `other_income`.

### Step 2 — Window definition

Two paychecks form one **budget window**.  Window boundaries:
- `window.start_date` = first paycheck's `posted_date`
- `window.end_date` = (next-next paycheck's date) - 1 day, i.e., the day before
  the NEXT pair starts

For months with 3 paychecks, the third paycheck opens the next window.  No
attempt to roll it into the prior window — the user gets a "bonus paycheck"
window that's typically just savings.

### Step 3 — Attribution (the opinionated part)

Default rule: every transaction (outflow or non-paycheck inflow) is
attributed to the window whose `[start_date, end_date]` range contains its
`posted_date`.

Then, two overrides:

1. **CC-payment redirect**: if a `payment_to_card` outflow has a reconciliation
   link to a CC statement, the user can optionally attribute the payment back
   to the windows when the CC PURCHASES happened (via the linked CC statement's
   transaction dates).  This is the user's "money actually comes from my first
   two paychecks" case.

2. **Manual override**: any outflow can be dragged to any window.  The
   override is persisted as `WindowAttribution { transaction_id, window_id,
   override_type: 'auto' | 'cc_link' | 'manual' }`.

### Step 4 — Window summary

For each window:
- **Income**: sum of paychecks + other_income (deposits not classified as paychecks)
- **Outflows by type**: payment_to_card, transfer, fee, interest, withdrawal,
  refund, other
- **Outflows by category** (future, after US-P2-A): Groceries, Rent, etc.
- **Net**: income - sum(outflows).  Positive = leftover; negative = drew down
  prior savings.

### Step 5 — UI

A horizontal scroller of windows, each card showing:
- Window date range
- Income total (green)
- Outflows total (red)
- Net (color-coded)
- Click → expanded view: every transaction in this window grouped by type/category

## Prerequisites before any implementation

1. **SQLite persistence** (task #43).  Detecting recurring paychecks needs
   multi-month history; the in-memory Phase 0 architecture can't support it.
2. **At least one cross-bank CC adapter** (Amex, BofA, Discover, or Robinhood)
   so the user can validate the CC-payment-redirect flow on more than just
   Chase.
3. **A category layer** (US-P2-A) is helpful but not required — windows
   work with just transaction types as the grouping dimension.

## Open questions for the user when this lands

- Should month-with-3-paychecks treat the 3rd paycheck as a separate
  single-paycheck window, or roll it into the prior pair?
- Default attribution for CC payments: stick with the payment date, or
  auto-redirect to the purchase window when a CC link exists?
- How to display irregular income (Zelle from friends, refunds): grouped with
  paychecks under "Income", or separate?

## References

- US-P2-D in `spec.md` ("Paycheck-to-bills budget view")
- Domain research: WebSearch 2026-05-23 on biweekly budgeting + envelope
  systems (citizensbank.com, ramseysolutions.com, financialaha.com).  The
  consistent pattern across guides: *match each bill to the paycheck that
  arrives before its due date.*

---

## Addendum — User feedback session 2026-05-23 (evening)

The original Step 1–5 above is too simple.  A long conversation with the user
on 2026-05-23 surfaced several requirements that the original design didn't
account for.  Everything below is **deferred — not for v1 implementation** —
but recorded so that when we DO build this, no detail is lost.

### Anchoring + grouping (replaces Step 2 above)

**First-paycheck-anchored grouping, not calendar-based.**  At setup time the
tool finds the earliest paycheck in the user's imported statements and asks:
*"This paycheck on [date] funds which budget month?"*  From that anchor the
tool walks forward, assigning **2 consecutive paychecks per budget month**.

**The forward-offset is per-user.**  Hemanth's example: paycheck received
May 23 mentally funds JUNE bills, not May.  So the user-chosen anchor must
allow that the paycheck date and the budget month it funds are different —
no automatic "paychecks-in-May → May" rule.

### 3-paycheck-month rule (revised — no enforcement)

When 3 paychecks land close together (roughly every 6 months due to 26 vs.
24 cadence mismatch), the **2nd of the 3 (the middle one)** defaults to a
*"savings-suggested"* label.

**Critical:** no rule that says *"an outbound transfer equal to the middle
paycheck must occur."*  The user may:
- Transfer the full amount to an investment account.
- Transfer it partially over multiple days/weeks.
- Leave it in checking entirely.
- Use it to cover last month's deficit (see below).

Tool behavior: **show the target** ("$3,000 marked for savings on [date]"),
**show what actually moved** ("$1,500 transferred to investment account on
[date 1], $700 to investment account on [date 2] — $2,200 of $3,000 target
matched"), **let the user override the label anytime.**

### Deficit-first allocation

If the previous budget month closed with a NEGATIVE carry-forward (overspent),
that deficit is taken out of the next month's middle-paycheck-savings
allocation BEFORE the remainder is labeled as savings.

Example: previous month deficit = $200.  Middle paycheck = $3,000.  Result:
$200 goes to "cover deficit" bucket; $2,800 is labeled "savings-suggested."

### Bonus tracking — separate bucket

Bonuses don't fit the biweekly cadence.  The detector flags any deposit that
breaks the cadence rule (amount AND date AND descriptor mismatch).  User
labels it: paycheck / **bonus** / refund / other.

**Carry-forward must be broken out by source.**  E.g., end of May closes
with $340 leftover, of which the tool knows $250 came from a March bonus and
$90 from regular savings.  June's view shows: *"+$340 carried forward ($250
from bonus, $90 from regular savings)."*

**OPEN QUESTION — needs user input**: Does the user actually want this
breakdown in the UI, or is a single carry-forward number enough?  In the
2026-05-23 conversation the user said they want the breakdown — but during
mentor pushback on scope, they agreed to defer it.  When implementation
begins, re-confirm before building the breakdown logic.

### Cold-start — defer-and-skip

Originally the design said: "ask the user for a starting available balance."
After mentor pushback, the proposed approach for v1 is to **NOT ask** the
cold-start question.  Just track forward — after one full budget month
elapses, the carry-forward number self-computes from actual flows.

**OPEN QUESTION — needs user input**: Confirm at implementation time that
"track forward, skip cold-start" is acceptable.  If the user later wants to
backfill a starting balance, they can edit one settings field.

### Manual entries — same feature as pending entries

NO separate "manual at setup" feature.  ONE form, available at setup +
mid-month + anytime.  Past or future date.  Auto-detection: if the
manually-entered date is older than the earliest uploaded statement, the
epoch quietly extends back to include it.

**Field set:**
- Account (chosen from existing imports)
- Date
- Amount
- Description
- Transaction type (purchase / payment_to_card / transfer / fee / etc.)
- Assign to budget month (defaulted from the date + offset rule, overridable)
- **Note** (free text, see below)

### Notes on every transaction

A free-text note field on every transaction row (statement-confirmed AND
pending).  Notes participate in full-text search alongside the description.

This is also captured as US-P3-E ("Notes and tags on transactions") in
`spec.md`, but in this v2 design the note field exists from day 1 of the
budget feature, not later.

### Auto-allocation default (transaction → paycheck)

**OPEN QUESTION — needs user input**: The default rule for auto-assigning a
transaction to a paycheck has TWO candidate rules:

1. **"Previous paycheck minus offset N"** — simple, uniform across all
   transactions.  Wrong for transactions whose mental allocation diverges
   from the rule (e.g., user pays rent from paycheck X, EMI from paycheck Y,
   but the rule defaults both to the same).
2. **Per-bill-type rules** — "rent always defaults to paycheck-of-funding-X,
   EMI to paycheck-of-funding-Y."  More accurate but requires a UI to
   define the per-bill rules.

When implementation begins, ask the user: *"For your real bills, does
'previous paycheck' work, or do different bill types map to different
paychecks?"*  Recommendation: start with rule #1 for v1; add rule #2 only
if rule #1 produces too many overrides.

### Reconciliation of pending entries → statement transactions

**Suggested, not automatic.**  When a statement is imported, the tool looks
for pending entries that match (same account, similar amount, ±5 days,
description similarity).  For each candidate match, the tool **proposes**
the link and asks the user to confirm.  Never auto-merge silently.

**Two known bug-risks:**
- **Same-amount duplicates** (e.g., two $500 Zelle transfers): the tool must
  enumerate all candidate matches; never link N pending to 1 statement-row
  or vice versa.
- **Slight amount mismatches** (e.g., $500 entered, $503 charged due to
  fees): the tool proposes the match with the diff visible; user confirms
  with the option to record the fee as a separate row.

### Status-as-of-date queries — defer

User wants: *"show me the budget status as of May 31, including payments
physically made in early June that were ALLOCATED to May."*

This is conceptually simple (filter expenses by `budget_month_assigned`,
not by `posted_date`) but requires the per-transaction budget-month
attribution layer to exist first.

**OPEN QUESTION — needs user input**: When this lands, does the user want a
calendar-style date picker, or just a list of past budget months to click?

### MVP cut-list — what we DO build for v1 of the budget feature

After mentor pushback, the agreed v1 set is:

1. Paycheck + bonus detector (with user labeling for irregular deposits).
2. First-paycheck-anchored budget-month grouping (one-time setup question).
3. Auto-allocation of transactions to paychecks using "previous paycheck
   minus offset N" — overridable per row.
4. **One-number** carry-forward per budget month.  Positive or negative.
   No bonus breakdown yet.
5. Manual entries (one form, any date, any account, with notes).
6. Suggested-not-automatic reconciliation when statements arrive.
7. Notes on every transaction.

**Deferred until v1.1+ of the budget feature:**
- Bonus-vs-regular carry-forward breakdown.
- Auto-handling of "deficit eats next month's savings."
- Status-as-of-arbitrary-date queries.
- Drag-to-reassign UI (use a simple "edit row" instead).
- 3-paycheck-month auto-detection with savings-suggested label (just let the
  user mark any paycheck as "savings" manually).

**Prerequisite check at implementation time:**

- Confirm wa-sqlite persistence is in place (task #49), OR confirm the OPFS
  JSON store is acceptable for the budget feature's complexity.
- Confirm at least 2 budget-month cycles of real data are imported so the
  paycheck detector has enough cadence signal.
