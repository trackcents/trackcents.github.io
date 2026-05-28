# Home-screen brainstorm — running notes

_Started 2026-05-27. Group chat: Hemanth (architect), Claude (dev), Bhargav
(manual-only student), Murali (uploader + manual)._

## Core insight (agreed)

The app is **upload-first**, but both personas want **entry-first, upload-secondary**:

- A no-upload user lands on the Statements/PDF dropzone — wrong front door.
- Manual add EXISTS but is buried on the Transactions tab ("+ Add transaction").
- Fix is mostly **routing + home priority**, not new capability.

## The budget-hero "box" (Screenshot 2026-05-27 080722)

Current box: `Spent this month $X / of $Y income` + progress + `Remaining ·
Daily pace · Days left` + `+ Income`.

### Hemanth's requirements for income (the box)

1. **Income has types**, not one lump sum:
   - **Base / recurring income** — Bhargav: monthly pocket money. Murali: salary.
   - **Extra income / bonus** — Bhargav: money from father. Murali: work bonus.
2. **Carry-forward from previous month** — can be **positive OR negative**
   (leftover savings rolls in; overspend rolls in as a deficit).
3. **Editable** — if income is added incorrectly, the user must be able to
   **edit or delete** it (tap the income to fix it). Applies to all income types.

### Decisions so far

- **Carry-forward**: AUTO-SUGGEST + EDITABLE. App computes last month's leftover
  (or deficit, negative) and pre-fills it; user can override. ✅ decided.
- **Box layout**: total income at TOP, **extra income shown at the BOTTOM**.
  Hemanth is sending a reference picture — DO NOT finalize box layout until it
  arrives. ⏳ pending picture.
- **Visualisation**: text specs aren't enough for Hemanth to picture the UI →
  **Claude will GENERATE MOCKUP IMAGES** (mobile screen concepts) so he can see
  before we build. ✅ agreed.

### Recurring income = the paycheck-window problem (Murali) — ALREADY DESIGNED

Murali is paid **biweekly (every 14 days)** and wants **two paychecks to fund one
full month**. This is US-P2-D, spec'd in
`specs/001-money-tracker-mvp/design-paycheck-windows.md` and already built as
pure logic:

- `src/lib/app/paycheck-detector.ts` — detects recurring deposits (recurrence
  only; NO amount-based bonus guessing).
- `src/lib/app/budget-window.ts` — `groupIntoBudgetWindows(paychecks, anchor)`:
  - **Anchored to the FIRST paycheck, not the calendar.** User says once which
    budget month their first paycheck funds.
  - **Solves "statement month ≠ budget month"**: a paycheck posted **May 27** can
    be anchored to fund **June**; `budget_month` is derived from the anchor, not
    `posted_date`. Exactly Murali's case. ✅
  - 2 paychecks → 1 window; trailing odd paycheck → in-progress single-paycheck
    window.
  - **"2 extra paychecks/year" (26 biweekly vs 24)** falls out naturally as a
    13th window; auto-detecting a "3-paycheck calendar month" is deliberately
    DEFERRED (user marks the extra/savings paycheck manually).

What is **NOT built yet** (new work):
1. **Wiring the budget-window logic into the home box** (today it's a simple
   calendar-month budget hero, not paycheck-window-aware).
2. **Live manual entry → later statement upload → intelligent de-dup merge.**
   Murali tracks live by typing transactions; when the monthly bank statement is
   uploaded later, manual rows that match a real statement row must MERGE (not
   duplicate), keeping the user's manual category/note and marking it
   "confirmed by statement". Statements already de-dup by PDF hash; manual↔
   statement transaction de-dup does NOT exist yet. ⚠️ design needed.
3. **Recurring income setup UI** (set salary/pocket-money cadence once).
4. **Income types** in the box: base + bonus(extra) + carry-forward, all
   tap-to-edit/delete.

## Persona home-screen wishlists

**Bhargav 🎓 (manual-only):** big "+ Add expense" as the front door; today's
spends; income shown as base + bonus (e.g. "Pocket money + Dad"); tap income to
edit/delete; carry-forward line (+green / −red, overridable); keep the "safe
daily spend" number. Refs: Money Manager (Realbyte), Walnut, Goodbudget.

**Murali 💼 (uploader + manual):** land on "this month", not the upload box;
quick "+ Add expense" for cash; recurring salary set once (paycheck windows);
don't double-count salary that also appears in an uploaded statement; "this month
vs last month" spend compare; upload = a monthly button, not the home. Refs:
Monarch, Copilot, Cred/Jupiter, YNAB.

## Paycheck → budget-month grouping policy (the hard part)

Hemanth's probe (2026-05-27): Jan paychecks = {Jan2, Jan16, Jan30} (3-paycheck
month) vs {Jan13, Jan27} (clean pair) vs wanting {Dec30, Jan13} as one month.
"Will it matter? Will you ask? How differentiate?"

**Honest position:** dates ALONE cannot tell us the user's intent. The *count*
(2 vs 3) is structure we can detect; *which* paychecks "fund a month" is a human
budgeting decision. So: **detect + default + let the user fix — never silently
guess.** It MATTERS because Remaining / safe-daily-spend math is wrong if a
paycheck sits in the wrong window.

**Policy:**

1. **Two budgeting modes**, chosen by detected income cadence:
   - **Calendar-month (DEFAULT)** — for monthly income (Bhargav's pocket money,
     most people). No paycheck setup at all.
   - **Paycheck-window (OPT-IN / auto-offered)** — when biweekly cadence is
     detected (Murali). Only these users see anchor/cadence setup.
2. **Ask ONCE at setup** (paycheck-window mode only): pay cadence + the **anchor**
   = which budget month the FIRST paycheck funds. The anchor already handles
   "{Dec30, Jan13} = January" — anchor Dec30 → January, pairing follows. ✅
3. **Auto-group** with the default 2-per-window rule from the anchor.
4. **Flag the anomaly, not every paycheck:** when an extra/odd paycheck appears
   (3rd in a month, off-cadence date, missing one), prompt ONCE for THAT
   paycheck: "spend this month / roll to next / mark as savings". The "3rd
   paycheck" and "Dad's bonus" map to the SAME concept = **extra income**.
5. **Always editable** — re-assign a paycheck to a different budget month later.

**Open decision for Hemanth:** on the ambiguous extra paycheck — (a) default
silently + let edit, or (b) actively prompt that one time? Claude leans (b),
prompt-on-anomaly-only. ⏳ + box reference picture incoming.

## Round 2 updates (2026-05-27, after the dark-mode box mockup)

- **Themes:** app has BOTH dark and light. Mockup was dark.
- **The % pill = headroom, NOT spend.** It shows **how much of the month's budget
  is still LEFT to spend**, as a %, and **goes NEGATIVE when overspent**
  (e.g. −8% = 8% over budget). Earlier I misread it as "% spent" — corrected.
  Formula intent: `remaining / total_available × 100`, may be negative.
- **Box "extra income" line** confirmed: `+₹10,000 extra income · tap to manage`
  shown under the total, green, with a tap-to-edit/delete affordance. ✅

### Persona updates

- **Bhargav 🎓→💼:** now an **early-career job holder** (starting soon), works in
  **India (INR)**, but **still adds everything MANUALLY** (no statement uploads).
  → Use **job-holder/“income”/“salary” terminology, NOT “allowance”.** India
  salary is typically **monthly → calendar-month mode** (no paycheck setup).
- **Murali 💼:** works in **America (USD)**, **biweekly** pay → **paycheck-window
  mode**. Uploads statements + manual.
- **Currency is per-user:** Bhargav INR, Murali USD. App already has an INR/USD
  display-currency pref — confirm it's per-user, not global, and that the box,
  daily-pace, etc. all respect it.

### Round 2b (2026-05-27)

- **First-run currency picker:** on first app open, ask **INR or USD** (before/at
  onboarding). Persist as the per-user display currency.
- **Personas are ARCHETYPES, not the only users.** Bhargav & Murali represent two
  *classes* of user; design generically for those classes, not hard-coded names:
  - Class A (Bhargav-like): **manual-only**, monthly income, calendar-month mode.
  - Class B (Murali-like): **uploads + manual**, biweekly income, paycheck-window
    mode.
  Other users will share these shapes; the app must serve the class, not two people.

### Next topic (IN PROGRESS)

**Paycheck model deep-dive** — Hemanth sharing details WhatsApp-style, one small
message at a time. Build the model incrementally; don't jump ahead.

#### CORRECTIONS (2026-05-27) — supersede the earlier "first-paycheck anchor"

1. **Anchor on the PRESENT month, NOT the first paycheck.** The user can't
   meaningfully say which month a 6-month-old paycheck funds, but they DO know
   "these paychecks pay for THIS month." So setup = *"which paychecks fund the
   current month?"* → from that single present-month anchor we extrapolate
   **backward** over history and **forward** as new cheques arrive. (Earlier
   first-paycheck-anchor design in `budget-window.ts` must be reworked to
   present-month anchoring.)

2. **Bank statements do NOT align to calendar months.** An "April statement" can
   contain late-March transactions (e.g. statement period ~Mar 28–Apr 27). So:
   - NEVER bucket by "which statement / statement label = which month."
   - Bucket by the **actual transaction/posting DATES**, then map date → budget
     window via the paycheck pairing. **One statement can feed multiple budget
     months** (e.g. April statement's Mar27+Apr10 → April budget; Apr24 → May
     budget).
   - The current-month statement arrives LATE (May statement not out yet) → May
     is tracked live via manual entry, reconciled when the statement lands.

3. **The date→budget-month mapping is the USER'S intent; dates alone can't encode
   it.** The app detects cadence (biweekly) + dates, but must get the present-
   month anchor explicitly from the user — ONCE. After that it's automatic
   (no per-paycheck, no per-statement asking).

   Worked example — anchor "May = {Apr24, May8}" derives:
   `Jan {Jan2,Jan16} · Feb {Jan30,Feb13} · Mar {Feb27,Mar13} · Apr {Mar27,Apr10}
   · May {Apr24,May8} · Jun {May22,Jun5}`.

4. **Per-paycheck month assignment (NOT pairing).** Each detected paycheck gets
   its OWN month via a dropdown (all 12 months), **auto-suggested** (default =
   the deposit's calendar month, or extrapolated from the rhythm Murali set) and
   **editable**. 1, 2, or 3 cheques can land in one month — the user decides.
   Earlier "2-per-window pairing" is just the auto-suggest heuristic, never a
   hard rule. (e.g. given "Mar27+Apr10 = April", Jan30 auto-suggests February,
   so calendar-Jan's 3 cheques → budget Jan {Jan2,Jan16} + Feb {Jan30}; override
   any.)

#### SIMPLIFICATION (2026-05-27) — opening balance + carry-forward, don't chase history

Don't walk BACK into Nov/Dec to find earlier paychecks. Instead:

- **Statement opening balance = starting income for that month.** The bank
  already rolled up all prior money into the opening balance, so the first
  uploaded month just uses it. No back-hunting.
- **Carry-forward each month (+ or −)** = previous month's leftover/deficit,
  counted as the next month's income (signed).
- **Transfer to a savings/other account = SPENDING** (an outflow), so saved
  money correctly leaves "remaining" and nothing is double-counted.
- **Monthly summary / "Month statistics"** at the month boundary (1st / last
  day): a per-month rollup. New surface to design.

RESOLVED: a month's income = `carry-in + cheques tagged to that month`. Which
cheques are "tagged" is known by **back-tracing from the present-month anchor**
(so Jan30 is tagged Feb → excluded from Jan). All tags user-overridable.

#### Bank = source of truth; live tracking = provisional, reconciled on upload (2026-05-27)

Confirmed we already extract `opening_balance_minor` + `closing_balance_minor`
per statement, and the checksum enforces `opening + Σtxns = closing`. So:

- **The bank statement is authoritative.** Its opening/closing balances and
  transactions are the final truth.
- **Carry-forward is a PROXY for the not-yet-known opening balance, NOT an
  addition.** Live (pre-statement) a month starts from the prior month's
  carry-forward; when the statement lands, the **real opening balance supersedes
  it** (bank wins). One replaces the other → no double-count.
- **Live manual entries are provisional estimates** so the budget is live before
  the (late) statement arrives. On upload, **reconcile**:
  - manual ⇄ statement row match → **merge** (keep user's category/note, adopt
    statement's authoritative amount/date, mark "✓ confirmed by statement").
  - manual with no statement match → it's **cash** (keep) or a mistake (flag).
  - statement row never entered → just add it.
- **Free correctness check:** after reconcile, our running balance must equal the
  statement's **closing balance**; if not, surface the gap (checksum-style).
- Net: live numbers are an estimate the monthly statement later **certifies** and
  corrects (showing any drift).

This is the hard/spicy feature (Murali's #1 ask). New work: the manual↔statement
transaction reconciler + balance self-check.

#### CORRECTION — carry-forward ≠ statement opening balance (2026-05-27)

Hemanth caught that the earlier "statement opening balance supersedes carry-
forward" is too simple. Two reasons:

1. **Credit card ≠ bank.** A CC "balance" is **debt owed**, not cash. Carry-
   forward / opening balance / cash-available comes **ONLY from the bank/debit
   account.** The CC supplies *what was bought* (spend detail); the real cash
   outflow happens when the bank pays the card bill (already drilled, US-P1-D).
   Never derive a carry-forward from a CC statement.

2. **Statement period ≠ budget month ≠ calendar month.** The "May statement" may
   run ~Apr 28–May 27, so its opening balance is the cash on Apr 28 — NOT the
   user's budget-May boundary. So **April carry-forward will often NOT equal
   May's statement opening balance. We CANNOT pick that number directly.**

**How we actually do it:**

- The **budget ledger chains on its own**: each month `carry-in + tagged income −
  spend = carry-out → next carry-in`. It's just **re-bucketing the same real
  transactions** into the user's months.
- **Conservation guarantees it ties out:** `total income − total spend = real
  change in bank balance`. Any single month's edge may differ from the statement,
  but the WHOLE reconciles to reality.
- Statement's role: authoritative transactions (merge/confirm) + its own
  `opening + Σ = closing` proves correct parsing.
- **Show the bank's actual balance SEPARATELY** ("as of <date>") as a reality
  check. Do NOT force "budget remaining" to equal it — they reconcile in TOTAL,
  not per fuzzy month.
- Statement opening balance = first-month BOOTSTRAP only (approx), from the BANK
  account.

#### OVERRIDE — the APP balance is final; no bank reconciliation (2026-05-27)

Hemanth's call, supersedes the reconciliation/reality-check stuff above:

- **The app's balance is the SOURCE OF TRUTH, not the bank statement.** The user
  has freedom to hold a balance that isn't in any statement (cash, manual
  entries, etc.). So **do NOT compare/validate the app balance against the bank's
  balance.** Drop the "bank balance on the side / closing-balance reality check"
  idea entirely.
- App balance is just the simple running math:
  `last month's leftover + this month's income − spending = what's left`.
- **(Import-time parse checksum `opening + Σ = closing` is separate — that only
  proves we read the PDF correctly, it is NOT a budget check. It stays.)**
- **Live-manual ↔ statement de-dup still applies** (so a transaction typed live
  AND present in the uploaded statement isn't counted twice in the APP) — that's
  internal correctness, not a bank check. ✅ confirmed.
  - **Merged review screen (decided: option b).** A dedicated post-upload review
    screen (like the categorization `categories/review` pattern) lists every
    auto-merge: `manual entry ⇄ statement row`, what was kept (user's note +
    category), with **[edit]** and **[un-merge]** per row — so a wrongly-joined
    pair (two different ₹500s same day) can be split back. User sees + controls
    exactly what was matched.

#### Matching + date-vs-month + recalculation (2026-05-27)

- **Drop name comparison.** Match candidates on **amount + date** only.
- **Transaction date ≠ the month it counts in.** Example: a bill DUE June 4 but
  PAID today (May 27). The user wants it in **June**, not May.
  - Manual entry: user types the **June date** → counts in June.
  - From a statement: it arrives dated **May 27** → user must be able to **edit
    the date / move it to another month** so it lands in June, not May.
- **Editable date on ANY transaction, including credit-card-statement rows** —
  lets the user move a transaction to the correct month. (Keep the original
  statement date on record for provenance; the editable one drives budgeting.)
- **Late / back-dated adds trigger full recalculation.** If the user adds a
  forgotten April payment now, EVERYTHING downstream recomputes (April totals →
  carry-forward → May → June …). Cheap because it's just running math; just make
  sure every month + carry-forward re-derives, not only the current month.
- **Consequence of dropping name + dates being movable:** auto-merge by
  amount+date will MISS the prepaid-bill case (manual June 4 vs statement May 27,
  same amount, different date). So those surface in the **merge review screen** as
  *"same amount, different date — same payment?"* for the user to link or keep
  separate. No silent double-count, no silent wrong-merge.

#### Split entry: total-anchored auto-remainder (2026-05-27)

Receipt item prices are pre-tax; the bill total includes tax, so summing
categories by hand under-counts (tax goes missing) and won't match the statement.

**Fix — at MANUAL ENTRY time (not just merge):**
- The user first enters the **TOTAL** (from the receipt in hand), e.g. **$200**.
- Tags the categories they know, e.g. **dresses = $140**.
- The app **auto-fills the LAST category = total − the rest** → groceries =
  $200 − $140 = **$60** (the tax lands inside that remainder; or add a "Tax"
  line and remainder still balances).
- So the manual split **already sums to the total ($200)** → when the statement's
  $200 arrives it matches exactly, clean auto-merge, no mismatch.
- Rule: the user NEVER hand-calculates the final category; it's always
  `total − (tagged categories)`. Anchored to the user-entered total.
- **Credit-card overpayment / credit balance:** sometimes the user overpays a
  card, so the card owes THEM (shows as a `+` on the CC statement). The user will
  **manually enter that as income**. **Do NOT automate** detecting CC credit
  balances.
  - **SUPERSEDED 2026-05-27 (later):** don't have the user enter overpay as income
    at all. Rule = **count CC PURCHASES as expenses, NOT bank-to-card payments**
    (those are transfers). Overpay = a transfer to a "card credit pool"; app
    detects automatically when bank payment > the cycle's CC purchases.
    Future card swipes absorbed by the credit STILL count as expenses (read from
    the next CC statement). Each month's "Spent" is always the actual purchases
    that month — honest, no inflation, no missing money. The pool is shown as a
    side badge (*"$30 on Chase 🏷️"*) — not part of income/spend math.

#### Round 3 decisions (2026-05-27 late)

1. **3-paycheck month rule** (when a calendar month has 3 paychecks, e.g. Jan
   {Jan2, Jan16, Jan30} or Jul {Jul3, Jul17, Jul31} in 2026):
   - **1st cheque → this month** (default, auto)
   - **3rd cheque → next month** (default, auto — pairs with next month's 1st)
   - **2nd / MIDDLE cheque → ask the user**, with **3 options**:
     **(a) this month, (b) next month, (c) save it** (set aside, not added to
     either month's budget).
   - Only nudge user **twice a year** (the two 3-paycheck calendar months).

2. **Date-match rule on merge** (live manual ↔ statement):
   - Match by **amount** (within a sensible date window).
   - **Salary / income → statement date OVERWRITES the user's date.** (Real
     deposit date determines which paycheck-window the cheque funds; user's
     start-of-month guess gets corrected to the truth.)
   - **Expenses (and ALL other tx) → user's date STAYS.** Statement does NOT
     overwrite. (User intentionally set a date — e.g. prepaid June bill paid
     May 27 — trust the intent.)

3. **Mode detection (calendar-month vs paycheck-window):** AUTO-DETECT biweekly
   cadence from uploaded statements. If the paycheck detector sees a ~14-day
   rhythm → offer paycheck-window mode. Otherwise default to calendar-month.

4. **Savings / transfer to another account:** default = **counts as spending**
   (the money left the budget). User can mark a transfer as **"Savings"** to
   pull it out of spending and into a savings bucket (visible separately).
   Default spend, user-overridable.

5. **% headroom pill goes NEGATIVE on overspend** — show e.g. `−8%` in red,
   do NOT floor at 0%. Overspend should sting honestly.

6. **"Scenario 2" of paychecks** — Hemanth: skipped; core logic is captured,
   no separate scenario needed.

#### Still parked / unaddressed

- **Monthly Summary / "Month statistics" screen** (`*"every month 1st or last date
  oka summary la undaali"*`): concept noted but **layout + content not designed yet.**
