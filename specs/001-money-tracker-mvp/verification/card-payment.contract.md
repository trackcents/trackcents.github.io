# Verification Contract — card-payment (cross-bank CC-payment descriptor recognizer)

> Implementation-free contract for the independent verifier. WHAT + interface, never HOW.
> Produced by the Designer; consumed by the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/util/card-payment.ts`
- **Public entry points**: `detectCardPayment`, `bankNameMatchesIssuer`, `ISSUER_BANK_NAMES` (exported const), `CardIssuer`/`CardPaymentInfo` types.
- **Risk tier**: **Core (money-path-adjacent).** This recognizer feeds the reconciliation
  matcher (US-P1-D): it identifies WHICH card issuer a bank-statement "payment to card" row
  refers to, and extracts the card's last-4 when the descriptor carries it. A **false
  positive** (matching a non-payment, or the wrong issuer/bank) can drive a WRONG
  reconciliation link — a money-truth-adjacent error. The reconciliation IV&V treated this
  module as a trusted oracle; this run verifies that oracle.
- **Touches**: ☑ parsing of bank-descriptor text ☑ money-path-adjacent ☐ value math ☐ state ☐ authz ☐ UI
- **Right-sizing note:** this is **regex/pattern-table logic — low mutation signal** (per the
  project's testing policy). Run **Stage 1 only** unless a bug is found: directed per-issuer
  recognition goldens + the false-positive/alias adversarial probes + last-4 padding. Do NOT
  run a mutation marathon over a regex table. Target a few minutes.

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec.md` — **US-P1-D** (bank↔CC reconciliation: a bank row
  "PAYMENT TO BOFA CC" must be tied to the right card) and the edge case "CC statement
  uploaded but no matching bank payment found → no link" (graceful absence is correct).
- `specs/001-money-tracker-mvp/research.md` — §R12 (cross-bank payment matching; descriptors
  vary per issuer and the user's bank's bill-pay implementation).
- Constitution **Principle II / VII** — deterministic, no silent misclassification.

## 3. Public interface (signatures only)

```ts
type CardIssuer =
  | 'Chase' | 'BofA' | 'Amex' | 'Discover' | 'Robinhood' | 'CapitalOne'
  | 'Citi' | 'WellsFargo' | 'Apple' | 'Synchrony' | 'Barclays';

interface CardPaymentInfo { issuer: CardIssuer; card_last_4: string | null; }

export function detectCardPayment(description: string): CardPaymentInfo | null;
export function bankNameMatchesIssuer(bankName: string, issuer: CardIssuer): boolean;
export const ISSUER_BANK_NAMES: Record<CardIssuer, readonly string[]>;
```

## 4. Behavioral requirements (the WHAT)

`detectCardPayment` — recognize a bank-statement descriptor for an OUTGOING credit-card
payment, returning the issuer (+ last-4 when the descriptor carries it), else `null`.
Recognized example descriptors (case-insensitive) and their expected result — these are the
*documented* forms the recognizer must handle (derived from real anonymized statements +
domain research; treat as goldens, NOT an exhaustive universe):
- **R1 — Chase carries last-4:** `"Payment To Chase Card Ending IN 1797"` → `{issuer:'Chase', card_last_4:'1797'}`.
- **R2 — Discover carries last-4:** `"Discover E-Payment 3562"` → `{issuer:'Discover', card_last_4:'3562'}`; a 3-digit capture is left-padded to 4 (`"...562"` → `'0562'`).
- **R3 — issuers that DON'T carry last-4** (return `card_last_4: null`): BofA (`"Bk of Amer Visa Online Pmt"`, `"Bank of America Payment"`), Amex (`"American Express ACH Pmt M0042"`, `"AMEX EPAYMENT"` — the M-code is NOT the last-4), Robinhood (`"Robinhood Card Payment"`), Capital One, Citi, Wells Fargo, Apple/GS Bank, Synchrony, Barclays (each per their documented descriptor forms).
- **R4 — case-insensitive**: the same descriptor in any case yields the same result.
- **R5 — deterministic / first-match-wins**: same input ⇒ same output; if patterns overlap, a fixed precedence applies (more specific first). State the order is fixed.

`bankNameMatchesIssuer(bankName, issuer)` — true iff `bankName` denotes that issuer, by the
alias table `ISSUER_BANK_NAMES`:
- **R6 — real aliases match:** `("Bank of America", 'BofA')`, `("BoA", 'BofA')`, `("JPMorgan Chase", 'Chase')`, `("Citibank", 'Citi')` → true.
- **R7 — unrelated banks DON'T match:** `("Chase", 'BofA')`, `("Wells Fargo", 'Discover')` → false.

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — NO FALSE POSITIVE (the headline safety property).** A description that is NOT an
  outgoing credit-card payment MUST return `null` — even if it merely *contains* an issuer
  name. e.g. `"CHASE BANK ATM WITHDRAWAL"`, `"DISCOVER+ CASHBACK DEPOSIT"`, `"AMAZON.COM
  (Synchrony) PURCHASE"`, `"transfer to savings"`, `"Whole Foods"` ⇒ `null`. A false positive
  here feeds a WRONG reconciliation link (the danger this module must not create).
- **INV2 — Last-4 fidelity.** When `card_last_4` is non-null it is exactly the 4-char digit
  string the descriptor carries (padded with leading zeros if the source had 3 digits); it is
  NEVER some other number in the descriptor (e.g. an Amex M-reference, a date, an amount).
- **INV3 — Alias soundness (the probe-worthy hazard).** `bankNameMatchesIssuer` must be TRUE
  for an issuer's genuine aliases and FALSE for an unrelated bank — **including a bank whose
  name merely CONTAINS an alias as a substring.** Probe this hard: does `("Citizens Bank",
  'Citi')`, `("Chase Liquid", …)`, `("Discovery Federal CU", 'Discover')`, `("Applebee's
  Rewards", 'Apple')` wrongly return true? A loose substring match that fires on an unrelated
  bank is a finding (it can mis-route a reconciliation). Report whichever way the DUT behaves,
  with the user-facing impact.
- **INV4 — Determinism / purity.** Same inputs ⇒ same outputs; no global state; no throw on
  any string input (returns `null` rather than throwing on unrecognized text).
- **INV5 — `ISSUER_BANK_NAMES` covers every `CardIssuer`** (one entry per issuer; non-empty).

## 6. Domain edge cases that MUST be handled

- Empty string, whitespace, very long descriptor → `null` (no throw).
- A descriptor containing an issuer name in a NON-payment context (INV1 false-positive probes).
- Last-4 with 3 vs 4 digits (padding); a descriptor with MULTIPLE numbers (must pick the
  card-last-4 position, per R1/R2, not a stray number).
- Mixed case / extra whitespace between tokens.
- `bankNameMatchesIssuer` with empty `bankName`, and substring-collision bank names (INV3).

## 7. Explicitly OUT of scope / deferred — do NOT report as bugs

- **False NEGATIVES on UNDOCUMENTED descriptor formats.** This is a recognizer of *known*
  issuer descriptor forms; a real-world descriptor we've never seen returning `null` is
  **correct, safe behavior** ("not yet supported" → the matcher simply makes no link, per the
  US-P1-D edge case). Do NOT flag "you didn't recognize this exotic descriptor I invented" as
  a bug. Verify the DOCUMENTED forms (§4) + the invariants (§5); don't try to enumerate every
  possible real descriptor.
- The exact regex patterns / capture-group mechanics (HOW) — verify observable behavior only.
- Which transaction the matcher then links (that's `reconciliation.ts`, separately verified).

## 8. Error contract (no silent failures)

`detectCardPayment` returns `null` for any non-matching string (it never throws). The
"no-silent-failure" obligation here is INV1: it must not silently MISCLASSIFY a non-payment as
a payment (false positive). `bankNameMatchesIssuer` returns a boolean and never throws.

## 9–10. Security / runtime
N/A — pure recognizer, no authz, no UI.

## 11. Known oracle hazards

- **Lean on directed goldens + adversarial false-positive probes**, not a mirror regex model
  (a re-implemented pattern table would share the same blind spots). The high-value probes are
  INV1 (non-payments containing issuer names → null) and INV3 (substring-collision bank names).
- **The alias substring match (INV3)** is the most likely real defect: `bankNameMatchesIssuer`
  appears to use case-insensitive substring/alias logic, so short aliases (`'Citi'`, `'BoA'`,
  `'Apple'`) risk matching unrelated longer bank names. Hand-pick collision cases.
- **Last-4 vs other numbers (INV2):** Amex descriptors carry an `M`-prefixed reference code
  that is NOT the card last-4 — confirm it's not mistaken for one.
