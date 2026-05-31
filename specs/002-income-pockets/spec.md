# Income Pockets — feature spec (LIVING DOCUMENT)

> **Status:** being designed *interactively* with Hemanth (the app owner) over a
> back-and-forth chat, 2026-05-31. This file is the single source of truth for
> that conversation — append to it as the discussion progresses; never lose a
> decision. Written so any future AI/engineer can pick it up cold.
>
> **How to read this:** sections are marked **[DECIDED]** (agreed, build it) or
> **[OPEN]** (still to be discussed with Hemanth — do NOT assume).

---

## 1. The core problem (in Hemanth's words)

When he opens his checking account, **the balance does not tell him how much money
is actually his to use.** A large part of e.g. $18,400 is already promised to
upcoming bills — EMIs, credit-card payments, money owed to people, planned
savings. The bank number "lies." He wants the app to show, at a glance, **how
much is truly remaining / free after everything already committed.**

He has done this manually every paycheck for years in a WhatsApp chat
("Expenses/Payments"). Screenshots of that are the ground truth for his method
(see §7).

---

## 2. The model: INCOME POCKETS  **[DECIDED]**

Income is **not one combined number.** It is split into several named **pockets**
(a.k.a. boxes). Each pocket is tracked **separately and identically**.

- **Default pockets:**
  - 💵 **Paychecks** — the regular recurring (biweekly) salary.
  - 🎁 **Extra** — everything that arrives *separately*: a bonus, money transferred
    from a person, a credit-card refund, etc.
- **For manual-only users** (no bank-statement upload): the same two pockets, just
  named differently — 👛 **Pocket money** (their fixed monthly income) + 🎁 **Extra
  pocket money**.
- **User-configurable:** the user can **add a 3rd, 4th … pocket**, each with its own
  **name + colour/logo**, to track any income stream separately.
- **Every pocket shows the same four things:** `Total in · Used · Remaining · %
  used`. Identical UI for all pockets (Paychecks and Extra are "twins").
- **Remaining can go NEGATIVE** (over-used). When negative it is shown clearly in
  **red** — allowed, never hidden.
- **Extra is "mostly set aside for a specific need."** Hemanth rarely treats extra
  as free daily-spend money; he usually earmarks it (e.g. "$500 bonus → house
  loan"). So Extra still shows total/remaining/% like Paychecks, but its "used"
  comes from money he *assigns* out of it on purpose.

### Why separate pockets, not one bar  **[DECIDED — design rationale]**
Paycheck money behaves like "spend it down" 📉. Extra behaves like "park it for a
job" 🅿️. One combined bar cannot represent both honestly. Today the app mashes them
into a single `"$4,536 spent this month of $9,706"` — that $9,706 is really
`paycheck + extra` combined, and must be split.

---

## 3. Home screen GUI  **[DECIDED — layout direction]**

Replace the single combined budget bar with **one card per pocket, stacked**, plus
an add button:

```
┌ 💵 Paychecks ─────────┐
│ $7,290 · 73% used     │
│ Remaining $2,000      │
│ ▓▓▓▓▓▓▓░░░   → manage │
└───────────────────────┘
┌ 🎁 Extra ─────────────┐
│ $1,000 · 50% used     │
│ Remaining $500        │
│ ▓▓▓▓▓░░░░░   → manage │
└───────────────────────┘
        ➕ Add income box
```

- Each card: pocket name + logo, Total, Remaining, % used, a progress bar, and a
  **"manage"** tap target.
- Negative remaining → red.

### Tap a pocket → "Manage" popup  **[DECIDED]**
- Lists the **income entries** inside that pocket.
- **Add a new entry**, **edit existing entries**, and **pick a logo/icon** per entry.
- Shows the same Total / Remaining / % used for the pocket.
- (This mirrors the existing `ManageIncomeSheet`, generalised to per-pocket.)

---

## 4. Spending → which pocket funds it ("Paid from")  **[DECIDED]**

Every expense draws from **one or more pockets**. The expense-entry flow (QuickAdd)
gains a **"Paid from"** control:

```
Add expense   $100
Category: Groceries 🛒
──────────────
Paid from ▾
💵 Paychecks  ($50 left)   ✓ $100
🎁 Extra      ($500 left)
       ✂️ Split across boxes
```

- The selector **shows each pocket's remaining** so the user chooses with full
  context.
- **Default pocket is auto-selected intelligently** (see §5) but always editable.
- **Split:** the user can split one expense across multiple pockets; the parts must
  sum to the expense total. Example: a $100 expense → $50 from Paychecks + $50 from
  Extra (or across 3 pockets).
- **Negative allowed:** if the user puts the whole $100 on Paychecks when only $50
  remains, Paychecks shows **−$50 in red**. Permitted; just honest.

### Reuse note  **[DECIDED — feasibility]**
This is the **same split engine already built** for the income *cap* feature
(`TransactionSplit` + per-part routing in `summaryByFlowIntent`, bigint-safe store).
Here it is applied on the **funding (pocket) side** instead of the income-cap side.
Not new machinery.

---

## 5. The "intelligent default" for Paid-from  **[DECIDED]**

Three layers, in order:
1. **Default = the main 💵 Paychecks pocket** — ~90% of expenses come from it.
2. **Learn exceptions from history** — if a description/merchant/word has been paid
   from a different pocket before, suggest that pocket next time. Use the **same
   learning engine already in the app** for category prediction (naive-Bayes
   description→label); here it predicts description→pocket.
3. **Read it live from the typed text** — the QuickAdd natural-language box already
   auto-fills amount/date/category/account as the user types; "Paid from" becomes
   **one more auto-filled chip**. e.g. typing "house loan 1000" → fills
   `$1000 · House · 🎁 Extra` because past house-loan payments came from Extra.

**Honest limit (told to Hemanth, accepted):** the app can only *guess* a pocket
when the words repeat ("house loan", "bonus"). A genuine one-off has no signal, so
it defaults to Paychecks and waits for the user's correction.

---

## 6. Income classification engine (how pockets get filled)  **[DECIDED direction]**

- **Paychecks** = recurring deposits detected by **DATE CADENCE** (≈ every 14 days,
  tolerance 12–16) **+ payer identity (normalised descriptor)**, **NEVER by amount**
  (the amount varies every time — that's the whole reason to use dates). The pure
  detector already exists: `src/lib/app/paycheck-detector.ts` (`detectPaychecks`,
  biweekly/semi-monthly cadence, ≥2 occurrences). **It is currently only wired to a
  banner — it must be wired into the income number** so detected deposits fill the
  Paychecks pocket.
- **Extra** = every inflow that is NOT on the paycheck cadence (bonus, person
  transfer, refund, tax return…). The user labels what each one is.
- **Bonus that shares the salary's name** (Hemanth's key edge case):
  - off-cadence date → automatically lands in **Extra** ✅ (cadence filter handles it)
  - **same-day, separate** deposit from the employer → **ask, don't guess** (no
    reliable automatic signal without amount).
  - **bundled into the same paycheck deposit** (one number = salary + bonus) →
    **impossible to auto-split from a bank statement**; handled by the manual
    **income cap** (cap the paycheck to normal salary, mark the rest as bonus/Extra).
- **Credit-card positives are NOT income** — a positive row on a credit-card
  statement is a payment you made or a refund, never salary. (Current bug: the
  sign-default treats any inflow as income with no credit-card guard — see the
  separate fix discussed.)
- **Statement opening balance + carry-forward (±)** count as income for the cycle
  (from the earlier `project_income_paycheck_model` notes).

---

## 7. Hemanth's real manual method (from the WhatsApp screenshots, 2025–26)

This is HOW he actually budgets — the app should ultimately model this. **[context,
parts still OPEN]**

- He posts a tally **every paycheck (~biweekly), not per calendar month.**
- Income for a cycle = his **two paychecks** (variable). Clear example (Nov 4):
  `$3645 + $3645 = $7290`, then `$7290 − $5880 = $1410 should remain`.
  Sometimes the cycle is a **`Deficit`** (e.g. Feb 18: `Deficit $2600`).
- Each cycle he lists **every outflow** and totals it. Recurring buckets seen:
  - **EMIs / fixed:** Car EMI, House EMI (mortgage / "pennymac"), 401k EMI, Phone
    EMI, Insurance, T-Mobile, "India", Tax.
  - **Credit cards (balances to clear):** Chase, BofA, Amex, Discover, Amazon.
  - **People (names):** Rupa, Charan, Vadhina, Annaya, Vasu, Anand, chinna mama.
  - **Savings / investing as a planned outflow:** Robinhood, Savings, 401k.
  - **Misc / House Misc.**
- He tracks a **running available balance** across cycles
  (Dec 29: `Present Balance $18,400 − $10,530 = $7,870`) and draws it down as he
  pays during a cycle (`$6360 − $1250 − $380 = $4730`).
- He **pre-pays future months and reallocates** — the most sophisticated part:
  "Paid $2100 principal reduction… $1000 of April, $1100 of July (so in July,
  instead of paying pennymac, transfer to India)"; "$1000 advance to house loan, no
  need to pay in May".
- **Bonus & person-to-person money tracked separately:** "$500 from May bonus",
  "$500 from annaya", "$535 to chinna mama".
- He converts the USD balance to an **INR equivalent** sometimes
  (`$2,513 → ₹2,15,000 + ₹67,000 = ₹2,82,000`).

### One-line read of what he does
A **forward-looking, per-paycheck obligations planner**: "here are my 2 paychecks,
here is *everything* I owe this cycle, what's left or short — and let me pre-pay and
reallocate future months." The current app is the opposite — a *backward-looking*
"spent of income" summary from statements. The gap between these two is the heart
of the work.

---

## 7.5 Bills / obligations checklist — the OUTGOING side  **[DECIDED]**

Hemanth chose **option B**: a **"Bills due this cycle" checklist**.

- **NOT auto-predicted.** The app does not generate the bill list from statements
  or history. It shows an **empty placeholder + "➕ Add bill"**; the user owns the
  list entirely.
- **Each bill =** `{ name, amount, default pocket, paid? }`.
- **Default pocket is asked WHEN the bill is added** (default = 💵 Paychecks),
  changeable later. (Hemanth: "when user adds that category, it should be asked
  what payment should be selected as default.")
- The user **ticks each bill as he pays it** → ticking turns it into an **expense
  drawn from that bill's pocket**, shrinking that pocket's remaining.
- At tick/pay time the paid-from pocket **defaults to the bill's default but can be
  overridden via dropdown** — the same "Paid from" control as §4 (incl. split
  across pockets).
- GUI sketch:
  ```
  Bills this cycle 📋        ➕ Add bill
  ──────────────
  ☐ Car EMI     $1,250  💵
  ☑ House EMI   $2,200  💵  ✓ paid
  ☐ Chase card    $353  💵
  ☐ Robinhood   $2,200  🎁
  ──────────────
  Paid $2,200 of $6,003
  ```

**Resolved:**
- Bills **RECUR**: a bill is saved once and **repeats every cycle (reset to
  unticked)** until the user intentionally removes it. The amount carries over from
  the previous cycle and is **editable at pay-time** (EMIs are mostly fixed; an
  occasional variable one is just edited).
- **Credit-card payments are NOT bills** and are NOT added to this checklist. Each
  card PURCHASE is already logged as its own expense drawn from a pocket. Therefore
  paying the card later is **money movement (settling the card), NOT a second
  deduction** — it must never subtract from a pocket again, or the spend
  double-counts. (Same rule as §6: `cc_payment` = excluded from spend; a positive
  credit-card row ≠ income.)

---

## 7.6 Manual entries ↔ statement merge  **[DECIDED direction]**

The expense flow is **real-time during the month, reconciled at month-end.**

- **Real-time:** when the user logs an expense, the amount **leaves its pocket
  immediately**. So intra-month, the pocket "remaining" is driven by the user's
  manual entries. Because each card purchase is already an expense, the card
  **payment** needs no separate tracking (money movement; see §6 / §7.5).
- **Month-end:** the user uploads the bank / credit-card statement. The app
  **matches each statement transaction to the existing manual entries and MERGES**
  them — it must NOT create duplicates.
- **Match signal:** primary = **amount (exact) + date window** (the user logs on
  purchase day; the bank posts 1–3 days later, so allow a few days' slack);
  secondary = **fuzzy/learned description** ("groceries" vs "WALMART #1234" won't
  match literally).
- **Outcomes:**
  - confident, unambiguous match → **auto-merge silently**, keeping the user's
    pocket + category, enriching with the statement's exact date/descriptor.
  - statement txn with **no** manual match → a transaction the user forgot → **add**
    it (auto-classify category/pocket, or prompt).
  - manual entry with **no** statement match → probably **cash** (no bank record) →
    keep as-is.
  - **ambiguous** (same amount + same day, multiple candidates) → a short
    **"Review N matches" screen**; never silently mis-merge.
- Builds on the existing reconciliation infra (bank↔CC); manual↔statement is the
  new matcher. (Hemanth has asked for this since 2025: "intelligently detect what
  was entered manually and merge instead of duplicating; match by amount then name.")

**OPEN sub-question (being asked now):** unmatched manual entries — keep as **cash**
automatically, or ask the user each time? Plus the review-screen UX details.

---

## 7.7 Chosen Home layout + UX safety + navigation  **[DECIDED]**

**Home layout = Option A** (stacked rich pocket cards; mockup at
`reports/mockups/home-pockets-A.html`). Each pocket card: logo chip + name, big
**remaining** number, `of $TOTAL · NN% used`, a progress bar, and **manage ›**.
Over-budget remaining shows in **red** with an "over by $X" label (see mockup C
for the red treatment).

**Navigation — new "Plan" tab (name TBD).**
- The **"Add income box"** action is **REMOVED from Home** (infrequent). Home stays
  a calm glance + quick actions.
- A **dedicated tab** (working name **"Plan"** / Cycle / Income — Hemanth to choose)
  is the *control room*: **manage income boxes** (add / rename / pick logo / delete)
  + **bills setup**. Home = glance & quick actions; Plan = manage.

**Deleting an income box — guarded, never accidental (data-loss risk):**
- Only available behind an **Edit** toggle (mirrors the existing CategoryPicker
  safe-delete pattern), never a stray tap.
- A confirm step first shows **how many transactions the box holds** ("42
  transactions").
- On delete the user **must choose another box to MOVE/MERGE those transactions
  into** — the app never silently drops the data.

**Marking a bill "paid" — NOT a one-tap checkbox (anti-fat-finger):**
- Tapping a bill **opens a small confirm** (amount editable + paid-from pocket
  selector) with a **"Mark paid"** button — paying a bill is logging an expense
  (amount + pocket), so it is naturally a 2-step, deliberate action.
- A paid bill → tap → **Edit / Mark unpaid** — always **reversible**.
- A stray tap only *opens* the bill; it never silently ticks/unticks.

**OPEN sub-questions (being asked now):** the new tab's name; and whether the bills
LIST stays on Home (ticked often) or moves fully into the new tab.

---

## 7.8 The "Recurring" tab — Bills + Subscriptions  **[DECIDED]**

The new tab (§7.7) holds **two sections in one tab** (mockups:
`reports/mockups/plan-tab.html` + `pay-confirm.html`):

- **📋 Bills due this cycle** — the recurring obligations (EMIs, loans, India
  remittance, savings like Robinhood). Each row: deliberate status circle + name +
  amount + paid-from pocket. "➕ Add" to add a bill.
- **🔁 Subscriptions** — recurring services (Netflix, Spotify, Hotstar, Prime …).
  Each row: **brand logo** (reuses the app's brand-icon system) + name + **next
  renewal date** + amount + paid-from pocket. "➕ Add" to add a subscription. A
  running "$NN/mo" total in the section header.
- A top **summary strip**: `due this cycle · paid · left`.

**Tab name [OPEN — Hemanth choosing]:** "Monthly Bills" is too narrow (subs aren't
bills). Candidates: **Recurring** (recommended — covers both), **Bills**,
**Monthly**. Mockup currently uses "Recurring".

**Marking a bill/sub paid = the deliberate confirm from §7.7:** tap a row → a bottom
sheet opens with **editable amount + paid-from pocket selector + "Mark paid"**; a
paid row → tap → **edit / mark unpaid**. Never a one-tap toggle.

**Per-section totals:** Bills and Subscriptions EACH show their own
`due · paid · left` summary (NOT one combined strip). Subscriptions use the **same
deliberate tick/untick** as bills (tap → confirm → Mark paid; reversible).

**Sections are user-extendable:** beyond Bills + Subscriptions the user can **add
their own box/section** in this tab (e.g. "Loans", "Family") — same idea as income
boxes.

**Where "Add box" / "Add income box" lives — NOT Settings.** Adding / removing /
reordering boxes (both the income boxes on Home and the sections in the Recurring
tab) is behind an **"Edit" toggle** on the respective screen (the app's existing
safe-edit pattern, mockups `recurring-edit.html` + `home-edit.html`). In normal
mode there is **no add/delete affordance**, so a stray tap can never add or remove
a box. Explicitly decided **against Settings** (too hidden for an occasional,
contextual action).

**Removing a box never loses data:** delete is only available in Edit, shows the
box's **transaction count**, and **requires choosing another box to move those
transactions into** (merge) — per §7.7.

**OPEN sub-question (being asked now):** when a subscription's renewal date arrives,
should the app **auto-log it paid** (subs are predictable) or **remind the user to
confirm**?

---

## 7.9 Payment states, dates, editable + partial (installment) amounts  **[DECIDED]**

(mockups: `reports/mockups/recurring-states.html` + `pay-partial.html`)

- **Tab name = "Recurring"** (resolved).
- **Subscriptions: remind on renewal, NEVER auto-mark paid.** The user always marks
  paid **manually**. If a bill/sub is not marked paid **by its due/renewal date** →
  it becomes **overdue** (flagged red on its own).
- **Each bill/subscription has BOTH a due date and a paid date.** The user sets the
  **due date when adding** it (along with amount + default pocket, §7.5). The
  **paid date** is recorded when marked paid. The list shows the due date for
  unpaid/overdue rows and the paid date for paid rows.
- **Four payment states** shown in the list:
  - **due** — unpaid, due date in the future ("due Jun 14")
  - **overdue** — past the due date, unpaid (red "⚠ overdue · was due Jun 1")
  - **partially paid** — half-filled marker, "$1,000 of $1,500 · left", "paid $500 on Jun 3"
  - **paid** — full (green ✓, "paid Jun 1 · 💵 Paychecks")
- **The "Mark paid" sheet has TWO editable amounts:**
  - **Total amount** — the bill's full amount, **editable** (e.g. the EMI changed).
  - **Paying now** — **defaults to the full/remaining amount, editable** (e.g. set
    $500 of $1,500).
  - Paying less than the total → the bill becomes **partially paid**; the remainder
    is shown and, **next time, "Paying now" pre-fills the remainder** ($1,000).
  - Plus **Paid from** pocket selector + **Paid on** date. The confirm button names
    the exact amount ("Mark $500 paid").
- **Per-section totals** (§7.8) reflect partials: a partial payment adds to "paid"
  and the remainder stays in "due/left".

---

## 7.10 Recurrence / cadence on add  **[DECIDED]**

(mockup: `reports/mockups/add-bill.html`)

When **adding** a bill or subscription, the form collects: **name · amount ·
paid-from pocket · Repeats? · cadence · first due date**.

- **Repeats? = One-time vs Recurring.**
  - **One-time** → it appears only for this cycle/month and does NOT come back.
  - **Recurring** → pick a **cadence**: **Monthly / every 3 months / every 6 months
    / yearly (12 months) / Custom**.
  - **Custom** (mockup `reports/mockups/add-custom.html`) reveals an inline
    **"Every [N] [days / weeks / months / years]"** picker (number stepper + unit
    dropdown) with a **live "next due …" preview**. This covers biweekly, "every 45
    days", "every 18 months", etc. — so dedicated Weekly / Every-2-weeks chips are
    NOT strictly needed (OPEN: still offer a 1-tap "Every 2 weeks" shortcut since
    Hemanth is paid biweekly? — minor).
- The **first due date** is set by the user; the cadence drives subsequent ones.
- **After each FULL payment of a recurring item, the next due date auto-advances by
  the cadence** (e.g. quarterly → +3 months) and the item reappears (unticked,
  status = due) for the next period. This refines §7.5 ("bills recur until removed")
  with an explicit cadence + a one-time option.

**Heads-up / [OPEN] alignment:** the budget runs in **biweekly paycheck cycles**
(§6/§7) but bills/subs carry **monthly/quarterly/etc.** due dates. Resolution
direction: the Recurring tab lists every item by its **own due date**, and the
"due this cycle" summary counts whatever falls in the current window — so monthly
and quarterly items coexist with the biweekly budget cadence without forcing one
onto the other. (Confirm with Hemanth.)

---

## 7.11 Period (v1) = calendar month + per-pocket carry-forward (±)  **[DECIDED — FINAL]**

- **v1 period = calendar month.** Hemanth chose "📅 month now, biweekly later." The
  Home pocket cards show **"remaining this month."** Everything is tracked per
  calendar month.
- **On the 1st of each month, pockets do NOT reset to zero.** Each pocket's
  **end-of-month remaining carries forward into the SAME pocket** for the new
  month — **positive OR negative** (signed).
  - e.g. Paychecks ends May with **+$2,000 left** → June's Paychecks pocket
    **starts at +$2,000**, then June's new paychecks add on top.
  - e.g. a pocket ends May at **−$50** (overspent) → June starts that pocket at
    **−$50**.
- So for a pocket: **income-this-month = carried-forward balance (±) + new income
  that landed this month**; **remaining = income-this-month − expenses drawn from
  it this month.**
- This is the **carry-forward** concept (earlier flagged deferred) — now IN SCOPE
  for v1, applied **per pocket, signed**.
- The **biweekly paycheck-window** period is the **next layer after v1** — it only
  swaps the window boundary; the pocket machinery is unchanged.

## 7.12 BUILD ORDER (FINAL) — start here when implementing  **[DECIDED]**

Hemanth chose **"Income pockets first."** Recommended slice sequence (each a working,
deployed increment; money math is P0 — keep totals conserved + split-distribution
IV&V green at every step):

1. **Income pockets data model + store** — a list of pockets `{ id, name, logo,
   color, order }`; 2 defaults (💵 Paychecks, 🎁 Extra). Each income deposit maps to
   a pocket (initially by flow-intent: `salary` → Paychecks; `gift_in/interest_earned/
   cash_in` → Extra). Each EXPENSE gets a `paid_from` pocket (+ optional split across
   pockets, reusing the existing `TransactionSplit` engine on the funding side).
   Default `paid_from` = Paychecks (the 90% rule).
2. **Per-pocket month math** — income-this-month (carried ± + new) − expenses
   drawn-from = remaining; % used; negative allowed (red). Calendar-month period.
   Carry-forward (±) applied on month rollover.
3. **Home = Option A cards** (mockup `home-pockets-A.html`): one card per pocket
   (remaining hero, of $TOTAL · % used, bar, manage). Replaces the single combined
   "$X spent of $Y income".
4. **Manage / Edit mode** (mockups `home-edit.html`): tap pocket → manage entries
   (add/edit/logo); Edit toggle → add/rename/delete box; **safe-delete = pick
   another box to MOVE its transactions into** (never lose data). "Add box" only in
   Edit (not Settings, not on Home normally).
5. **"Paid from" in QuickAdd** — selector showing each pocket + its remaining;
   intelligent default (Paychecks → learned exceptions via the existing naive-Bayes
   description→label engine → live from typed text); split across pockets; negative
   allowed.
6. **Credit-card-positive-not-income fix** — `flow-intent.ts` line ~422-423: a
   POSITIVE credit-card row must default to `cc_payment` (not income), symmetric to
   the negative→`purchase` guard. (See §6.)
7. **Wire `detectPaychecks` → Paychecks pocket** so recurring biweekly deposits fill
   Paychecks; everything off-cadence → Extra.
8. **THEN the Recurring tab** (Bills + Subscriptions) — see §7.5–§7.10. New bottom-nav
   tab "Recurring"; two sections each with own due/paid/left; due+paid dates;
   states (due/overdue/partial/paid); deliberate Mark-paid sheet (Total + Paying-now
   editable, partial→remainder, paid-from, paid-on); Add form (one-time vs recurring;
   cadence Month/3/6/12/Custom "every N units" + auto next-due); recurring bills carry
   over until removed; CC payments NOT in bills (already counted as expenses).
9. **(Later)** manual↔statement merge (§7.6); biweekly paycheck-window period (§7.11).

All mockups live in `reports/mockups/` (home-pockets-A/B/C, plan-tab, pay-confirm,
recurring2, recurring-edit, home-edit, recurring-states, pay-partial, add-bill,
add-custom). Real design tokens in `src/app.css`.

---

## 8. OPEN questions still to resolve with Hemanth  **[OPEN]**

- The **"people" buckets** (Rupa, Charan, Vadhina, Annaya, Vasu, chinna mama): money
  he *lends*, *repays*, or *family support he sends*? Changes the math.
- **"India" / "401k" / "Robinhood" / "Savings":** remittance? loan repayment?
  set-aside savings (should not count as "spent")?
- Each cycle's **"Total" = plan (must pay) or actual (paid)?**
- How **"Present Balance"** is formed (one account or all summed)?
- **The OUTGOING/obligations side** (the EMIs/cards/people checklist) — not yet
  designed. This is the natural next topic after income pockets.
- The **"month" definition** (paycheck-cycle vs calendar) + the per-paycheck
  month-assignment flow (auto-suggest + 12-month dropdown override; 3-paycheck
  month handling) — see `project_income_paycheck_model`.
- True **carry-forward to next month** as a real money movement (deferred earlier).

---

## 9. Build order (proposed, NOT yet started)  **[OPEN — for later]**

1. Income pockets data model + the two default pockets + Home cards.
2. Manage-pocket popup (reuse/generalise `ManageIncomeSheet`): add/edit entries +
   logos.
3. "Paid from" selector + split-across-pockets in QuickAdd (reuse the split engine).
4. Intelligent default: default Paychecks + learned + typed-text auto-fill.
5. Wire `detectPaychecks` into the Paychecks pocket; everything else → Extra.
6. Credit-card-positive-not-income fix.
7. (Later) the obligations/bills planner — §7 / §8.

Money math is P0: every step must keep totals conserved and pass the split-
distribution IV&V.
