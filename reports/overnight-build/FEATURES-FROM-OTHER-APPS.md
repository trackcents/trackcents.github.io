# Features added from other finance apps

> Your original MVP spec (P1) was just: onboarding, import a bank statement, import a
> credit-card statement, the bank↔CC drill-down, and a unified transaction list. Everything
> below is what I **added on top** by studying your cousin's pricewatch, manual-entry trackers,
> and statement-upload apps — picking what fits the constitution (no bank-linking, no telemetry,
> on-device, money as integer cents) and leaving the rest. Each was spec'd first, then built,
> then independently verified. Route = where it lives in the app.

## From your cousin's pricewatch
| Feature | What it does | Route |
|---|---|---|
| **Price-trend tracking** | Adapted from pricewatch's item-price idea to bank data: tracks how your recurring charges/merchants change over time — biggest price jumps (e.g. a subscription that crept up), most-frequent merchants, largest purchases, total fees & interest. 30/90/365/all-time window. | `/trends` |
| **JSON backup export/import** | pricewatch's offline escape hatch: export everything (imports + categories + budgets + goals) to a file, restore on another device. A full device migration with no server. | `/settings` |

## From manual-entry trackers (Money Manager, Ivy Wallet, Spendee, Wallet, Lunch Money, HomeBank…)
| Feature | What it does | Route |
|---|---|---|
| **Manual transaction entry + Cash account** | Add transactions that aren't on any statement (cash spending), tracked under a Cash pseudo-account. | `/transactions` → "Add transaction" |
| **CSV import** | Import transactions for banks we don't have a PDF parser for yet (labelled un-reconciled since a CSV has no printed total to checksum against). | `/settings` |
| **CSV export** | Export all transactions to CSV for taxes/backup/spreadsheets. | `/settings` |

## From Rocket Money / Copilot / Monarch (the constitution-compatible subset — no bank-link, no bill negotiation, no credit-score)
| Feature | What it does | Route |
|---|---|---|
| **Recurring / subscription detection** | Auto-flags charges that recur (Netflix, Spotify, rent…) by cadence + descriptor — structure-based, never guessing from the amount. Shows next-due. | `/recurring` |
| **Rule-based categorization** | "If description contains AMAZON → Shopping", re-applied to past transactions; your manual categories always override and stick. | `/categories`, `/categories/review` |
| **One-card review flow** | Swipe-style queue to categorize uncategorized transactions one at a time. | `/categories/review` |
| **Transaction actions** | Rename, add a note, add tags, exclude-from-spending, mark-recurring — per transaction. | `/transactions` detail |
| **Tag filtering** | Filter the transaction list by your free-form tags. | `/transactions` |
| **Refund tracking** | Link a refund to its original purchase so it nets against that category instead of double-counting as income. | `/transactions` detail |
| **Transfers between your own accounts** | Auto-detects equal-and-opposite cross-account moves and lets you exclude both legs so internal transfers don't distort spending. | `/transactions` |
| **Split a transaction across categories** | Divide one charge across multiple categories (conservation-preserving — the parts always re-sum to the whole). | `/transactions` detail |

## From budgeting apps (YNAB / Monarch / Copilot)
| Feature | What it does | Route |
|---|---|---|
| **Per-category monthly budgets** | Set a limit per category; progress bars + over-budget badges (on-screen, no push notifications). | `/budget` |
| **Savings goals** | Target + saved amount with progress rings; surfaced on Home too. | `/goals` |
| **Paycheck-to-bills budget window** | Detects your biweekly paychecks and groups them into a "budget month" so you can see bills-paid vs left from each paycheck pair. | budget window logic (US-P2-D) |
| **Spending dashboards** | Spending-by-category, spending-over-time, net cash flow per month. | `/dashboard` |
| **Month-over-month spending insights** ⭐ NEW | Copilot's "vs last month": shows which categories you're spending more/less on than the previous month, biggest movers first. | `/today` (Home) |

## GUI / UX (Rocket Money / Copilot cues — your earlier ask)
- **Home ("Today") as the default landing** — month-at-a-glance: spend-vs-income ring, top categories, recent activity, savings-goals strip, the new vs-last-month strip, and a "needs a category" review nudge.
- Light/dark toggle, progress rings, per-category icons + colors, premium cards + entrance animations.
- **PWA**: add-to-home-screen prompt + offline service worker (works offline once loaded).

## Deliberately NOT built (against the constitution / out of scope)
Bank linking / Plaid, bill negotiation, credit-score, AI/OCR statement reading, net-worth/investment tracking, shared finances, push notifications, receipt item-level price tracking (needs a receipt OCR adapter — logged as future), multi-currency UI polish (schema supports it; deferred), rollover/envelope budgets (researched, deferred — per-category budgets ARE built).

## Verification
Every feature above with non-trivial logic was independently verified in a fresh context
(the money math, the recurring/transfer/refund/split logic, the rule engine, the new insights).
4 real bugs were found and fixed that way. App is green at 1461 unit tests + 46 browser E2E,
deployable. The one open product question is D21 (the reconciliation date-window).
