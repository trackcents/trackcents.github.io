// Multi-level checksum gate per specs/001-money-tracker-mvp/research.md §R13.
//
// The constitution (Principle II) mandates a hard import gate: every statement's
// parsed transactions MUST reconcile to the printed statement totals.  The "totals"
// available vary per statement, so we run a configurable set of checks (levels):
//
//   Level A — balance reconciliation:    opening + Σ(transactions) == closing
//   Level B — aggregate totals:          |Σ(debits)| == total_debits AND Σ(credits) == total_credits
//   Level C — credit-card balance:       previous + Σ(charges) - Σ(payments) == new_balance
//   Level D — transaction count:         count(transactions) == printed_count   (supplementary only)
//
// Rules:
//   * The adapter declares which levels it populated via `statement.parser_provides`.
//   * At least one of A/B/C must be populated.  Level D alone is INSUFFICIENT — refused.
//   * Every populated level must pass.  ANY failure means the gate refuses the import.
//   * Return value carries per-level results for the UI's checksum-diff display.
//
// Sign convention (constitution Principle II, contract obligation 5):
//   Outflows from the user's perspective are NEGATIVE in `amount_minor`.
//   Inflows are POSITIVE.
//   For credit cards: purchases are outflows (negative); payments to the card
//   are inflows (positive — reducing what the user owes).

import type { ChecksumLevel, ParsedStatement, ParsedTransaction } from '../adapters/types';
import { formatMoney } from '../util/money';

export interface ChecksumLevelResult {
  level: ChecksumLevel;
  passed: boolean;
  expected_minor: bigint | null;
  actual_minor: bigint | null;
  diff_minor: bigint | null;
  message: string;
}

export type ChecksumGateResult =
  | { ok: true; strategy_used: string; level_results: ChecksumLevelResult[] }
  | { ok: false; reason: string; level_results: ChecksumLevelResult[] };

/**
 * Run the gate.  Returns OK with the strategy string (e.g. "A+B") that records
 * which levels passed, or a refusal with a human-readable reason.
 *
 * The caller should:
 *   - On OK: persist the statement with `import_status='imported'` and
 *     `checksum_strategy_used` set to the returned strategy.
 *   - On refusal: persist the statement with `import_status='refused'` and
 *     the returned `reason` as `refusal_reason`.  Do NOT insert any transactions.
 */
export function runChecksumGate(
  statement: ParsedStatement,
  transactions: ParsedTransaction[]
): ChecksumGateResult {
  const provides = statement.parser_provides;

  if (provides.length === 0) {
    return {
      ok: false,
      reason:
        'Checksum gate refused: adapter did not declare any reconciliation level. ' +
        'Per Principle II, an unverifiable import is unacceptable.',
      level_results: []
    };
  }

  const strongLevels = provides.filter((l) => l !== 'D');
  if (strongLevels.length === 0) {
    return {
      ok: false,
      reason:
        'Checksum gate refused: only Level D (transaction count) provided. ' +
        'Level D alone is insufficient — it cannot catch wrong amounts. ' +
        'Per research.md §R13, at least one of Level A, B, or C must be populated.',
      level_results: []
    };
  }

  const results: ChecksumLevelResult[] = [];
  for (const level of provides) {
    switch (level) {
      case 'A':
        results.push(runLevelA(statement, transactions));
        break;
      case 'B':
        results.push(runLevelB(statement, transactions));
        break;
      case 'C':
        results.push(runLevelC(statement, transactions));
        break;
      case 'D':
        results.push(runLevelD(statement, transactions));
        break;
    }
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    return {
      ok: false,
      reason: `Checksum gate refused: ${failures.map((f) => f.message).join('; ')}`,
      level_results: results
    };
  }

  // All passed.  Build the strategy string from the order provided (stable).
  return {
    ok: true,
    strategy_used: provides.join('+'),
    level_results: results
  };
}

// ── Per-level checks ─────────────────────────────────────────────────────────

function runLevelA(
  statement: ParsedStatement,
  transactions: ParsedTransaction[]
): ChecksumLevelResult {
  const opening = statement.opening_balance_minor;
  const closing = statement.closing_balance_minor;
  if (opening === null || closing === null) {
    return missingFields(
      'A',
      'opening_balance_minor and closing_balance_minor must both be populated'
    );
  }
  const tx_sum = sumAmounts(transactions);
  const expected = opening + tx_sum;
  return makeResult('A', 'opening + transactions = closing balance', expected, closing);
}

function runLevelB(
  statement: ParsedStatement,
  transactions: ParsedTransaction[]
): ChecksumLevelResult {
  const printed_debits = statement.total_debits_minor;
  const printed_credits = statement.total_credits_minor;
  if (printed_debits === null || printed_credits === null) {
    return missingFields('B', 'total_debits_minor and total_credits_minor must both be populated');
  }
  const debit_sum = absSum(transactions.filter((t) => t.amount_minor < 0n));
  const credit_sum = sumAmounts(transactions.filter((t) => t.amount_minor > 0n));

  const debits_ok = debit_sum === printed_debits;
  const credits_ok = credit_sum === printed_credits;

  if (debits_ok && credits_ok) {
    return {
      level: 'B',
      passed: true,
      expected_minor: printed_debits + printed_credits,
      actual_minor: debit_sum + credit_sum,
      diff_minor: 0n,
      message:
        `Section totals match: purchases & charges total ${formatMoney(printed_debits)}, ` +
        `payments & credits total ${formatMoney(printed_credits)}.`
    };
  }

  // Build a useful diff message that names which side failed and by how much.
  const debit_diff = debit_sum - printed_debits;
  const credit_diff = credit_sum - printed_credits;
  const parts: string[] = [];
  if (!debits_ok) {
    parts.push(
      `Purchases & charges: statement says ${formatMoney(printed_debits)}, ` +
        `parser found ${formatMoney(debit_sum)} ` +
        `(off by ${formatMoney(absVal(debit_diff))} ${debit_diff < 0n ? 'low' : 'high'})`
    );
  }
  if (!credits_ok) {
    parts.push(
      `Payments & credits: statement says ${formatMoney(printed_credits)}, ` +
        `parser found ${formatMoney(credit_sum)} ` +
        `(off by ${formatMoney(absVal(credit_diff))} ${credit_diff < 0n ? 'low' : 'high'})`
    );
  }
  return {
    level: 'B',
    passed: false,
    expected_minor: printed_debits + printed_credits,
    actual_minor: debit_sum + credit_sum,
    diff_minor: debit_diff + credit_diff,
    message: parts.join(' · ')
  };
}

function runLevelC(
  statement: ParsedStatement,
  transactions: ParsedTransaction[]
): ChecksumLevelResult {
  const previous = statement.previous_balance_minor;
  const new_balance = statement.statement_balance_minor;
  if (previous === null || new_balance === null) {
    return missingFields(
      'C',
      'previous_balance_minor and statement_balance_minor must both be populated'
    );
  }
  // Charges are outflows (negative in our schema); payments to the card are inflows (positive).
  // Expected new_balance = previous + |charges| - payments.
  const sum_charges = absSum(transactions.filter((t) => t.amount_minor < 0n));
  const sum_payments = sumAmounts(transactions.filter((t) => t.amount_minor > 0n));
  const expected = previous + sum_charges - sum_payments;
  return makeResult(
    'C',
    'previous balance + purchases − payments = new balance',
    expected,
    new_balance
  );
}

function runLevelD(
  statement: ParsedStatement,
  transactions: ParsedTransaction[]
): ChecksumLevelResult {
  const printed = statement.printed_transaction_count;
  if (printed === null) {
    return missingFields('D', 'printed_transaction_count must be populated');
  }
  const actual = transactions.length;
  const passed = printed === actual;
  return {
    level: 'D',
    passed,
    expected_minor: BigInt(printed),
    actual_minor: BigInt(actual),
    diff_minor: BigInt(printed - actual),
    message: passed
      ? `Transaction count matches (${printed} rows).`
      : `Transaction count mismatch: statement lists ${printed} rows, parser found ${actual}.`
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function absVal(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function sumAmounts(txs: ParsedTransaction[]): bigint {
  let s = 0n;
  for (const t of txs) s += t.amount_minor;
  return s;
}

/** Sum the absolute values of negative-amount transactions (i.e., outflows as positive). */
function absSum(txs: ParsedTransaction[]): bigint {
  let s = 0n;
  for (const t of txs) {
    s += t.amount_minor < 0n ? -t.amount_minor : t.amount_minor;
  }
  return s;
}

function makeResult(
  level: ChecksumLevel,
  label: string,
  expected: bigint,
  actual: bigint
): ChecksumLevelResult {
  const diff = expected - actual;
  const passed = diff === 0n;
  return {
    level,
    passed,
    expected_minor: expected,
    actual_minor: actual,
    diff_minor: diff,
    message: passed
      ? `Equation holds: ${label} = ${formatMoney(actual)}.`
      : `Equation broke (${label}): statement shows ${formatMoney(actual)}, ` +
        `parser computes ${formatMoney(expected)} ` +
        `(off by ${formatMoney(absVal(diff))} ${diff < 0n ? 'low' : 'high'}).`
  };
}

function missingFields(level: ChecksumLevel, detail: string): ChecksumLevelResult {
  return {
    level,
    passed: false,
    expected_minor: null,
    actual_minor: null,
    diff_minor: null,
    message: `Level ${level} cannot run: ${detail} (adapter declared it but did not populate the required fields)`
  };
}
