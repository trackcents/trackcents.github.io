# Feature spec addendum — manual-entry, statement-upload & price-tracking features

> Extends the v1 spec with features the user requested on 2026-05-26 after surveying
> (a) his cousin's price-tracking PWA <https://bhargavsammeta.github.io/pricewatch/>,
> (b) dedicated manual-entry trackers (Money Manager, Ivy Wallet, Spendee, Wallet),
> and (c) statement-upload finance apps (Lunch Money, Skwad, Koody, Finma, HomeBank).
>
> Companion to [spec-rocketmoney-features.md](spec-rocketmoney-features.md). Stays inside
> the constitution: on-device only, document/manual data (NO bank linking/Plaid/aggregators),
> money as bigint cents, NO amount-based classification, no telemetry, AGPL-3.0, $0/month.
> Research log + per-feature reasoning: [reports/overnight-build/DECISIONS.md](../../reports/overnight-build/DECISIONS.md).

## 1. Research summary — what each surveyed app offers

### 1a. Cousin's app — pricewatch (the explicit request)

A local-only PWA that **watches how the price you pay changes over time**. Tabs: Inbox
(upload receipts/statements), Items (products parsed from itemised receipts), Statements
(grouped by month), Insights (price-jump analytics), Settings (currency, theme, JSON
backup export/import, erase). Insights: highest price increases per item, most-frequently
purchased, cheapest vendor per category, top spending categories, windows of 30/90/365/all
days. JS/CSS/HTML static PWA, no accounts, no cloud.

**Key insight & constraint:** pricewatch's headline feature (track the unit price of *milk*
over time) needs **itemised receipts** — bank/credit-card statements only carry the
*merchant-level total per visit* ("WALMART $54.23"), never line items. So we adapt the idea
to what bank data actually supports — **merchant-level spend & recurring-charge price
trends** — and document true item-level tracking as a future *receipt-ingestion* path.

### 1b. Manual-entry trackers (no bank link)

Money Manager / Ivy Wallet / Spendee / Wallet: fast **manual transaction entry**, multiple
**accounts/wallets** (incl. cash), **scheduled / recurring** manual bills, reports &
statistics, **per-category budgets**. Lesson: a money tool must let the user record what
isn't on any statement (cash, a loan to a friend) and pre-declare known recurring bills.

### 1c. Statement-upload apps (our category)

Lunch Money (CSV **and** PDF import; **split** & group transactions), Skwad (PDF→sheet,
**rollover** budgets, **refund/return** auto-categorisation), Koody (CSV/spreadsheet import,
auto-categorise, **bulk-edit review** queue), Finma (bulk PDF/image import), HomeBank
(OFX/QFX/QIF/CSV import). Lesson: **CSV import** (for banks we have no PDF adapter for) and
**CSV export** (taxes/backup) are table stakes; **split transactions** and a **bulk review**
queue are the most-cited refinement features.

## 2. New / promoted user stories

| ID | Story | Source |
| --- | --- | --- |
| **US-PW-A** | As a user, for each recurring merchant/charge I see how my spend has trended and the **biggest price jumps** (e.g. "Netflix $15.99 → $17.99", "groceries +18% vs 3 mo ago"), over a 30/90/365/all window. | pricewatch Insights |
| **US-PW-B** | As a user I see my **most-frequent merchants** and **largest purchases** with totals. | pricewatch + Rocket Money |
| **US-PW-C** | As a user I can **export a full encrypted-at-rest JSON backup** of all my data and **re-import** it to restore/move devices, fully offline. | pricewatch Settings |
| **US-P3-B** | As a user I can **add a transaction by hand** (date, description, amount, account) into a **Cash** pseudo-account, and it flows through every view like a parsed one. | manual trackers (already P3) |
| **US-P4-D** | As a user I can **export my transactions to CSV** for taxes/backup. | statement-upload apps (already P4) |
| **US-IMP-CSV** | As a user I can **import a CSV** of transactions (for a bank with no PDF adapter), mapping its columns; the checksum gate is advisory (CSVs carry no printed total). | Lunch Money / Koody / HomeBank |
| **US-SPLIT** | As a user I can **split one transaction** across several categories (amounts summing to the whole). | Lunch Money / Skwad |

## 3. Placement (screen / module per feature)

| Feature | Story | Screen / module |
| --- | --- | --- |
| Merchant & recurring-charge **price-trend** detection | US-PW-A | logic `src/lib/app/merchant-trends.ts` (pure); UI new `/trends` |
| Biggest **price jumps** + frequent merchants + largest purchases | US-PW-A/B | `/trends` + reuse `spending-summary.ts` extensions |
| **JSON backup** export / import | US-PW-C | `src/lib/app/backup.ts` (pure serialize/restore) + Settings (`/settings`) |
| **Manual entry** + Cash account | US-P3-B | `src/lib/app/manual-entry.ts` (pure) + store array + `/transactions` "Add" |
| **CSV export** | US-P4-D | `src/lib/app/export-csv.ts` (pure) + button on `/transactions` |
| **CSV import** | US-IMP-CSV | `src/lib/app/csv-import.ts` (pure parser) + `/` drop-zone path |
| **Split transaction** | US-SPLIT | annotation `split[]` (already specced in rocketmoney doc) + detail sheet |

## 4. Behavioral notes (reasoned; full rationale in DECISIONS.md D6–D11)

- **Merchant trends (US-PW-A) — structure not size.** Group by `normalizeDescriptor` (same
  normaliser the recurring detector uses). A merchant with ≥2 charges is "tracked." The
  trend is the ordered series of its charge magnitudes over time; a "price jump" is a change
  in the **per-occurrence amount of a recurring charge** (cadence-confirmed), reported as
  absolute + percent. We never infer meaning from amount size — we only compare a merchant's
  charges *to its own past charges*. Constitution-safe (see memory `no-amount-based-classification`).
- **Item-level price tracking is OUT (deferred).** Bank/CC statements have no line items;
  true unit-price tracking needs a receipt-ingestion adapter (OCR/itemised parse) — logged
  as a future feature, not built now.
- **JSON backup (US-PW-C).** Exports the user's own already-decrypted local data (imports +
  annotations + categories + rules + manual txns + salt-less metadata) to a file the user
  saves themselves; re-import validates shape and merges. The file is plaintext-on-the-user's-
  disk by nature (it's their data, their device, their action) — UI warns it is unencrypted
  and to store it safely. The *synced* blob remains encrypted; backup ≠ sync.
- **Manual entry (US-P3-B).** Each manual transaction is stored with a **stable id** and
  surfaced to all aggregation/categorisation code as if it were a one-transaction import
  under a synthetic **Cash** account (`bank_name: "Cash"`, `account_type: "cash"`). Stable
  ids mean deleting one manual txn never reindexes another's annotation key. Manual txns are
  excluded from the *Statements* list (they aren't statements) but included everywhere spend
  is summed. No checksum gate (nothing printed to reconcile against).
- **CSV import (US-IMP-CSV).** A deterministic CSV parser → normalized transactions for a
  user-named account. Because a CSV has no printed statement total, the checksum invariant is
  **advisory** here (we record `checksum_status: 'not_applicable'`), unlike PDF imports where
  it is a hard gate. No silent failures: a malformed row throws with row context (memory
  `no-silent-failures`).
- **CSV export (US-P4-D).** Stable column order, amounts as decimal strings derived from the
  bigint cents (never float), RFC-4180 quoting. Round-trips with the importer.
- **Split (US-SPLIT).** `split: {category_id, amount_minor}[]` on the annotation, summing to
  the txn amount; the parsed line stays immutable; aggregation distributes the split across
  categories.

## 5. Out of scope (researched, deliberately not built)

- **Bank linking / aggregation** (Plaid, etc.) — constitution I/III. The whole point is PDFs.
- **Item-level / unit-price tracking from receipts** — needs a receipt-OCR ingestion path;
  deferred to a future feature branch (documented, not dropped).
- **AI/OCR statement extraction** (DocuClipper/Finma-style) — constitution VII (deterministic
  parsing, no AI on statements).
- **Bill negotiation / subscription-cancellation concierge, credit-score** — third-party paid
  services, constitution III/XIII.

## 6. Verification

Each non-trivial logic module gets `/ivv` in a **fresh** verification-engineer context before
"done": `merchant-trends.ts` (metamorphic: scaling/shifting a series; trend monotonicity),
`csv-import.ts` (fuzz + round-trip against `export-csv.ts`), `backup.ts` (export→import
identity / round-trip), `manual-entry.ts` (stable-id invariants, delete-doesn't-reindex).
`pnpm verify` stays green after every increment; `pnpm validate:integration` after store/app
changes.

## 7. Build & verification status (2026-05-26 — all SHIPPED + green)

Everything in this addendum is built, design-system-styled, and on a green `pnpm verify`.
Independent fresh-context IV&V sign-offs (verification of record), reports under `reports/ivv/`:

| Module | Feature | IV&V status |
| --- | --- | --- |
| `merchant-trends.ts` | US-PW-A/B price trends (`/trends`) | SIGNED OFF — **found+fixed a determinism bug** (D13) |
| `csv-import.ts` + `export-csv.ts` | US-IMP-CSV / US-P4-D (`/settings`) | SIGNED OFF (83.6% mutation, fuzz corpus) |
| `categorization-glue.ts` refund resolution | US-P3-C refunds (transaction detail) | SIGNED OFF (98.2% mutation, conservation) |
| `category-budget.ts` | US-P4-A per-category budgets (`/budget`) | SIGNED OFF (87.2% mutation) |
| `transfer-detector.ts` | US-P3-D transfers (`/transactions`) | SIGNED OFF (71.6% mutation; all survivors equivalent) |
| `manual-entry.ts`, `backup.ts`, `savings-goal.ts` | US-P3-B / US-PW-C / US-P4-B | designer + property tests (trivial logic — proportionality) |
| `recurring-detector.ts` | US-P3-A recurring (`/recurring`) | SIGNED OFF (earlier) |

Plus: 8 browser E2E tests (`tests/e2e/new-features.spec.ts`) covering /today, /trends, /settings,
/categories/review, /recurring, manual entry, /budget, and /goals create-flow. JSON backup now
round-trips budgets + goals too (D15). **US-SPLIT is now SHIPPED** — split a transaction across
categories with a conservation-preserving distribution in `summaryFromImports` (parts + remainder) +
a split editor in the /transactions detail sheet; its own fresh verifier (split-distribution) ran.
Also shipped beyond this addendum: US-P3-C refunds, US-P3-D transfers, US-P4-A budgets, US-P4-B goals.

---

## §8 — Month-over-month spending insights (US-INSIGHT) — added 2026-05-26 (IV&V D29)

**From:** Copilot Money ("vs last month"), Monarch, Rocket Money — all surface how this
period's spending compares to the previous one. Directly serves the user's core problem
("I lose track of where the money goes") by showing WHERE spend moved, not just totals.

**What:** for two spending periods (default: the two most recent calendar months present in
the data), compute, per category, this period's spend vs the previous period's spend, the
signed delta, and a display percentage; rank the biggest movers (increases and decreases).

**Constitution fit:** this compares the user's OWN category totals across periods (like the
merchant-trends self-comparison, D6) — it is NOT amount-based classification (we never infer a
transaction's meaning from its size). Money is bigint cents throughout; the percentage is a
DISPLAY number only (Number), like the existing budget/trends percentages. On-screen only — no
notifications (constitution XIII).

**Acceptance:**
- Per category present in EITHER period, one delta row: `current_minor`, `previous_minor`,
  `delta_minor = current − previous` (positive = spent MORE), `pct_change` (null when previous
  is 0 — a "new" category).
- Conservation: Σ current_minor = total current spend; Σ delta_minor = total current − total previous.
- Deterministic ranking (biggest |delta| first; stable tiebreak), independent of input order.
- Surfaced compactly on Home (/today): top increases/decreases vs last month.

**Logic module:** `src/lib/app/spending-insights.ts` (pure; built on the signed-off
`spendingByCategoryByMonth`). Verified lean (Stage 1) — conservation + ranking determinism +
period-boundary edges. View: a "Spending vs last month" strip on /today.
