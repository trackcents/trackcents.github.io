# Verification Contract — transaction-stream (per-card FIFO payment attribution)

> The only engineering artifact handed to the independent verifier. Implementation-free
> by construction: it states WHAT the module must do and the interface it exposes, never
> HOW. The verifier authors its environment from this contract + the cited spec, and never
> reads the source.
>
> Produced by: the Designer. Consumed by: the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/transaction-stream.ts`
- **Public entry points**: `cardKeyString`, `buildCardStreams`, `computeFifoAttributions`, `unpaidBalanceAfter`, `findAttributionForPosition`
- **Risk tier**: **P0 — money truth** (coverage floor 95/90, mutation floor 80; property + stateful + metamorphic required). This module answers the user's literal core question — "what did the $X I paid to my credit card actually buy?" — so a wrong attribution is a wrong answer to the app's reason for existing.
- **Touches**: ☑ value/money math ☑ persistent state (operates on the in-memory import set; no I/O of its own) ☐ parsing ☐ concurrency ☐ authn ☐ running UI

## 2. Authoritative spec sources

The verifier MAY read these. If this contract and a spec doc disagree, the **spec wins** and that disagreement is a finding.

- `specs/001-money-tracker-mvp/spec.md` — **US-P1-D** (Bank ↔ Credit-Card reconciliation drill-down): "shows me the individual line items on that credit card statement that the $800 paid for"; **SC-004** ("drill from a '$X paid to credit card' entry to the credit card transactions that $X covered, in 1 click"). Note: the spec describes the *user-visible outcome*; it does **not** mandate a particular attribution algorithm — see §7.
- `specs/001-money-tracker-mvp/data-model.md` — the `transactions` schema, the `transaction_type` enum, and the **signed-integer-cents sign convention**.
- `specs/001-money-tracker-mvp/research.md` — §R12 (reconciliation matching). Background only; the matcher itself is a different module (`reconciliation.ts`, out of scope here).
- Constitution **Principle II** (money as integer cents; no float; accuracy non-negotiable). The conservation invariants in §5 are the operationalization of Principle II for this module.

## 3. Public interface (signatures only)

```ts
export interface CardKey {
  bank_name: string;
  account_last_4: string;
}
export function cardKeyString(k: CardKey): string;

// Input element type (what the caller passes in `imports`):
interface ImportSuccess {
  adapter_name: string;
  bank_name: string;
  pdf_source_hash: string;
  statement: ParsedStatement;       // see §3a
  transactions: ParsedTransaction[]; // see §3a
  // ...other fields exist but are irrelevant to this module
}

export interface StreamTransaction {
  import_index: number;       // index into the original `imports` array
  transaction_index: number;  // index into that import's `transactions` array
  txn: ParsedTransaction;     // convenience copy of the source row
}
export interface CardStream {
  key: CardKey;
  transactions: StreamTransaction[];
}
export function buildCardStreams(imports: ImportSuccess[]): Map<string, CardStream>;

export interface AttributedPurchase {
  purchase_position: number;       // index into the stream's `transactions`
  covered_amount_minor: bigint;    // cents of that purchase covered by THIS payment
}
export interface PaymentAttribution {
  payment_position: number;        // index into the stream's `transactions`
  paid_for: AttributedPurchase[];  // oldest-first
  uncovered_amount_minor: bigint;  // payment cents with no purchase to cover
}
export function computeFifoAttributions(stream: CardStream): PaymentAttribution[];

export function unpaidBalanceAfter(stream: CardStream): bigint;

export function findAttributionForPosition(
  attributions: PaymentAttribution[],
  position: number
): PaymentAttribution | null;
```

### 3a. Relevant shapes of the input types

```ts
type AccountType = 'checking' | 'savings' | 'credit_card' | 'loan' | 'cash' | 'other';
type TransactionType =
  | 'purchase' | 'refund' | 'transfer' | 'fee' | 'interest'
  | 'payment_to_card' | 'deposit' | 'withdrawal' | 'other';

interface ParsedTransaction {
  posted_date: string;      // ISO 'YYYY-MM-DD'
  description: string;
  raw_text: string;
  amount_minor: bigint;     // SIGNED integer cents
  currency: string;         // ISO 4217, e.g. 'USD'
  transaction_type: TransactionType;
  status?: 'pending' | 'posted' | 'disputed' | 'reversed';
}
interface ParsedStatement {
  account_type: AccountType;
  account_last_4: string | null;
  period_start: string; period_end: string; currency: string;
  // ...balance/total fields exist but are irrelevant to this module
}
```

**Sign convention** (data-model + adapter contract): `amount_minor < 0` ⇒ you owe more (`purchase`, `fee`, `interest`); `amount_minor > 0` ⇒ you owe less (`payment_to_card`, `refund`). Adapters normalize sign before this module sees the data.

## 4. Behavioral requirements (the WHAT)

- **R1 — `cardKeyString` is a stable, collision-free identity for a card.** Two `CardKey`s with equal `bank_name` AND equal `account_last_4` MUST produce the same string; any pair of card identities that should be treated as *different cards* MUST produce different strings. (A user with the same last-4 at two different banks, or two different last-4s at one bank, are different cards.)

- **R2 — `buildCardStreams` includes only card-like accounts.** Only imports whose `statement.account_type` is `credit_card` or `loan` contribute transactions. `checking`, `savings`, `cash`, `other` are excluded entirely.

- **R3 — `buildCardStreams` skips un-keyable statements.** Any import whose `statement.account_last_4` is `null` is skipped (its transactions never appear in any stream), even if its `account_type` is `credit_card`.

- **R4 — `buildCardStreams` merges by card identity across statements.** All qualifying transactions for the same `(bank_name, account_last_4)` — regardless of how many separate imports they came from — land in ONE `CardStream`. The returned map is keyed by `cardKeyString(key)`.

- **R5 — Each `StreamTransaction` carries correct provenance.** `import_index` / `transaction_index` MUST point back to the exact `imports[import_index].transactions[transaction_index]` row that `txn` copies.

- **R6 — Within a stream, transactions are ordered by a DETERMINISTIC TOTAL ORDER (IV&V D19).** Primary key `posted_date` ascending. Worked example: dates `['2026-02-10','2026-01-05','2026-02-01']` ⇒ stream order `['2026-01-05','2026-02-01','2026-02-10']`. **Same-day ties** are broken on intrinsic fields ONLY (never import order): (1) balance-increasing **debits** (`purchase`/`fee`/`interest`) sort **before** balance-decreasing **credits** (`payment_to_card`/`refund`), and FIFO-ignored types (`transfer`/`deposit`/`withdrawal`/`other`) sort last; (2) then `amount_minor` ascending; (3) then `description` ascending. Consequence: a same-day payment is always ordered after that day's charges, so it pays them off, and the result does not depend on the order rows were imported in (see INV7).

- **R7 — FIFO attribution: a payment pays the OLDEST unpaid debt first.** `computeFifoAttributions` walks the chronological stream maintaining the set of not-yet-paid debits (`purchase`/`fee`/`interest`, by magnitude). When a `payment_to_card` or `refund` occurs, it consumes the oldest unpaid debits first until the payment is exhausted or no debt remains.
  - **Worked example (the canonical US-P1-D case).** Stream for one card, in order:
    1. `purchase  -$341.27`  (Feb)
    2. `purchase  -$15.07`   (Mar)
    3. `payment_to_card +$351.27` (Mar 3)

    Result: one `PaymentAttribution` for the payment at `payment_position = 2`, `paid_for = [ {0, 34127}, {1, 1000} ]` (covers all of Feb's $341.27 = 34127¢, then $10.00 = 1000¢ of Mar's $15.07; 35127 − 34127 = 1000), `uncovered_amount_minor = 0`. The remaining unpaid is $5.07 of purchase #2 — i.e. `unpaidBalanceAfter = 1507 − 1000 = 507`.

- **R8 — Partial coverage of the last debt is allowed.** When a payment exhausts partway through a debit, that debit is **partially** covered (`covered_amount_minor < magnitude`) and its remainder stays unpaid for the next payment to consume.

- **R9 — Over-payment surfaces as `uncovered_amount_minor`.** If a payment exceeds the total unpaid debt available *at that point in the stream*, the excess is reported as `uncovered_amount_minor` for that payment (it paid down pre-tracking balance the stream has no record of). `paid_for` then lists everything that was available (possibly empty).

- **R10 — Exactly one `PaymentAttribution` per payment/refund, in chronological order.** The output length equals the number of `payment_to_card` + `refund` rows that were *processed* (see R11 for the skip rule), and each `payment_position` indexes the correct stream row.

- **R11 — Defensive sign handling (no silent corruption).** A debit row (`purchase`/`fee`/`interest`) whose `amount_minor ≥ 0`, or a credit row (`payment_to_card`/`refund`) whose `amount_minor ≤ 0`, is **skipped** — it does not enqueue, consume, or produce an attribution, and it must not corrupt the running state. `transfer`, `deposit`, `withdrawal`, `other` are ignored regardless of sign.

- **R12 — `unpaidBalanceAfter` equals the still-owed total at end of stream.** It MUST equal the magnitude sum of all debits minus the total actually applied by all payments/refunds (i.e. the debt the FIFO walk leaves uncovered), and never go negative.

- **R13 — `findAttributionForPosition` is a lookup.** Returns the `PaymentAttribution` whose `payment_position === position`, or `null` if none (including when `position` indexes a purchase or is out of range).

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Per-payment conservation (Principle II).** For every `PaymentAttribution a`: `Σ a.paid_for[i].covered_amount_minor + a.uncovered_amount_minor === payment.amount_minor` (the original positive payment cents). Money is neither created nor destroyed in attributing a single payment.

- **INV2 — Global conservation.** Let `totalOwed = Σ |amount_minor|` over all *enqueued* debits, `totalCovered = Σ` of every `covered_amount_minor` across every attribution, `totalUncovered = Σ` of every `uncovered_amount_minor`, `totalPaid = Σ amount_minor` over all *processed* payments/refunds. Then **(a)** `totalCovered + totalUncovered === totalPaid`, and **(b)** `unpaidBalanceAfter(stream) === totalOwed − totalCovered`. (These are hand-derivable oracles — prefer them over re-deriving the algorithm.)

- **INV3 — No purchase is over-covered.** For any single purchase position, the sum of `covered_amount_minor` attributed to it across ALL payments is `≤` that purchase's magnitude.

- **INV4 — Non-negativity.** Every `covered_amount_minor ≥ 0`, every `uncovered_amount_minor ≥ 0`, and `unpaidBalanceAfter ≥ 0`.

- **INV5 — Full consumption before advancing (FIFO discipline).** Once a debit is fully covered it is never attributed again; a later payment never covers a debit older than the oldest still-unpaid one. Equivalently, the multiset of `purchase_position` values consumed over the payment sequence is non-decreasing in a FIFO sense.

- **INV6 — Purity / determinism.** Same input ⇒ deeply-equal output. No reliance on object identity, insertion-time, or external state.

- **INV7 — Full import-order independence (metamorphic — high value).** Permuting the order of the `imports` array, AND permuting the rows within any import (regardless of whether their dates collide), MUST NOT change the resulting attributions or `unpaidBalanceAfter`. The tie semantics are now PINNED by R6's total order (IV&V D19, resolved at the plan gate — the merchant-trends bug-class D13 applied here), so the relation holds **unconditionally** up to genuinely-identical rows (rows equal in date+type+amount+description are interchangeable, so swapping them yields an equivalent result with the same covered amounts and balance). Probe this hard — it is the highest-value metamorphic relation for this module. Additionally verify the **decided same-day order directly**: a same-day `purchase −$50` + `payment +$50` must net to balance `0` with the payment covering the purchase, in BOTH input orders.

## 6. Domain edge cases that MUST be handled

- Empty `imports` ⇒ empty map; empty stream ⇒ no attributions, `unpaidBalanceAfter = 0`.
- Single debit, no payment ⇒ no attributions; balance = its magnitude.
- Single payment, no debits ⇒ one attribution, `paid_for = []`, `uncovered = ` full payment.
- Payment exactly equal to one debit; payment spanning many debits; payment with leftover (uncovered).
- Refund interleaved with payments (refund consumes oldest debt just like a payment).
- Two different banks with the **same** last-4 ⇒ two separate streams. Same bank, two different last-4s ⇒ two separate streams. `null` last-4 ⇒ skipped.
- A `loan` account is included; a `checking`/`savings`/`cash` account is excluded even with a non-null last-4.
- Same-`posted_date` rows: a purchase and a payment on the same day; multiple purchases the same day; the order they were imported in.
- Very large magnitudes (e.g. `> 2^53` cents) — bigint must not lose precision; no `Number()` round-trip.
- Zero-amount rows and wrong-signed rows (R11).
- A payment that arrives **before** any purchase exists in the stream (all uncovered).

## 7. Explicitly OUT of scope / deferred — do NOT report these as bugs

- **The choice of FIFO itself.** The spec (US-P1-D/SC-004) specifies the *outcome* ("show the line items the payment covered") but not the attribution algorithm. **FIFO (oldest-debt-first) is the Designer's decided convention** (task #54, "FIFO balance-walk"), chosen because it matches a human's "you paid off your oldest charges first" mental model. Do not flag "the spec doesn't say FIFO" as a correctness bug — flag it only if you find FIFO produces a result that *contradicts* the spec's stated outcome, or surface it as a PLAN-pass clarification.
- **Refund-to-specific-original matching.** A refund is intentionally treated as a generic oldest-first credit, NOT matched to its specific original purchase (documented simplification; manual override deferred).
- **Manual override of attributions** (deferred to a future manual-link UI).
- **Multi-currency mixing within one card.** This module does not read `currency`; it assumes all rows in a single card stream share one currency (enforced upstream). Do not construct mixed-currency streams and call a wrong sum a bug — but DO note it in the honest residual.
- **The reconciliation matcher** (`reconciliation.ts`) and **the drill orchestrator** (`payment-drill.ts`) — separate modules, separately verified.

## 8. Error contract (no silent failures)

- All five functions are **total** on well-shaped input (the types in §3): they MUST NOT throw for any combination of valid `ParsedTransaction`/`ImportSuccess` values, including pathological amounts and orderings.
- Malformed *values* are handled by skipping (R11), never by throwing or by producing a non-conserving result.
- `findAttributionForPosition` returns `null` (not throw) for an unknown/out-of-range position.
- There is no string-message error surface here (this is pure attribution logic, downstream of the import error gate). "No silent failure" for this module means: **a wrong-shaped or wrong-signed row must never silently break conservation (INV1/INV2)** — it is excluded cleanly or the run is wrong, and your conservation assertions are what catch it.

## 9. Security expectations

N/A — single-user, in-memory, no authz boundary. (Privacy is handled upstream; this module sees already-decrypted in-memory data.)

## 10. Runtime/behavioral expectations

N/A — pure logic module, not a running UI. (The UI path is covered by E2E elsewhere.)

## 11. Known oracle hazards (Knight & Leveson note)

- **Conservation (INV1/INV2) is the strong, hand-derivable oracle** — lean on it rather than re-implementing FIFO as your reference model (a re-implementation could share the same blind spot). A faithful independent reference model is still valuable for `paid_for` *ordering/positions*, but its money totals must be cross-checked against the conservation identities, not trusted on their own.
- **Same-`posted_date` tie ordering — RESOLVED at the plan gate (IV&V D19).** The plan gate confirmed the merchant-trends bug-class (D13) applied here: same-day order must NOT depend on import order. `buildCardStreams` now imposes a deterministic total order on same-day rows (debits before credits, then `amount_minor` asc, then `description` asc — see R6). So this is no longer an open question: INV7 holds unconditionally, and you should both (a) assert full permutation invariance, and (b) directly check the decided same-day debit-before-credit semantics. Treat a result that depends on input order as a CONFIRMED bug (a regression of D19).
- **`cardKeyString` separator collision.** Probe whether two genuinely different `(bank_name, account_last_4)` pairs can map to the same string (e.g. values containing the separator sequence). If they can, R1 is violated and two cards' streams would merge — a real money-truth bug.
- **Refund-as-payment** can make a card's unpaid balance *decrease below what a pure-purchase model expects*; ensure your reference model treats refund and payment identically (per R7) so you don't raise a false discrepancy.
