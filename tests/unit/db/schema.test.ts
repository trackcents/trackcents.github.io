// Tests for the runtime invariant guard at the OPFS-JSON boundary.
//
// The whole point of schema.ts is to catch corruption that TypeScript's
// static types can't catch — e.g., a number where a bigint should be, a
// missing-required field, a wrong enum value.  These tests prove the
// guard fires on each.

import { describe, test, expect } from 'vitest';
import { validatePersistedState, diagnosePersistedState } from '../../../src/lib/db/schema';

function validState() {
  return {
    version: 1,
    imports: [
      {
        bank_name: 'Test Bank',
        adapter_name: 'test-adapter',
        adapter_version: '0.1.0',
        pdf_source_hash: 'aabbccdd11223344',
        imported_at: '2026-05-23T10:00:00.000Z',
        statement: {
          account_type: 'credit_card',
          account_last_4: '1234',
          period_start: '2026-04-01',
          period_end: '2026-04-30',
          currency: 'USD',
          opening_balance_minor: null,
          closing_balance_minor: null,
          total_debits_minor: 5000n,
          total_credits_minor: 5000n,
          previous_balance_minor: 0n,
          statement_balance_minor: 0n,
          printed_transaction_count: 1,
          summary_lines: [{ label: 'Previous Balance', amount_minor: 0n }],
          payment_due_date: '2026-05-25',
          statement_date: '2026-04-30',
          minimum_payment_due_minor: null,
          parser_provides: ['C']
        },
        transactions: [
          {
            posted_date: '2026-04-15',
            description: 'AMAZON',
            raw_text: 'AMAZON',
            amount_minor: -5000n,
            currency: 'USD',
            transaction_type: 'purchase'
          }
        ],
        checksum_strategy_used: 'C'
      }
    ],
    reconciliation_links: []
  };
}

describe('persistedStateSchema — happy path', () => {
  test('a fully valid state passes', () => {
    expect(() => validatePersistedState(validState())).not.toThrow();
  });

  test('diagnose returns null for valid state', () => {
    expect(diagnosePersistedState(validState())).toBeNull();
  });
});

describe('persistedStateSchema — Constitution Principle II (money MUST be bigint)', () => {
  test('rejects a JavaScript number where amount_minor should be bigint', () => {
    const corrupt = validState();
    // Inject a number instead of bigint
    (corrupt.imports[0]!.transactions[0]! as unknown as { amount_minor: number }).amount_minor =
      -5000;
    expect(() => validatePersistedState(corrupt)).toThrow();
    const issues = diagnosePersistedState(corrupt)!;
    expect(issues.some((i) => i.includes('amount_minor'))).toBe(true);
  });

  test('rejects a number for statement_balance_minor', () => {
    const corrupt = validState();
    (
      corrupt.imports[0]!.statement as unknown as { statement_balance_minor: number }
    ).statement_balance_minor = 0;
    expect(() => validatePersistedState(corrupt)).toThrow();
  });

  test('rejects a number for matched_amount_minor in reconciliation link', () => {
    const corrupt = validState() as unknown as {
      reconciliation_links: Array<Record<string, unknown>>;
    };
    corrupt.reconciliation_links.push({
      bank_import_index: 0,
      bank_transaction_index: 0,
      cc_import_index: 0,
      cc_transaction_index: 0,
      link_type: 'auto',
      confidence_score: 1,
      matched_amount_minor: 100, // ← number instead of bigint
      matched_date: '2026-04-15'
    });
    expect(() => validatePersistedState(corrupt)).toThrow();
  });
});

describe('persistedStateSchema — date format must be ISO YYYY-MM-DD', () => {
  test('rejects MM/DD/YYYY format', () => {
    const corrupt = validState();
    corrupt.imports[0]!.transactions[0]!.posted_date = '04/15/2026';
    expect(() => validatePersistedState(corrupt)).toThrow(/posted_date/);
  });

  test('rejects a Date object', () => {
    const corrupt = validState() as unknown as {
      imports: Array<{ transactions: Array<{ posted_date: Date }> }>;
    };
    corrupt.imports[0]!.transactions[0]!.posted_date = new Date('2026-04-15');
    expect(() => validatePersistedState(corrupt)).toThrow();
  });
});

describe('persistedStateSchema — enum constraints', () => {
  test('rejects unknown transaction_type', () => {
    const corrupt = validState() as unknown as {
      imports: Array<{ transactions: Array<{ transaction_type: string }> }>;
    };
    corrupt.imports[0]!.transactions[0]!.transaction_type = 'mystery_type';
    expect(() => validatePersistedState(corrupt)).toThrow(/transaction_type/);
  });

  test('rejects unknown account_type', () => {
    const corrupt = validState() as unknown as {
      imports: Array<{ statement: { account_type: string } }>;
    };
    corrupt.imports[0]!.statement.account_type = 'crypto_wallet';
    expect(() => validatePersistedState(corrupt)).toThrow(/account_type/);
  });

  test('rejects empty parser_provides array', () => {
    const corrupt = validState();
    corrupt.imports[0]!.statement.parser_provides = [];
    expect(() => validatePersistedState(corrupt)).toThrow();
  });
});

describe('persistedStateSchema — missing required fields', () => {
  test('rejects an import missing bank_name', () => {
    const corrupt = validState() as unknown as {
      imports: Array<{ bank_name?: string }>;
    };
    delete corrupt.imports[0]!.bank_name;
    expect(() => validatePersistedState(corrupt)).toThrow();
  });

  test('rejects a statement missing period_start', () => {
    const corrupt = validState() as unknown as {
      imports: Array<{ statement: { period_start?: string } }>;
    };
    delete corrupt.imports[0]!.statement.period_start;
    expect(() => validatePersistedState(corrupt)).toThrow();
  });
});

describe('persistedStateSchema — error messages name the failing path', () => {
  test('diagnose returns a path that points at the corrupt field', () => {
    const corrupt = validState();
    (corrupt.imports[0]!.transactions[0]! as unknown as { amount_minor: number }).amount_minor = 99;
    const issues = diagnosePersistedState(corrupt)!;
    // The issue path should mention "imports", "transactions", and "amount_minor"
    const joined = issues.join(' ');
    expect(joined).toContain('imports');
    expect(joined).toContain('transactions');
    expect(joined).toContain('amount_minor');
  });
});
