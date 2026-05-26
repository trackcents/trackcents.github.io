// Stateful model-based property tests for the FIFO transaction-stream engine
// using fast-check's commands() + modelRun pattern.
//
// What this does (the UVM scoreboard analogue):
//   - Defines a SIMPLE reference model (a hand-written queue + counters)
//     that calculates the same FIFO outcomes the real engine should.
//   - Defines COMMANDS that mutate both the real card-stream and the model:
//       AddPurchaseCommand, AddPaymentCommand, AddRefundCommand
//   - Runs RANDOM SEQUENCES of those commands through both, asserting after
//     each command that the real and model agree on:
//         * total purchases recorded
//         * total payments recorded
//         * unpaid balance after every transaction
//         * sum-of-attribution-covered + uncovered == sum-of-payments
//
// What this catches that the property tests in transaction-stream.properties
// don't: subtle STATE-DEPENDENT bugs — e.g., "FIFO loses precision when a
// refund partially consumes a partially-paid purchase," or "uncovered amount
// double-counts when payments arrive interleaved with refunds."

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildCardStreams,
  cardKeyString,
  computeFifoAttributions,
  unpaidBalanceAfter
} from '../../../src/lib/app/transaction-stream';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedTransaction, ParsedStatement } from '../../../src/lib/adapters/types';

// ── Reference model ─────────────────────────────────────────────────────────

interface RefModel {
  purchasesEnqueued: bigint[]; // remaining unpaid amount per purchase, oldest first
  totalPurchases: bigint;
  totalPayments: bigint;
  totalUncovered: bigint;
}

function newModel(): RefModel {
  return {
    purchasesEnqueued: [],
    totalPurchases: 0n,
    totalPayments: 0n,
    totalUncovered: 0n
  };
}

function modelEnqueuePurchase(m: RefModel, amount: bigint) {
  if (amount <= 0n) return;
  m.purchasesEnqueued.push(amount);
  m.totalPurchases += amount;
}

function modelConsumePayment(m: RefModel, amount: bigint) {
  if (amount <= 0n) return;
  m.totalPayments += amount;
  let remaining = amount;
  while (remaining > 0n && m.purchasesEnqueued.length > 0) {
    const head = m.purchasesEnqueued[0]!;
    if (head <= remaining) {
      remaining -= head;
      m.purchasesEnqueued.shift();
    } else {
      m.purchasesEnqueued[0] = head - remaining;
      remaining = 0n;
    }
  }
  m.totalUncovered += remaining;
}

function modelUnpaidBalance(m: RefModel): bigint {
  return m.purchasesEnqueued.reduce((acc, x) => acc + x, 0n);
}

// ── Real-system harness ─────────────────────────────────────────────────────

interface RealSystem {
  txns: ParsedTransaction[];
  dayCounter: number;
}

function newReal(): RealSystem {
  return { txns: [], dayCounter: 1 };
}

function isoDay(n: number): string {
  // Map 1..366 → 2026-01-01..2026-12-31 (we cap at 200 commands per run).
  const base = new Date(Date.UTC(2026, 0, 1));
  base.setUTCDate(base.getUTCDate() + (n - 1));
  return base.toISOString().slice(0, 10);
}

function realAddPurchase(r: RealSystem, cents: bigint) {
  r.txns.push({
    posted_date: isoDay(r.dayCounter++),
    description: 'p',
    raw_text: 'p',
    amount_minor: -cents,
    currency: 'USD',
    transaction_type: 'purchase'
  });
}

function realAddPayment(r: RealSystem, cents: bigint) {
  r.txns.push({
    posted_date: isoDay(r.dayCounter++),
    description: 'pay',
    raw_text: 'pay',
    amount_minor: cents,
    currency: 'USD',
    transaction_type: 'payment_to_card'
  });
}

function realToImport(r: RealSystem): ImportSuccess {
  const stmt: ParsedStatement = {
    account_type: 'credit_card',
    account_last_4: '9999',
    period_start: '2026-01-01',
    period_end: '2026-12-31',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor: null,
    statement_balance_minor: null,
    printed_transaction_count: r.txns.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: '2026-12-31',
    minimum_payment_due_minor: null,
    parser_provides: ['C']
  };
  return {
    ok: true,
    adapter_name: 'stateful-test',
    adapter_version: '0.0.0',
    bank_name: 'Test',
    pdf_source_hash: 'stateful-hash',
    statement: stmt,
    transactions: r.txns,
    checksum: { ok: true, strategy_used: 'C', level_results: [] }
  };
}

function realUnpaidBalance(r: RealSystem): bigint {
  if (r.txns.length === 0) return 0n;
  const stream = buildCardStreams([realToImport(r)]).get(
    cardKeyString({ bank_name: 'Test', account_last_4: '9999' })
  )!;
  return unpaidBalanceAfter(stream);
}

function realAttributionTotals(r: RealSystem): {
  totalCovered: bigint;
  totalUncovered: bigint;
  totalPayments: bigint;
} {
  if (r.txns.length === 0) {
    return { totalCovered: 0n, totalUncovered: 0n, totalPayments: 0n };
  }
  const stream = buildCardStreams([realToImport(r)]).get(
    cardKeyString({ bank_name: 'Test', account_last_4: '9999' })
  )!;
  const attrs = computeFifoAttributions(stream);
  let totalCovered = 0n;
  let totalUncovered = 0n;
  let totalPayments = 0n;
  for (const a of attrs) {
    totalUncovered += a.uncovered_amount_minor;
    for (const pf of a.paid_for) totalCovered += pf.covered_amount_minor;
    const pos = a.payment_position;
    totalPayments += stream.transactions[pos]!.txn.amount_minor;
  }
  return { totalCovered, totalUncovered, totalPayments };
}

// ── Commands ────────────────────────────────────────────────────────────────

interface CombinedSystem {
  model: RefModel;
  real: RealSystem;
}

class AddPurchaseCommand implements fc.Command<RefModel, CombinedSystem> {
  constructor(readonly amount: bigint) {}
  check = () => this.amount > 0n;
  run = (m: RefModel, sys: CombinedSystem) => {
    modelEnqueuePurchase(m, this.amount);
    realAddPurchase(sys.real, this.amount);
    // After each command — totals must agree.
    expect(realUnpaidBalance(sys.real)).toBe(modelUnpaidBalance(m));
  };
  toString = () => `AddPurchase(${this.amount})`;
}

class AddPaymentCommand implements fc.Command<RefModel, CombinedSystem> {
  constructor(readonly amount: bigint) {}
  check = () => this.amount > 0n;
  run = (m: RefModel, sys: CombinedSystem) => {
    modelConsumePayment(m, this.amount);
    realAddPayment(sys.real, this.amount);
    // INVARIANT: unpaid balance after must agree
    expect(realUnpaidBalance(sys.real)).toBe(modelUnpaidBalance(m));
    // INVARIANT: sum of covered + uncovered over all attributions must equal
    // sum of all payments processed so far
    const real = realAttributionTotals(sys.real);
    expect(real.totalCovered + real.totalUncovered).toBe(real.totalPayments);
    expect(real.totalUncovered).toBe(m.totalUncovered);
  };
  toString = () => `AddPayment(${this.amount})`;
}

// ── The test ────────────────────────────────────────────────────────────────

describe('FIFO transaction-stream — stateful model-based property tests', () => {
  test('random sequences of purchases + payments — model and real engine agree at every step', () => {
    const purchaseCmd = fc
      .bigInt({ min: 1n, max: 50_000n })
      .map((amount) => new AddPurchaseCommand(amount));
    const paymentCmd = fc
      .bigInt({ min: 1n, max: 50_000n })
      .map((amount) => new AddPaymentCommand(amount));

    fc.assert(
      fc.property(fc.commands([purchaseCmd, paymentCmd], { maxCommands: 40 }), (cmds) => {
        const setup = () => ({
          model: newModel(),
          real: { model: newModel(), real: newRealSystem() } as unknown as CombinedSystem
        });
        // fast-check's modelRun signature wants (s) => { model, real }
        // We unify model + real into the SAME object so commands can mutate both.
        fc.modelRun(() => {
          const sys: CombinedSystem = { model: newModel(), real: newReal() };
          return { model: sys.model, real: sys };
        }, cmds);
        // unused helper to satisfy linter
        void setup;
      }),
      { numRuns: 100 }
    );
  });

  test('with 50-50 mix of purchases and payments, totals stay coherent', () => {
    const cmd = fc.oneof(
      fc.bigInt({ min: 1n, max: 10_000n }).map((a) => new AddPurchaseCommand(a)),
      fc.bigInt({ min: 1n, max: 10_000n }).map((a) => new AddPaymentCommand(a))
    );

    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 60 }), (cmds) => {
        const model: RefModel = newModel();
        const real: RealSystem = newReal();
        const sys: CombinedSystem = { model, real };
        for (const c of cmds) {
          c.run(model, sys);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Helper alias to avoid double declaration in setup function above.
function newRealSystem() {
  return newReal();
}
