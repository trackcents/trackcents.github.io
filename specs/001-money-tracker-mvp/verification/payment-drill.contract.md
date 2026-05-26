# Verification Contract — payment-drill (US-P1-D drill-down orchestrator)

> Implementation-free contract for the independent verifier. WHAT + interface, never HOW.
> Produced by the Designer; consumed by the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/payment-drill.ts`
- **Public entry point**: `getPaymentDrill(imports, bankImportIndex, bankTransactionIndex)`
- **Risk tier**: **Core (user-facing capstone of US-P1-D).** This is the function behind
  the signature feature: click a "$X paid to credit card" bank row → see the specific
  purchases that $X paid for, each with provenance back to its source statement row. Its
  dependencies (reconciliation matcher + transaction-stream FIFO engine) are ALREADY
  independently signed off; this module's OWN new surface is the **orchestration + the
  provenance resolution** (mapping FIFO attribution positions back to the original
  `(import_index, transaction_index)` coordinates) + the null-guards.
- **Touches**: ☑ value/money (conservation pass-through) ☑ provenance/index mapping ☐ parsing ☐ state ☐ authz ☐ UI
- **Right-sizing note:** **LEAN — Stage 1 only** unless a bug is found. Do NOT re-verify
  the matcher or the FIFO engine (separately signed off); call them as trusted verified
  collaborators via real `ImportSuccess[]` fixtures and verify what THIS function adds:
  correct provenance round-trip, correct null-guards, conservation pass-through. A golden
  end-to-end drill + a provenance round-trip property are the high-yield checks. No
  mutation marathon.

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec.md` — **US-P1-D** ("clicking a CC payment shows the CC
  transactions that it covered") and **SC-004** (1-click drill).
- The signed-off sibling contracts (behavior of the collaborators you call): `reconciliation.contract.md`, `transaction-stream.contract.md`.
- `specs/001-money-tracker-mvp/data-model.md` — signed-cents convention.

## 3. Public interface (signatures only)

```ts
interface AttributedPurchaseRef {
  import_index: number;        // index into the imports[] you passed in
  transaction_index: number;   // index into imports[import_index].transactions
  covered_amount_minor: bigint; // cents of this purchase covered by THIS payment
  txn: ParsedTransaction;       // convenience copy of the source purchase row
}
interface PaymentDrillResult {
  card_bank_name: string;
  card_last_4: string;
  payment_amount_minor: bigint;  // positive (abs of the bank-side payment)
  payment_date: string;          // ISO 'YYYY-MM-DD'
  link: ReconciliationLink;      // the underlying link (carries link_type/confidence/etc.)
  paid_for: AttributedPurchaseRef[]; // oldest-first
  uncovered_amount_minor: bigint;    // payment cents with no purchase to cover
  stream: CardStream;            // the per-card stream that was walked
}
export function getPaymentDrill(
  imports: ImportSuccess[],
  bankImportIndex: number,
  bankTransactionIndex: number
): PaymentDrillResult | null;
```

`ImportSuccess` (what you construct as input — same shape used by the verified collaborators):
`{ adapter_name, bank_name, pdf_source_hash, statement: ParsedStatement, transactions: ParsedTransaction[], ... }`.
To exercise a real drill you build: one NON-credit_card import containing a `payment_to_card`
row whose descriptor a CC issuer recognizer matches (e.g. `"Payment To Chase Card Ending IN
1797"` / `"Discover E-Payment 3562"`), plus one or more `credit_card` imports for that card
(matching `bank_name` + `account_last_4`, `period_end` within the matcher's window) carrying
purchases + a matching `payment_to_card` row. (Reuse the worked example from
`transaction-stream.contract.md` / `reconciliation.contract.md`.)

## 4. Behavioral requirements (the WHAT — payment-drill's OWN surface)

- **R1 — No link ⇒ null.** If the reconciliation matcher produces no link for
  `(bankImportIndex, bankTransactionIndex)`, return `null`.
- **R2 — Unresolvable card/payment ⇒ null (no throw).** Return `null` (never throw) when:
  the matched CC import is missing/out of range; its `account_last_4` is null; the link's
  `cc_transaction_index` is null; the per-card stream can't be built; or the payment row
  can't be located within the stream.
- **R3 — Card identity fields** (`card_bank_name`, `card_last_4`) reflect the matched
  credit-card import.
- **R4 — Payment fields:** `payment_amount_minor` is the POSITIVE matched amount;
  `payment_date` is the link's matched date.
- **R5 — Provenance round-trip (THE headline correctness property).** For every
  `AttributedPurchaseRef r` in `paid_for`: `imports[r.import_index].transactions[r.transaction_index]`
  is exactly the purchase `r.txn` copies, AND it is a real debit row (a purchase/fee/interest,
  `amount_minor < 0`) on the SAME card as the payment. The drill must never point at a row
  that isn't the purchase it claims, nor at a row on a different card/import.
- **R6 — `uncovered_amount_minor`** equals the payment cents the FIFO walk could not attribute
  to a tracked purchase (pre-epoch balance), passed through from the attribution.
- **R7 — `paid_for` order** is oldest-first (mirrors the FIFO attribution order).

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Conservation pass-through (Principle II).** `Σ paid_for[i].covered_amount_minor +
  uncovered_amount_minor === payment_amount_minor`. Money is neither created nor lost in the
  drill — what the user is shown sums back to what they paid.
- **INV2 — Provenance soundness (R5 as a property):** over constrained-random multi-statement
  card histories, EVERY returned ref resolves to its real source purchase row; no ref is
  duplicated, out of range, or cross-card.
- **INV3 — Coverage bound:** each `covered_amount_minor > 0` and `≤` the magnitude of the
  purchase it points at; `uncovered_amount_minor ≥ 0`.
- **INV4 — Determinism / purity:** same `imports` ⇒ deeply-equal result (incl. `paid_for`
  order); arguments are not mutated.
- **INV5 — Total on valid input:** never throws for any well-shaped `ImportSuccess[]` +
  indices (out-of-range indices ⇒ `null`, per R1/R2).

## 6. Domain edge cases that MUST be handled

- `(bankImportIndex, bankTransactionIndex)` pointing at a non-payment row, a CC-side row, or
  out of range ⇒ `null`.
- A payment that covers purchases spanning MULTIPLE imported statements of the same card
  (the canonical case: a March payment paying off February's carried balance) ⇒ refs point
  into the correct (earlier) import.
- A payment larger than all tracked purchases ⇒ `paid_for` covers what exists, `uncovered > 0`,
  conservation still holds.
- A card with `account_last_4 === null` ⇒ `null` (can't build the stream).
- Empty `imports` / no CC import for the issuer ⇒ `null`.
- Same-day purchase+payment ordering (inherited from the verified stream) ⇒ result is
  import-order-independent.

## 7. Explicitly OUT of scope / deferred — do NOT report as bugs

- **The matching algorithm and the FIFO attribution themselves** — `reconciliation.ts` and
  `transaction-stream.ts` are separately signed off. Call them as trusted collaborators;
  verify ORCHESTRATION + provenance, not their internals. (If you believe a collaborator is
  wrong, note it as a residual, but it's not this module's finding.)
- The Svelte UI that renders the result.
- A full mutation marathon (§1 right-sizing) unless Stage 1 finds a bug.

## 8. Error contract (no silent failures)

`getPaymentDrill` is TOTAL on well-shaped input: it returns a `PaymentDrillResult` or `null`,
never throws. "No silent failure" here = it must never return a result whose `paid_for` points
at wrong/cross-card rows (R5/INV2) or whose amounts don't conserve (INV1) — return `null`
rather than a misleading drill.

## 9–10. Security / runtime
N/A — pure orchestration logic; the UI path is covered by E2E elsewhere.

## 11. Known oracle hazards

- **Provenance round-trip (R5/INV2) is the oracle-free headline** — don't re-derive FIFO;
  just assert each returned ref points at the row it claims, on the right card. A
  re-implementation of the orchestration would share blind spots; prefer the round-trip +
  conservation identities + a hand-built golden drill (the canonical multi-statement case).
- **Index confusion** is the likely defect class: mixing `import_index` vs
  `transaction_index`, or resolving a stream position against the wrong import. The
  multi-statement golden + the cross-card-negative probe target this.
- **Conservation (INV1)** is inherited from the verified stream but must survive the
  drill's re-mapping — assert it end-to-end, don't assume.
