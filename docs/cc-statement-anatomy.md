# Credit card statement anatomy

Research source for synthetic statement generation (task #58). Authoritative reference for what real CC statements contain and the edge cases the parsers, FIFO drill, reconciliation matcher, and unified view must handle.

## Regulatory floor — what statements MUST contain

Per [CFPB Regulation Z § 1026.7](https://www.consumerfinance.gov/rules-policy/regulations/1026/7/) (12 CFR § 1026.7), every credit-card periodic statement is required to include:

- **Previous balance** — the outstanding balance at the start of the billing cycle.
- **Identification of each credit transaction** (per § 1026.8) — date, amount, merchant, transaction type.
- **Credits** (refunds, payments, statement credits) — amount AND date for each.
- **Annual percentage rate(s)** — when a finance charge is imposed. Multiple APRs are listed separately when the card has different rates for purchases / cash advances / balance transfers.
- **Grace period** — the date by which the new balance must be paid to avoid additional finance charges.
- **Billing-errors address** — typically printed at the bottom.
- **Closing date** of the billing cycle and **new balance** outstanding on that date.

The Schumer Box (cardmember-agreement summary) lists APRs and fees in a standard tabular form.

## Transaction types we encounter in real PDFs

| Type                    | Sign convention                 | Section header                             | Notes                                                                                        |
| ----------------------- | ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Purchase**            | usually positive (you owe more) | "Purchases" / "PURCHASES" / "Transactions" | Most common                                                                                  |
| **Payment**             | negative or trailing-minus      | "Payments and Credits"                     | Reduces balance                                                                              |
| **Refund**              | negative or trailing-minus      | "Payments and Credits" (same section)      | Linked to a prior purchase; some statements draw a line linking refund to original           |
| **Cash advance**        | positive                        | "Cash Advances"                            | Separate section + separate APR + immediate interest accrual                                 |
| **Balance transfer**    | positive                        | "Balance Transfers"                        | Separate section + separate APR + transfer fee                                               |
| **Fee**                 | positive                        | "Fees Charged"                             | Annual / late / foreign-tx / cash-advance / balance-transfer / over-limit / returned-payment |
| **Interest**            | positive                        | "Interest Charged"                         | Multiple rows possible — one per APR category                                                |
| **Statement credit**    | negative                        | "Credits" or inline                        | E.g., bonus reward redemption, retroactive merchant credit                                   |
| **Disputed / reversed** | negative                        | usually inline                             | Same amount as original, marked "DISPUTE" or "REVERSAL"                                      |

Our internal `TransactionType` enum collapses cash advance / balance transfer into `purchase` or `other`, since downstream features (drill-through, FIFO) treat them identically (you owe more, will be paid down).

## Common edge cases that real statements include

### Format quirks

- **Sign conventions**: leading minus (`-$100.00`), trailing minus (`100.00-`, common at Robinhood), accounting parens (`($100.00)`), red-text minus (visible in PDF but not in text extraction).
- **Sub-$1 amounts**: `$0.05`, sometimes printed as `.50` (no leading zero or dollar sign at all if PDF.js splits the `$0` glyph cluster).
- **Comma thousands**: `$1,234.56`, never `1.234,56` (US format only — but multi-currency cards may have foreign-format amounts in a sidebar).
- **Trailing-minus money**: `344.92-` means `-$344.92` (Robinhood convention).
- **Trailing-minus on PDFs that wrap**: amount on one line, minus sign on next (rare, but documented).

### Foreign currency

- Foreign-currency transactions list BOTH the original amount + the converted USD amount. Format examples observed:
  - `EUR 25.00 @ 1.085 = USD 27.13`
  - `USD 27.13 (Foreign Exchange Rate: 1.085 EUR/USD)`
  - `27.13 USD - JAPAN AIRLINES TOKYO JPY 3,500 / 0.0078`
- Exchange rate disclosure is mandated by the Truth in Lending Act (per Schumer Box).
- Separate **foreign transaction fee** (typically 1–3 % of converted amount) appears as its own fee row.

### Refunds — link semantics

- Issuer behavior varies on whether refunds are explicitly linked to the original purchase:
  - **Linked**: same merchant code, refund row references the original transaction reference number.
  - **Unlinked**: refund appears in "Payments and Credits" with no reference back.
- Partial refunds are common (e.g., return one item out of three).
- A refund issued AFTER the payment that cleared the original purchase creates a CREDIT BALANCE on the card.

### Cash advances + balance transfers

- Listed in their own sections AND counted toward separate "Cash Advance APR" / "Balance Transfer APR" balance buckets.
- Cash-advance fee (3–5 %) and balance-transfer fee (3–5 %) appear as separate fee rows immediately following the principal transaction.
- Interest accrues IMMEDIATELY on cash advances (no grace period).

### Multiple APRs / interest rows

- A statement can show TWO interest rows: one for "Purchases" balance and one for "Cash Advances" balance.
- The Schumer Box at the bottom of the statement lists every APR currently in effect.
- Promotional rates (e.g., 0% intro APR) show as a separate APR row, often with an expiration date.

### Date edge cases

- **Year boundary**: a statement covering Dec 28 → Jan 27 has transactions in both years. MM/DD format requires the parser to infer year by month-vs-period.
- **Leap year**: Feb 29 only exists in leap years (2024, 2028). Date validators must accept it in those years.
- **Cycle length variation**: most statements are 28–33 days; some short-stub statements (account opened mid-cycle) can be 5–10 days.

### Merchant / description edge cases

- **Very long names**: full merchant names can exceed 80 characters and wrap to multiple lines in the PDF. Some statements append city/state on the same line (`AMAZON MARKETPLACE       SEATTLE   WA`); others on the next line.
- **Special characters**: `café`, `Trader Joe's`, `& Co`, `LLC.`, `#42`, asterisks (`SQ *COFFEE`), pipes (`PAYPAL|MERCHANT`).
- **Multi-line descriptions**: airline itineraries (`FRONTIER AIRLINES \\ AUSTIN-BOSTON \\ 03-22-2026`), hotel folios with date ranges, recurring-billing detail.
- **Same merchant same day**: two $1.00 NSF reauthorizations from the same merchant minutes apart.
- **Mostly-empty description**: just a reference number, e.g., `REF# 6970200001`.

### Statement-level edge cases

- **Credit balance**: New Balance is NEGATIVE (you have a credit on the card). Banks print this as `-$X.XX` or `$X.XX CR`.
- **Zero-activity statement**: previous balance, payment, new balance = 0. Still issued.
- **First statement on account**: no previous balance row, just current-cycle activity.
- **Last statement before closure**: explicit "ACCOUNT CLOSED" annotation.

### Authorized users

- Statements can list transactions by which authorized user made them. Header row often says `AUTHORIZED USER: SAREEN BABU` followed by their transactions.

### Disputed / reversed transactions

- Original transaction stays on the statement.
- A reversal row of the same amount with opposite sign appears later, often labeled `DISPUTED CHARGE REVERSAL` or `CREDIT ADJUSTMENT`.
- If the dispute resolves in the merchant's favor, the reversal is itself reversed (the original charge reappears).

## What this means for our code

Each of the above is a synthetic test case worth writing. Priority ordered by likelihood of finding a real bug in our existing FIFO drill, matcher, parser, or unified-view filter:

1. **Refunds (partial / full / post-payment)** — FIFO drill currently consumes oldest purchase first; a refund should ideally credit the SPECIFIC original purchase, but ours collapses to FIFO. Document this limitation; test that the totals still balance.
2. **Year-boundary statements** — MM/DD year inference is the parser's biggest risk.
3. **Foreign currency** — adapters currently extract amount as USD only; the FX rate / original-currency amount is dropped. Test that the USD amount round-trips through parseMoney correctly.
4. **Credit balance** — `previous_balance_minor` can be negative; checksum math must handle that.
5. **Same-merchant duplicates** — reconciliation matcher needs to NOT collapse them into one (each $5 Starbucks is a real charge).
6. **Long / special-char merchant names** — description-search filter must not break on Unicode.
7. **Multiple APR interest rows** — checksum gate may double-count interest if both rows are summed naively.

These become the synthetic edge-case fixture library in `tests/fixtures/synthetic/`.

## Volume-scale generator

For UI stress tests, a synthetic generator produces N realistic transactions following an empirically-reasonable distribution:

- 75 % purchases (varied merchants, amounts $1–$500)
- 10 % refunds (small fraction linked to a prior purchase)
- 5 % payments (covering most of prior balance)
- 5 % interest / fees (one of each per statement)
- 5 % statement credits / cashback redemptions

Bank distribution by typical user: ~3 active credit cards + 1 checking, so the generator can take a `bankCount` parameter and round-robin across them.

## References (verified 2026-05-23)

- [CFPB § 1026.7 — Periodic statement requirements](https://www.consumerfinance.gov/rules-policy/regulations/1026/7/)
- [Experian — What purchases are considered cash advances](https://www.experian.com/blogs/ask-experian/what-purchases-are-considered-cash-advance-on-credit-card/)
- [Experian — Balance transfer vs. cash advance](https://www.experian.com/blogs/ask-experian/balance-transfer-vs-cash-advance/)
- [Bank of America — Credit card fees FAQ](https://www.bankofamerica.com/credit-cards/credit-card-fees-faq/)
- [Discover — Common credit card fees](https://www.discover.com/credit-cards/card-smarts/credit-card-fees/)
- [Discover — Finance charges explained](https://www.discover.com/credit-cards/card-smarts/what-is-a-finance-charge-on-a-credit-card/)
- [Visa — Dynamic currency conversion](https://usa.visa.com/travel-with-visa/dynamic-currency-conversion.html)
- [Upgraded Points — Foreign transaction fees guide](https://upgradedpoints.com/credit-cards/credit-card-foreign-transaction-currency-conversion-fees/)
