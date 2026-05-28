# TrackCents — design brief for Claude Design

_Hand this file to Claude Design (claude.ai/design) together with the linked repo
`github.com/trackcents/trackcents.github.io`. It captures our exact design system
+ the screens to design + the rules. The prompt to paste is at the very top._

---

## ▶ PROMPT TO PASTE INTO CLAUDE DESIGN

> You're designing screens for **TrackCents**, a private, **mobile-first** personal
> money tracker (a PWA that must look great on **iPhone, Android, and desktop web**).
>
> First, **learn and strictly reuse my existing design system** from the linked repo
> (`github.com/trackcents/trackcents.github.io`, see `src/app.css`) and this brief —
> the **terracotta + warm-cream palette, Inter type, soft layered shadows, 16px
> radius, calm 200–500ms motion, light AND dark themes**. Match it exactly; do not
> invent a new look.
>
> Design these screens **mobile-first, then desktop, in BOTH light and dark**:
> 1. the **monthly budget "hero box"** (start here — it's the centerpiece)
> 2. the **home screen** (entry-first, not upload-first)
> 3. the **smart quick-add** (type "₹40 milkshake today" → confirm)
> 4. the **post-upload merge review** screen
> 5. the **first-run currency picker** (₹ INR / $ USD)
>
> Rules: keep it **original** (inspired by good budgeting apps, NOT a clone of any).
> Money colors are **direction only** — green = money in, red = money out. Numbers
> use **tabular figures**. **Nothing may exceed the screen width** (no horizontal
> scroll on mobile). Warm, friendly tone for young first-time budgeters + a working
> adult who also uploads statements.
>
> Start with the **budget box**: give me 3 variations, then we'll refine.

---

## Product in one line

A privacy-first money tracker: everything stays on the user's device, works
offline, free. Two kinds of user (design for both):

- **Manual-only** (e.g. a student / early-career, India, **₹ INR**): never uploads
  statements, just types expenses + income fast. Monthly income.
- **Upload + manual** (working adult, US, **$ USD**, paid biweekly): uploads bank/
  card PDFs monthly AND types cash spends live. Needs them merged cleanly.

Currency is **per-user** (₹ or $), chosen on first run.

## Design system — REUSE THESE EXACT TOKENS (from `src/app.css`)

**Type:** Inter (Variable). Tighten large headings slightly. Money/numbers =
tabular figures (`font-variant-numeric: tabular-nums`).

**Radius:** cards 16px, inner elements 10px, pills 999px.

**Motion:** calm, 200–500ms, ease-out; subtle press feedback (scale 0.97) on
buttons; respect prefers-reduced-motion.

**Light theme (warm cream canvas, white cards):**
- bg `oklch(0.965 0.013 78)` (warm cream) · surface `oklch(1 0 0)` (white) ·
  elevated `oklch(0.975 0.01 78)` · border `oklch(0.9 0.011 72)`
- text `oklch(0.28 0.014 55)` (warm charcoal) · muted `oklch(0.53 0.018 58)`
- **accent = terracotta** `oklch(0.62 0.125 45)` · accent-2 clay/peach
  `oklch(0.68 0.11 58)` · accent-soft chip bg `oklch(0.93 0.04 55)`
- success/emerald (money IN) `oklch(0.58 0.15 158)` · danger/rose (money OUT)
  `oklch(0.57 0.21 22)` · warning/amber (needs review) `oklch(0.74 0.15 75)`
- primary gradient `linear-gradient(135deg, oklch(0.62 0.13 44), oklch(0.69 0.11 60))`
- soft layered shadows (Stripe/Mercury depth), e.g.
  `0 4px 14px rgba(20,30,40,.08), 0 12px 32px rgba(20,30,40,.06)`

**Dark theme (deep cool navy, elevation instead of shadow):**
- bg `oklch(0.2 0.012 50)` · surface `oklch(0.245 0.014 50)` · elevated
  `oklch(0.29 0.016 50)` · border `oklch(0.35 0.016 52)`
- text `oklch(0.95 0.01 75)` · muted `oklch(0.7 0.016 68)`
- accent terracotta `oklch(0.72 0.13 50)` · success `oklch(0.76 0.15 158)` ·
  danger `oklch(0.7 0.18 22)` · warning `oklch(0.82 0.14 78)`

**Components already in the system:** `.card` (surface + hairline border + soft
shadow, 16px radius), `.btn` / `.btn-primary` (gradient) / `.btn-ghost`, `.chip`
(pill), `.num` (tabular). Reuse these shapes.

## Screens to design

### 1. Budget "hero box" (the centerpiece — design first)

A card at the top of Home. Must contain, in this spirit:
- **"Spent this month"** + the big spent amount (e.g. **₹11,528** / **$337**).
- **"of ₹18,300 income"** underneath (use the word **income**, not "allowance").
- a **% pill** top-right = **how much of the month's budget is LEFT** (headroom),
  e.g. **63%** — and it **goes NEGATIVE + red when overspent** (e.g. −8%).
- an **extra-income line at the bottom**: `+₹10,000 extra income · tap to manage`
  (green, tappable to edit).
- a **progress bar**.
- a stat row: **Remaining · Daily pace · Days left**.
- buttons: **+ Income** and a prominent **+ Add expense**.
- a small **carry-forward** note: `+₹340 from last month` (green) or `−₹300 from
  last month` (red) — editable.
- give a normal state AND an **over-budget state** (negative %, red).

### 2. Home screen (entry-first)

- top: month label ("May 2026", serif-ish display) + settings gear.
- the **budget box** (above).
- a big, obvious **+ Add expense** as the primary action (this is the front door —
  NOT a "drop a PDF" box).
- **today's / recent spends** list below (clean rows: icon, merchant, category,
  amount; green for income, red for spend).
- bottom **tab bar** on phone, left **icon rail** on desktop.

### 3. Smart quick-add

- a single text field: user types **"₹40 milkshake today"** or **"EMI 360 on June 4"**.
- show the **parsed draft** to confirm: amount, date, category (auto-suggested),
  note — each editable in one tap.
- a manual form as fallback (amount, date picker, category, note).
- a **split** affordance: enter a total, tag categories, last one auto-fills as
  remainder (so tax is absorbed and it always sums to the total).

### 4. Post-upload merge review

- after a statement upload: a calm review list of **auto-matched** items:
  `"Groceries ₹500" (you typed) ⇄ "BIGBASKET ₹500" (statement)` with **✓ confirmed**,
  **[edit]**, **[un-merge]** per row, and an **Accept all** button.
- plus uncertain ones: `"₹X on May 27 (statement) and ₹X on June 4 (you added) —
  same payment?"` → **[merge]** / **[keep separate]**.
- amber = needs review.

### 5. First-run currency picker

- one friendly screen: **₹ INR** or **$ USD**. warm, minimal, one tap to continue.

## Hard rules

- **Mobile-first**, then a responsive desktop layout. Must look right on a 393px
  iPhone with **no horizontal scroll** (nothing wider than the screen, no `100vw`).
- Deliver **light AND dark** for every screen.
- **Original** — inspired by good budgeting apps, never a pixel clone of one.
- **Money color = direction only** (green in / red out), never decoration.
- Numbers tabular; Indian grouping for ₹ (e.g. ₹1,18,300), standard for $.
- Friendly, calm, trustworthy — not corporate, not loud (no "!").
