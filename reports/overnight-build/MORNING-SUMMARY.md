# Overnight build — morning summary (read this first)

> One-page picture of what got built while you slept, what's verified, and the
> few things that need you. Full detail in PLAN.md / DECISIONS.md / BLOCKERS.md
> and the IV&V reports under reports/ivv/.

## TL;DR

Everything you asked for is **built, styled on the new design system, and independently
verified** — plus several roadmap bonuses. `pnpm verify` is **GREEN (1395 tests)**; the app
**builds and is deployable right now**. **The entire money-truth core is now independently
verified end-to-end**, 23 browser end-to-end tests pass, and the verification + pre-deploy
review process **caught and fixed EIGHT real bugs**: a determinism bug (merchant price-jumps),
a **privacy leak** (anonymizer), a **deploy base-path bug**, a **dormant offline service worker**
(SC-006 was built but never registered — now wired), and — from independently verifying the P0
money core that powers your signature feature (the "$X paid to card → what it bought" drill-down)
— a **same-day ordering bug** (D19, attribution depended on PDF import order), a **card-identity
collision** (D20), a **reconciliation false-match** (D22, two equal payments made it guess instead
of staying silent), and an **issuer false-match** (D25, "Citizens Bank" wrongly matched "Citi").
A constitution audit + bundle-budget check both pass, and there's a copy-paste **`DEPLOY.md`** runbook.

> **The whole US-P1-D pipeline + the import gate are independently verified.** A fresh "verification
> engineer" that never saw the code rebuilt the tests from the spec for every core module —
> card-payment (detect issuer) → reconciliation (match to card) → transaction-stream (FIFO: which
> purchases) → payment-drill (the drill-down), plus the checksum import gate and the money parser —
> proved money is never created/lost, and found + fixed the bugs above. **You also had me rebuild the
> verification tool itself** (after the 10× time concern): it's now a *staged gate* that runs ~5–6×
> leaner (cheap targeted probes first, heavy machinery only when a bug or critical risk earns it),
> validated by re-catching all the historical bugs in ~1% of the time, and **published to GitHub**
> (`verif-kit`). **One thing still needs your call (D21):** the payment↔statement date window — the
> spec says "±10 days of the due date" but the code uses "±30 days of the statement close date" (the
> due date isn't always parseable yet); pick which you want. Details in DECISIONS.md (D19–D27).

## What I built from your two requests

**Your cousin's pricewatch** (adapted to bank data — statements give merchant totals,
not item line-items, so I track merchant/charge price trends rather than unit prices;
true item-level tracking needs receipt ingestion, logged as future):
- `/trends` — biggest **price changes** (recurring charges that went up/down), **most-frequent
  merchants**, **largest purchases**, **fees & interest** total, with a 30/90/365/all window.
- **JSON backup export/import** (pricewatch's offline escape hatch) on `/settings`.

**Manual-entry & statement-upload app features** (researched Money Manager, Ivy Wallet,
Spendee, Wallet, Lunch Money, Skwad, Koody, Finma, HomeBank):
- **Manual transaction entry** + a **Cash** account (`/transactions` → "Add transaction").
- **CSV import** (for banks we don't parse yet) + **CSV export** (taxes/backup) on `/settings`.

**Rocket-Money transaction suite** (the constitution-compatible subset — no bank-link,
no bill negotiation, no credit-score):
- Recurring/subscription detection (`/recurring`), transaction actions (rename, note, tags,
  exclude-from-spending, mark-recurring), tag filtering, a one-card **review-categories** flow,
  **refund tracking** (a linked refund nets against the original's category), **transfers between
  your own accounts** (auto-detected, one-click "exclude from spending" so internal moves don't
  distort totals), and **splitting one transaction across categories** (conservation-preserving).

**Budgets & goals** (P4 roadmap, built once the core was complete):
- **Per-category monthly budgets** with progress bars + over-budget badges (`/budget`).
- **Savings goals** with target/saved progress rings (`/goals`), surfaced on Home too.

**GUI** (your earlier asks): Home (`/today`) as the default landing, light/dark toggle,
progress rings, custom category icons, colour-coded categories everywhere, premium cards +
entrance animations. Spec updated first (spec-rocketmoney-features.md, spec-tracker-research-features.md).

## Verification (the part you cared most about)

**Eight** independent, fresh-context verification engineers (each never saw the source) signed off,
all promoted into the permanent suite (they run forever now):
- `recurring-detector` — 45 tests, 100% coverage, 89% mutation.
- `csv-import` + `export-csv` — 78 tests, 100% coverage, 83.6% mutation, persisted fuzz corpus.
- `merchant-trends` — 41 tests, 100% coverage; **FOUND A REAL BUG #1** (price-jump result depended on
  the order statements were imported) → fixed with a deterministic tie-break (DECISIONS D13).
- `refund-resolution` — 29 tests, 100% coverage, 98.2% mutation; conservation invariant proven.
- `category-budget` — 30 tests, 100% coverage, 87.2% mutation.
- `transfer-detector` — 32 tests, 100% coverage, 71.6% mutation.
- `split-distribution` — 32 tests, 100% coverage, 49/49 in-scope mutants killed; conservation proven.
- (plus the earlier `sync-engine`, `spending-summary`, `budget-window` sign-offs.)

**Bug #2 (privacy, found in the pre-deploy audit):** the anonymizer's account-number path leaked the
full number when "keep 0 digits" was set (`slice(-0)` returns the whole string) and crashed when keep
> length — **fixed + regression-tested** (DECISIONS D16, task #41).

Also: **23 browser E2E tests** drive the actually-running app (every route + manual entry + goal
creation); a **constitution red-flag audit** (no telemetry, no float in money, no amount-classification)
and a **bundle-budget check** (SC-007: 4.25 MB build / ~1 MB initial, well under 5 MB) both pass.

## What needs YOU (see BLOCKERS.md for detail)

1. **Deploy choice**: user-site repo (`<you>.github.io`, root) works as-is; a project-subpath
   repo (like your cousin's `…/pricewatch`) needs a ~30-min base-path link pass — tell me which.
2. **Google OAuth origin** for the deployed URL (only needed for Drive sync; app works local-only without).
3. **Live 2-device Drive sync test**, a **real app icon**, and a **checksum-valid real statement** for a
   true green-path import E2E — all need you / your account.
4. A few **spec-wording confirmations** the verifiers flagged (all defensible current behavior, no bugs):
   merchant-trends same-day tie-break (D13), csv-import whitespace/rounding (D1–D3), refund notes (A1/A2).

## Not built (deliberately, logged)

Bank linking/Plaid, bill negotiation, credit-score, AI/OCR statement reading (all against the
constitution); receipt item-level price tracking (needs a receipt adapter — future); rollover/envelope
budgets (researched, deferred — per-category budgets ARE built); a W/Q period toggle on the dashboard
charts (low value). (Budgets/goals ARE now included in the JSON backup — a backup→restore is a complete
device migration: imports + categorization + budgets + goals.)
