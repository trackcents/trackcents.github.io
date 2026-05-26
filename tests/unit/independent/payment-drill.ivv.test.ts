// =============================================================================
// IV&V environment — payment-drill (US-P1-D drill-down orchestrator)
//
// Independent verification of `getPaymentDrill` from the contract + spec ALONE.
// The verifier NEVER read src/lib/app/payment-drill.ts, transaction-stream.ts,
// reconciliation.ts, or card-payment.ts bodies. Only public type/signature
// declarations + the verification contracts were consulted.
//
// Right-sized LEAN (Stage 1): this is a thin ORCHESTRATOR over two ALREADY
// signed-off collaborators (the reconciliation matcher + the FIFO stream).
// We do NOT re-verify those internals — we call them transitively through real
// `ImportSuccess[]` fixtures and verify ONLY what THIS function adds:
//   - the provenance round-trip (R5/INV2) — the oracle-free headline check
//   - conservation pass-through (INV1)
//   - coverage bound (INV3)
//   - the null-guards / totality (R1/R2/INV5)
//   - card + payment field population (R3/R4) + oldest-first order (R7)
//   - determinism / purity (INV4)
//
// Contract: specs/001-money-tracker-mvp/verification/payment-drill.contract.md
// Spec:     US-P1-D, SC-004, FR-030..FR-035, Principle II (integer cents)
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { getPaymentDrill } from '../../../src/lib/app/payment-drill';
import type { PaymentDrillResult } from '../../../src/lib/app/payment-drill';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type {
  ParsedTransaction,
  ParsedStatement,
  TransactionType,
  AccountType
} from '../../../src/lib/adapters/types';

import { CoverageModel } from '../../_framework/coverage-model';

// -----------------------------------------------------------------------------
// Functional coverage model (the vplan cover points)
// -----------------------------------------------------------------------------
const cov = new CoverageModel([
  'golden-multi-statement-drill',
  'provenance-roundtrip-prop',
  'conservation-pass-through',
  'coverage-bound',
  'overpayment-uncovered>0',
  'null:out-of-range-index',
  'null:non-payment-row',
  'null:cc-side-row',
  'null:last4-null',
  'null:empty-imports',
  'null:no-cc-import-for-issuer',
  'oldest-first-order',
  'determinism-deep-equal',
  'purity-no-arg-mutation',
  'cross-statement-provenance'
]);

// -----------------------------------------------------------------------------
// Fixture builders — construct REAL ImportSuccess[] (same shape the verified
// collaborators consume). We do NOT mock the matcher/stream; we drive them.
// -----------------------------------------------------------------------------

function txn(
  posted_date: string,
  description: string,
  amount_minor: bigint,
  transaction_type: TransactionType
): ParsedTransaction {
  return {
    posted_date,
    description,
    raw_text: `${posted_date} ${description} ${amount_minor}`,
    amount_minor,
    currency: 'USD',
    transaction_type
  };
}

function statement(
  account_type: AccountType,
  account_last_4: string | null,
  period_start: string,
  period_end: string
): ParsedStatement {
  return {
    account_type,
    account_last_4,
    period_start,
    period_end,
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: null,
    summary_lines: [],
    payment_due_date: null,
    statement_date: null,
    minimum_payment_due_minor: null,
    parser_provides: ['A']
  };
}

function imp(
  bank_name: string,
  st: ParsedStatement,
  transactions: ParsedTransaction[],
  adapter_name = 'layout-test'
): ImportSuccess {
  return {
    ok: true,
    adapter_name,
    adapter_version: '1.0.0',
    bank_name,
    pdf_source_hash: `hash-${bank_name}-${st.period_end}-${transactions.length}`,
    statement: st,
    transactions,
    checksum: { ok: true, strategy_used: 'A', level_results: [] }
  };
}

// Deep clone a fixture set so we can detect arg mutation (INV4).
function cloneImports(imports: ImportSuccess[]): ImportSuccess[] {
  return imports.map((i) => ({
    ...i,
    statement: { ...i.statement, summary_lines: [...i.statement.summary_lines] },
    transactions: i.transactions.map((t) => ({ ...t })),
    checksum: { ...i.checksum, level_results: [...i.checksum.level_results] }
  }));
}

function snapshot(imports: ImportSuccess[]): string {
  return JSON.stringify(imports, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
}

// -----------------------------------------------------------------------------
// The canonical multi-statement worked example (from the sibling contracts).
//
// Feb credit-card statement (Chase ...1797): two purchases carried forward.
//   - purchase -$341.27  (Feb 10)
//   - purchase -$15.07   (Feb 20)
// March credit-card statement (same card): the payment posts here.
//   - payment_to_card +$351.27 (Mar 3)
// Bank (checking) statement: the originating "Payment To Chase Card ... 1797" row.
//   - payment_to_card -$351.27 (Mar 3)
//
// Reconciliation links the bank row to the March CC statement (issuer 'Chase',
// last-4 1797, within window, exact $351.27 match). The FIFO walk attributes the
// $351.27 across the TWO statements: all $341.27 of the Feb #1 purchase, then
// $10.00 of the Feb #2 purchase. The drill must point the refs back into the
// EARLIER (Feb) import — the cross-statement provenance case.
// -----------------------------------------------------------------------------
function buildCanonical(): {
  imports: ImportSuccess[];
  bankIdx: number;
  bankTxnIdx: number;
} {
  const febStmt = statement('credit_card', '1797', '2026-02-01', '2026-02-28');
  const febTxns = [
    txn('2026-02-10', 'COSTCO WHOLESALE', -34127n, 'purchase'),
    txn('2026-02-20', 'SHELL OIL', -1507n, 'purchase')
  ];
  const febImport = imp('Chase', febStmt, febTxns, 'layout-chase-cc');

  const marStmt = statement('credit_card', '1797', '2026-03-01', '2026-03-31');
  const marTxns = [txn('2026-03-03', 'AUTOPAY THANK YOU', 35127n, 'payment_to_card')];
  const marImport = imp('Chase', marStmt, marTxns, 'layout-chase-cc');

  const bankStmt = statement('checking', '9001', '2026-03-01', '2026-03-31');
  const bankTxns = [
    txn('2026-03-01', 'WHOLE FOODS', -8231n, 'purchase'),
    txn('2026-03-03', 'Payment To Chase Card Ending IN 1797', -35127n, 'payment_to_card')
  ];
  const bankImport = imp('Chase Checking', bankStmt, bankTxns, 'layout-chase-checking');

  // import order: [feb cc, mar cc, bank]; bank payment is import 2, row 1.
  return {
    imports: [febImport, marImport, bankImport],
    bankIdx: 2,
    bankTxnIdx: 1
  };
}

// =============================================================================
// Stage 1 — the high-yield checks
// =============================================================================

describe('payment-drill IV&V — Stage 1 (thin orchestrator over verified parts)', () => {
  // ---------------------------------------------------------------------------
  // 1. Golden end-to-end drill (R3/R4/R6/R7 + the cross-statement case)
  // ---------------------------------------------------------------------------
  test('golden multi-statement drill: March payment pays off Feb carried balance', () => {
    const { imports, bankIdx, bankTxnIdx } = buildCanonical();
    const result = getPaymentDrill(imports, bankIdx, bankTxnIdx);
    cov.cover('golden-multi-statement-drill');

    expect(result).not.toBeNull();
    const r = result as PaymentDrillResult;

    // R3 — card identity reflects the matched CC import
    expect(r.card_last_4).toBe('1797');
    expect(r.card_bank_name).toBe('Chase');

    // R4 — payment amount POSITIVE, payment date = bank row's posted_date
    expect(r.payment_amount_minor).toBe(35127n);
    expect(r.payment_date).toBe('2026-03-03');

    // R7 — paid_for oldest-first: Feb #1 ($341.27) fully, then Feb #2 ($10.00)
    expect(r.paid_for.length).toBe(2);

    const first = r.paid_for[0]!;
    const second = r.paid_for[1]!;

    // Hand-derived expected coverage (no oracle borrowed from the DUT):
    //   payment 35127 covers Feb#1 34127 in full, leaving 1000 for Feb#2.
    expect(first.covered_amount_minor).toBe(34127n);
    expect(second.covered_amount_minor).toBe(1000n);

    // Both refs point into the EARLIER (Feb) import — cross-statement provenance.
    expect(first.import_index).toBe(0);
    expect(first.transaction_index).toBe(0);
    expect(second.import_index).toBe(0);
    expect(second.transaction_index).toBe(1);
    cov.cover('cross-statement-provenance');

    // R5 — provenance round-trip on the golden case
    expect(r.paid_for[0]!.txn).toEqual(imports[0]!.transactions[0]);
    expect(r.paid_for[1]!.txn).toEqual(imports[0]!.transactions[1]);

    // R6 — uncovered = 0 here (payment fully attributable)
    expect(r.uncovered_amount_minor).toBe(0n);

    // INV1 — conservation pass-through end-to-end
    const sumCovered = r.paid_for.reduce((acc, p) => acc + p.covered_amount_minor, 0n);
    expect(sumCovered + r.uncovered_amount_minor).toBe(r.payment_amount_minor);
    cov.cover('conservation-pass-through');
    cov.cover('oldest-first-order');
  });

  // ---------------------------------------------------------------------------
  // 2. R5/INV2 — provenance round-trip property (THE headline, oracle-free)
  // 3. INV1 — conservation pass-through
  // 4. INV3 — coverage bound
  //
  // Constrained-random multi-statement Chase ...1797 card histories. We never
  // re-derive FIFO; we assert each returned ref resolves to its real source row,
  // is a real debit on the SAME card, no ref is duplicated/out-of-range/cross-card,
  // money conserves, and coverage is bounded.
  // ---------------------------------------------------------------------------
  test('R5/INV2/INV1/INV3 — provenance round-trip + conservation + bound (random histories)', () => {
    const isoDate = (offset: number): string => {
      // map an integer offset to a date in Feb 2026 .. Mar 2026 deterministically
      const day = 1 + (((offset % 27) + 27) % 27); // 1..27
      const month = offset % 2 === 0 ? '02' : '03';
      return `2026-${month}-${String(day).padStart(2, '0')}`;
    };

    const arbPurchase = fc
      .tuple(fc.integer({ min: 0, max: 53 }), fc.integer({ min: 1, max: 500000 }))
      .map(([d, mag]) => txn(isoDate(d), `MERCHANT-${d}-${mag}`, BigInt(-mag), 'purchase'));

    const arbPaymentMag = fc.integer({ min: 1, max: 1200000 });

    fc.assert(
      fc.property(
        fc.array(arbPurchase, { minLength: 1, maxLength: 8 }),
        arbPaymentMag,
        fc.boolean(), // split purchases across two CC statements?
        (purchases, payMag, splitAcross) => {
          // Split purchases into two CC statements of the SAME card (Feb + Mar),
          // exercising cross-statement provenance, OR keep them in one.
          const half = Math.ceil(purchases.length / 2);
          const febPurchases = splitAcross ? purchases.slice(0, half) : purchases;
          const marPurchases = splitAcross ? purchases.slice(half) : [];

          const febImport = imp(
            'Chase',
            statement('credit_card', '1797', '2026-02-01', '2026-02-28'),
            febPurchases,
            'layout-chase-cc'
          );

          // March CC statement carries the matching payment row (+payMag) plus
          // any spill-over purchases.
          const marTxns: ParsedTransaction[] = [
            ...marPurchases,
            txn('2026-03-15', 'AUTOPAY THANK YOU', BigInt(payMag), 'payment_to_card')
          ];
          const marImport = imp(
            'Chase',
            statement('credit_card', '1797', '2026-03-01', '2026-03-31'),
            marTxns,
            'layout-chase-cc'
          );

          // Bank checking statement originates the link; the payment_to_card row
          // is the LAST row, descriptor recognized as Chase ...1797, amount -payMag.
          const bankImport = imp(
            'Chase Checking',
            statement('checking', '9001', '2026-03-01', '2026-03-31'),
            [
              txn('2026-03-05', 'GROCERY', -2500n, 'purchase'),
              txn(
                '2026-03-15',
                'Payment To Chase Card Ending IN 1797',
                BigInt(-payMag),
                'payment_to_card'
              )
            ],
            'layout-chase-checking'
          );

          const imports = [febImport, marImport, bankImport];
          const bankIdx = 2;
          const bankTxnIdx = 1;

          const result = getPaymentDrill(imports, bankIdx, bankTxnIdx);
          // The matcher SHOULD link (exact amount, issuer+last4, in window).
          // If for any reason it returns null, the function still must not lie —
          // null is a valid total response; skip the rest for that case.
          if (result === null) return;

          cov.cover('provenance-roundtrip-prop');

          // R4 — positive payment amount equals the magnitude paid
          expect(result.payment_amount_minor).toBe(BigInt(payMag));
          expect(result.payment_amount_minor > 0n).toBe(true);

          // R5 / INV2 — provenance round-trip for EVERY ref
          const seen = new Set<string>();
          let sumCovered = 0n;
          for (const ref of result.paid_for) {
            // in range
            expect(ref.import_index).toBeGreaterThanOrEqual(0);
            expect(ref.import_index).toBeLessThan(imports.length);
            const srcImport = imports[ref.import_index]!;
            expect(ref.transaction_index).toBeGreaterThanOrEqual(0);
            expect(ref.transaction_index).toBeLessThan(srcImport.transactions.length);

            const srcRow = srcImport.transactions[ref.transaction_index]!;
            // points at exactly the row it claims (txn is a faithful copy)
            expect(ref.txn).toEqual(srcRow);
            // is a REAL debit (purchase/fee/interest, amount < 0)
            expect(srcRow.amount_minor < 0n).toBe(true);
            expect(['purchase', 'fee', 'interest']).toContain(srcRow.transaction_type);
            // on the SAME card as the payment: the source row lives on a
            // credit_card import for Chase ...1797 (NOT the bank import, NOT a
            // different card). We assert it resolves to a CC import of this card.
            expect(srcImport.statement.account_type).toBe('credit_card');
            expect(srcImport.statement.account_last_4).toBe('1797');
            expect(srcImport.bank_name).toBe('Chase');

            // no duplicate ref
            const id = `${ref.import_index}:${ref.transaction_index}`;
            expect(seen.has(id)).toBe(false);
            seen.add(id);

            // INV3 — coverage bound: 0 < covered <= magnitude of the pointed row
            expect(ref.covered_amount_minor > 0n).toBe(true);
            expect(ref.covered_amount_minor <= -srcRow.amount_minor).toBe(true);

            sumCovered += ref.covered_amount_minor;
          }
          cov.cover('coverage-bound');

          // INV3 — uncovered >= 0
          expect(result.uncovered_amount_minor >= 0n).toBe(true);

          // INV1 — conservation pass-through end-to-end
          expect(sumCovered + result.uncovered_amount_minor).toBe(result.payment_amount_minor);
          cov.cover('conservation-pass-through');

          if (result.uncovered_amount_minor > 0n) cov.cover('overpayment-uncovered>0');
        }
      ),
      { numRuns: 400 }
    );
  });

  // ---------------------------------------------------------------------------
  // R6 — over-payment: payment larger than all tracked debt ⇒ uncovered > 0,
  // conservation still holds. Directed to guarantee the bin is hit.
  // ---------------------------------------------------------------------------
  test('R6 — over-payment surfaces uncovered, conservation holds', () => {
    const febImport = imp(
      'Chase',
      statement('credit_card', '1797', '2026-02-01', '2026-02-28'),
      [txn('2026-02-10', 'COFFEE', -1000n, 'purchase')], // only $10 of tracked debt
      'layout-chase-cc'
    );
    const marImport = imp(
      'Chase',
      statement('credit_card', '1797', '2026-03-01', '2026-03-31'),
      [txn('2026-03-03', 'AUTOPAY', 50000n, 'payment_to_card')], // pays $500
      'layout-chase-cc'
    );
    const bankImport = imp(
      'Chase Checking',
      statement('checking', '9001', '2026-03-01', '2026-03-31'),
      [txn('2026-03-03', 'Payment To Chase Card Ending IN 1797', -50000n, 'payment_to_card')],
      'layout-chase-checking'
    );
    const imports = [febImport, marImport, bankImport];

    const r = getPaymentDrill(imports, 2, 0);
    expect(r).not.toBeNull();
    const res = r as PaymentDrillResult;
    cov.cover('overpayment-uncovered>0');

    expect(res.payment_amount_minor).toBe(50000n);
    // only $10 of debt available ⇒ uncovered = $490
    expect(res.uncovered_amount_minor).toBe(49000n);
    const sumCovered = res.paid_for.reduce((a, p) => a + p.covered_amount_minor, 0n);
    expect(sumCovered).toBe(1000n);
    expect(sumCovered + res.uncovered_amount_minor).toBe(res.payment_amount_minor);
    cov.cover('conservation-pass-through');
  });

  // ---------------------------------------------------------------------------
  // 5. Null-guards (R1/R2/INV5) — never throws; returns null
  // ---------------------------------------------------------------------------
  test('R1/INV5 — out-of-range indices ⇒ null (no throw)', () => {
    const { imports } = buildCanonical();
    expect(getPaymentDrill(imports, 999, 0)).toBeNull();
    expect(getPaymentDrill(imports, 2, 999)).toBeNull();
    expect(getPaymentDrill(imports, -1, 0)).toBeNull();
    expect(getPaymentDrill(imports, 2, -1)).toBeNull();
    cov.cover('null:out-of-range-index');
  });

  test('R1/INV5 — pointing at a non-payment (purchase) bank row ⇒ null', () => {
    const { imports, bankIdx } = buildCanonical();
    // bank import row 0 is "WHOLE FOODS" purchase, not a payment_to_card
    expect(getPaymentDrill(imports, bankIdx, 0)).toBeNull();
    cov.cover('null:non-payment-row');
  });

  test('R1/INV5 — pointing at a CC-side row ⇒ null (links only originate bank-side)', () => {
    const { imports } = buildCanonical();
    // import 1 (March CC) row 0 is the CC-side payment_to_card (+amount).
    expect(getPaymentDrill(imports, 1, 0)).toBeNull();
    cov.cover('null:cc-side-row');
  });

  test('R2/INV5 — card with account_last_4 === null ⇒ null (cannot build stream)', () => {
    // Build a case where the descriptor carries NO last-4 (BofA) and the CC
    // statement's account_last_4 is null ⇒ stream cannot be keyed ⇒ null.
    const ccImport = imp(
      'Bank of America',
      statement('credit_card', null, '2026-03-01', '2026-03-31'),
      [
        txn('2026-02-10', 'PURCHASE', -10000n, 'purchase'),
        txn('2026-03-03', 'PAYMENT', 10000n, 'payment_to_card')
      ],
      'layout-bofa-cc'
    );
    const bankImport = imp(
      'BofA Checking',
      statement('checking', '9001', '2026-03-01', '2026-03-31'),
      [txn('2026-03-03', 'Bk of Amer Visa Online Pmt', -10000n, 'payment_to_card')],
      'layout-bofa-checking'
    );
    const imports = [ccImport, bankImport];
    expect(getPaymentDrill(imports, 1, 0)).toBeNull();
    cov.cover('null:last4-null');
  });

  test('R1/R2/INV5 — empty imports ⇒ null', () => {
    expect(getPaymentDrill([], 0, 0)).toBeNull();
    cov.cover('null:empty-imports');
  });

  test('R1/INV5 — no CC import for the issuer ⇒ null', () => {
    // A valid recognized bank payment row, but NO matching credit_card import.
    const bankImport = imp(
      'Chase Checking',
      statement('checking', '9001', '2026-03-01', '2026-03-31'),
      [txn('2026-03-03', 'Payment To Chase Card Ending IN 1797', -35127n, 'payment_to_card')],
      'layout-chase-checking'
    );
    // Only an unrelated CC import (different issuer) exists.
    const otherCc = imp(
      'Discover',
      statement('credit_card', '3562', '2026-03-01', '2026-03-31'),
      [txn('2026-03-03', 'PAYMENT', 35127n, 'payment_to_card')],
      'layout-discover-cc'
    );
    expect(getPaymentDrill([bankImport, otherCc], 0, 0)).toBeNull();
    cov.cover('null:no-cc-import-for-issuer');
  });

  test('INV5 — never throws across a fuzz of indices on a fixed fixture', () => {
    const { imports } = buildCanonical();
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 10 }), fc.integer({ min: -5, max: 10 }), (bi, ti) => {
        // must never throw, regardless of indices
        const r = getPaymentDrill(imports, bi, ti);
        expect(r === null || typeof r === 'object').toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  // ---------------------------------------------------------------------------
  // 6. INV4 — determinism / purity
  // ---------------------------------------------------------------------------
  test('INV4 — determinism: same imports ⇒ deeply-equal result', () => {
    const { imports, bankIdx, bankTxnIdx } = buildCanonical();
    const a = getPaymentDrill(imports, bankIdx, bankTxnIdx);
    const b = getPaymentDrill(cloneImports(imports), bankIdx, bankTxnIdx);
    expect(a).not.toBeNull();
    // bigint-aware deep-equal via stable stringify
    const norm = (v: unknown): string =>
      JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? `${val}n` : val));
    expect(norm(a)).toBe(norm(b));
    cov.cover('determinism-deep-equal');
  });

  test('INV4 — purity: arguments are not mutated', () => {
    const { imports, bankIdx, bankTxnIdx } = buildCanonical();
    const before = snapshot(imports);
    getPaymentDrill(imports, bankIdx, bankTxnIdx);
    const after = snapshot(imports);
    expect(after).toBe(before);
    cov.cover('purity-no-arg-mutation');
  });

  // ---------------------------------------------------------------------------
  // Coverage closure gate
  // ---------------------------------------------------------------------------
  test('functional coverage closure', () => {
    console.log(cov.report());
    cov.assertClosed();
  });
});
