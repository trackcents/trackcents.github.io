// Multi-level checksum gate tests — per research.md §R13.

import { describe, expect, test } from 'vitest';
import { runChecksumGate } from '../../../src/lib/app/checksum';
import type {
  ParsedStatement,
  ParsedTransaction,
  TransactionType
} from '../../../src/lib/adapters/types';

function makeStatement(overrides: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    account_type: 'checking',
    account_last_4: null,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
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
    parser_provides: [],
    ...overrides
  };
}

function tx(
  amount_minor: bigint,
  transaction_type: TransactionType = 'purchase'
): ParsedTransaction {
  return {
    posted_date: '2026-01-15',
    description: 'Test',
    raw_text: 'Test',
    amount_minor,
    currency: 'USD',
    transaction_type
  };
}

describe('Level A — balance reconciliation', () => {
  test('passes when opening + sum(transactions) == closing', () => {
    const statement = makeStatement({
      opening_balance_minor: 100000n, // $1000.00
      closing_balance_minor: 80000n, // $800.00
      parser_provides: ['A']
    });
    // $1000 - $300 + $100 = $800
    const transactions = [tx(-30000n, 'withdrawal'), tx(10000n, 'deposit')];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.strategy_used).toBe('A');
  });

  test('fails when math does not add up', () => {
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 80000n,
      parser_provides: ['A']
    });
    const transactions = [tx(-30000n, 'withdrawal')]; // 100000 - 30000 = 70000, but closing is 80000
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Level A failure message is human-readable and includes the diff in $.
      expect(result.reason).toMatch(/opening \+ transactions = closing balance/i);
      expect(result.reason).toMatch(/\$700\.00/);
      expect(result.reason).toMatch(/\$800\.00/);
      // The structured level identifier is on result.level_results, not in the reason string.
      expect(result.level_results.some((r) => r.level === 'A' && !r.passed)).toBe(true);
    }
  });

  test('fails (refused with helpful message) when adapter declared A but did not populate fields', () => {
    const statement = makeStatement({
      opening_balance_minor: null, // missing
      closing_balance_minor: 80000n,
      parser_provides: ['A']
    });
    const result = runChecksumGate(statement, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/opening_balance_minor and closing_balance_minor/);
    }
  });
});

describe('Level B — aggregate totals', () => {
  test('passes when |sum(debits)| == printed_debits AND sum(credits) == printed_credits', () => {
    const statement = makeStatement({
      total_debits_minor: 50000n, // $500 of debits
      total_credits_minor: 20000n, // $200 of credits
      parser_provides: ['B']
    });
    const transactions = [
      tx(-30000n, 'withdrawal'),
      tx(-20000n, 'withdrawal'), // total debits |-50000| = 50000 ✓
      tx(10000n, 'deposit'),
      tx(10000n, 'deposit') // total credits 20000 ✓
    ];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.strategy_used).toBe('B');
  });

  test('fails when debit total is off', () => {
    const statement = makeStatement({
      total_debits_minor: 50000n,
      total_credits_minor: 0n,
      parser_provides: ['B']
    });
    const transactions = [tx(-49500n, 'withdrawal')]; // 500 short
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Purchases & charges/i);
      expect(result.reason).toMatch(/\$500\.00/);
      expect(result.reason).toMatch(/\$495\.00/);
      expect(result.reason).toMatch(/off by \$5\.00 low/);
      expect(result.level_results.some((r) => r.level === 'B' && !r.passed)).toBe(true);
    }
  });
});

describe('Level C — credit-card balance equation', () => {
  test('passes for the Chase sample numbers (no charges, $25 payment)', () => {
    // Mirror of the Chase sample fixture math.
    const statement = makeStatement({
      account_type: 'credit_card',
      previous_balance_minor: 127000n, // $1,270.00
      statement_balance_minor: 124500n, // $1,245.00
      parser_provides: ['C']
    });
    // Sample has no transactions in the PDF; the equation still holds because
    // previous - payment = new.  We model the payment as a positive ParsedTransaction.
    const transactions = [tx(2500n, 'payment_to_card')]; // $25 payment (positive = inflow / debt reduction)
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.strategy_used).toBe('C');
  });

  test('passes for a typical month: previous + charges - payments == new', () => {
    const statement = makeStatement({
      account_type: 'credit_card',
      previous_balance_minor: 100000n, // $1,000
      statement_balance_minor: 130000n, // $1,300
      parser_provides: ['C']
    });
    // $500 of purchases (negative in our schema) + $200 payment (positive)
    // 1000 + 500 - 200 = 1300 ✓
    const transactions = [
      tx(-30000n, 'purchase'),
      tx(-20000n, 'purchase'),
      tx(20000n, 'payment_to_card')
    ];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(true);
  });

  test('fails when the equation does not hold', () => {
    const statement = makeStatement({
      account_type: 'credit_card',
      previous_balance_minor: 100000n,
      statement_balance_minor: 130000n,
      parser_provides: ['C']
    });
    const transactions = [tx(-10000n, 'purchase')]; // 100000 + 10000 = 110000, not 130000
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/previous balance \+ purchases − payments = new balance/i);
      expect(result.level_results.some((r) => r.level === 'C' && !r.passed)).toBe(true);
    }
  });
});

describe('Level D — transaction count (supplementary)', () => {
  test('refuses if D is the only level provided', () => {
    const statement = makeStatement({
      printed_transaction_count: 3,
      parser_provides: ['D']
    });
    const transactions = [tx(-1000n), tx(-2000n), tx(5000n, 'deposit')];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Level D alone is insufficient/i);
    }
  });

  test('passes when paired with a strong level (A) and counts match', () => {
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 80000n,
      printed_transaction_count: 2,
      parser_provides: ['A', 'D']
    });
    const transactions = [tx(-30000n, 'withdrawal'), tx(10000n, 'deposit')];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.strategy_used).toBe('A+D');
  });
});

describe('Multi-level scenarios', () => {
  test('A and B both pass — strategy is "A+B"', () => {
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 80000n,
      total_debits_minor: 30000n,
      total_credits_minor: 10000n,
      parser_provides: ['A', 'B']
    });
    const transactions = [tx(-30000n, 'withdrawal'), tx(10000n, 'deposit')];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.strategy_used).toBe('A+B');
  });

  test('A passes but B fails — refused (one mismatch is enough)', () => {
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 80000n,
      total_debits_minor: 50000n, // claim is $500 debits — but actual is only $300
      total_credits_minor: 10000n,
      parser_provides: ['A', 'B']
    });
    // Level A: 100000 - 30000 + 10000 = 80000 ✓
    // Level B: |-30000| = 30000, not 50000 ✗
    const transactions = [tx(-30000n, 'withdrawal'), tx(10000n, 'deposit')];
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Purchases & charges/i);
      expect(result.level_results.some((r) => r.level === 'B' && !r.passed)).toBe(true);
    }
  });

  test('refused when parser_provides is empty', () => {
    const statement = makeStatement({ parser_provides: [] });
    const result = runChecksumGate(statement, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/did not declare any reconciliation level/i);
  });
});

// ── Adversarial QA pass ────────────────────────────────────────────────────
describe('Adversarial: zero-transaction statements', () => {
  test('Level A passes with zero transactions when opening == closing', () => {
    // Customer paid in full + no spending during cycle: statement shows
    // opening = closing = same balance, no transactions.  Must still pass.
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 100000n,
      parser_provides: ['A']
    });
    const result = runChecksumGate(statement, []);
    expect(result.ok).toBe(true);
  });

  test('Level A fails with zero transactions when opening != closing', () => {
    // Real bug-catcher: the parser MUST have missed transactions if
    // opening and closing differ but no transactions parsed.
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 80000n,
      parser_provides: ['A']
    });
    const result = runChecksumGate(statement, []);
    expect(result.ok).toBe(false);
  });

  test('Level C with zero transactions on a paid-in-full credit card statement', () => {
    // Previous balance paid in full, no new activity: previous and new
    // should both be 0 (or equal).
    const statement = makeStatement({
      account_type: 'credit_card',
      previous_balance_minor: 0n,
      statement_balance_minor: 0n,
      parser_provides: ['C']
    });
    const result = runChecksumGate(statement, []);
    expect(result.ok).toBe(true);
  });
});

describe('Adversarial: extreme amounts', () => {
  test('handles $1,000,000+ in transactions without precision loss', () => {
    // BigInt arithmetic only; this catches accidental Number conversions.
    const statement = makeStatement({
      opening_balance_minor: 0n,
      closing_balance_minor: 100_000_000_00n - 50n, // $99,999,999.50
      parser_provides: ['A']
    });
    const result = runChecksumGate(statement, [tx(100_000_000_00n - 50n, 'deposit')]);
    expect(result.ok).toBe(true);
  });

  test('Level B catches a sign flip even when the absolute sum is correct', () => {
    // Classic parser bug: one transaction's sign was inverted (purchase
    // counted as refund).  Sum of absolutes is the same; Level A would
    // accidentally still pass.  Level B catches it.
    const statement = makeStatement({
      total_debits_minor: 30000n,
      total_credits_minor: 10000n,
      parser_provides: ['B']
    });
    // Parser produced: ONE $300 debit + ONE $100 credit (correct)
    // BUG SIMULATION: parser flipped — TWO $200 debits (one was meant to be credit)
    const flippedTxs = [tx(-20000n, 'purchase'), tx(-20000n, 'purchase')];
    const result = runChecksumGate(statement, flippedTxs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should name which side is off.
      expect(result.reason).toMatch(/(debits|credits)/i);
    }
  });
});

describe('Adversarial: Level D supplementary', () => {
  test('Level A passes but Level D fails (parsed too few transactions) — refused', () => {
    // Statement says 10 transactions, parser found 9 — but the balance
    // accidentally matches because the missing one was a refund + purchase
    // that cancelled.  Level D catches what A missed.
    const statement = makeStatement({
      opening_balance_minor: 100000n,
      closing_balance_minor: 70000n,
      printed_transaction_count: 10,
      parser_provides: ['A', 'D']
    });
    const transactions = [tx(-30000n, 'purchase')]; // 1 tx not 10
    const result = runChecksumGate(statement, transactions);
    expect(result.ok).toBe(false);
  });
});
