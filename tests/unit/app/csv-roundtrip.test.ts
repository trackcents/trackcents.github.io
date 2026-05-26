import { describe, test, expect } from 'vitest';
import {
  exportTransactionsCsv,
  centsToDecimal,
  csvEscape,
  type CsvExportRow
} from '../../../src/lib/app/export-csv';
import {
  importCsv,
  parseCsvRows,
  parseAmountToCents,
  CsvImportError
} from '../../../src/lib/app/csv-import';
import { diagnosePersistedState } from '../../../src/lib/db/schema';
import { STORE_VERSION } from '../../../src/lib/db/store';

describe('centsToDecimal', () => {
  test('renders signed cents with two decimals, no float', () => {
    expect(centsToDecimal(0n)).toBe('0.00');
    expect(centsToDecimal(5n)).toBe('0.05');
    expect(centsToDecimal(1234n)).toBe('12.34');
    expect(centsToDecimal(-1234n)).toBe('-12.34');
    expect(centsToDecimal(100000000n)).toBe('1000000.00');
  });
});

describe('csvEscape', () => {
  test('quotes fields with commas, quotes, or newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('parseAmountToCents', () => {
  test('plain, negative, parens, currency symbols, thousands', () => {
    expect(parseAmountToCents('12.34', 2)).toBe(1234n);
    expect(parseAmountToCents('-12.34', 2)).toBe(-1234n);
    expect(parseAmountToCents('(12.34)', 2)).toBe(-1234n);
    expect(parseAmountToCents('$1,234.50', 2)).toBe(123450n);
    expect(parseAmountToCents('1000000', 2)).toBe(100000000n);
  });
  test('rounds beyond 2 decimals to nearest cent', () => {
    expect(parseAmountToCents('1.005', 2)).toBe(101n);
    expect(parseAmountToCents('1.004', 2)).toBe(100n);
  });
  test('throws with row context on garbage', () => {
    expect(() => parseAmountToCents('abc', 7)).toThrow(/row 7/);
  });
});

describe('parseCsvRows (RFC-4180)', () => {
  test('handles quotes, embedded commas and newlines', () => {
    const rows = parseCsvRows('a,b\r\n"x,y","line1\nline2"\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2']
    ]);
  });
  test('throws on an unterminated quote', () => {
    expect(() => parseCsvRows('a,"unterminated')).toThrow(CsvImportError);
  });
});

describe('importCsv', () => {
  const opts = { account_name: 'My Bank', source_id: 's1', imported_at: '2026-05-26T00:00:00Z' };

  test('imports a signed-amount CSV into a schema-valid ImportRecord', () => {
    const csv = 'date,description,amount\r\n2026-01-02,COFFEE,-4.50\r\n2026-01-03,PAY,1000.00\r\n';
    const rec = importCsv(csv, opts);
    expect(rec.transactions).toHaveLength(2);
    expect(rec.transactions[0]!.amount_minor).toBe(-450n);
    expect(rec.transactions[1]!.amount_minor).toBe(100000n);
    expect(rec.checksum_strategy_used).toContain('no checksum');
    const state = { version: STORE_VERSION, imports: [rec], reconciliation_links: [] };
    expect(diagnosePersistedState(state)).toBeNull();
  });

  test('supports a debit/credit pair', () => {
    const csv =
      'date,description,debit,credit\r\n2026-01-02,RENT,1500.00,\r\n2026-01-03,REFUND,,20.00\r\n';
    const rec = importCsv(csv, opts);
    expect(rec.transactions[0]!.amount_minor).toBe(-150000n);
    expect(rec.transactions[1]!.amount_minor).toBe(2000n);
  });

  test('throws (no silent skip) on a non-ISO date with row context', () => {
    const csv = 'date,description,amount\r\n01/02/2026,COFFEE,-4.50\r\n';
    expect(() => importCsv(csv, opts)).toThrow(/row 2/);
  });

  test('throws when required columns are missing', () => {
    expect(() => importCsv('foo,bar\r\n1,2\r\n', opts)).toThrow(/date column/);
  });

  test('throws when both debit and credit are filled', () => {
    const csv = 'date,description,debit,credit\r\n2026-01-02,X,5.00,5.00\r\n';
    expect(() => importCsv(csv, opts)).toThrow(/exactly one/);
  });
});

describe('export → import round-trip', () => {
  test('exported CSV re-imports to the same amounts', () => {
    const rows: CsvExportRow[] = [
      {
        posted_date: '2026-01-02',
        description: 'COFFEE, large',
        amount_minor: -450n,
        currency: 'USD',
        account: 'Cash'
      },
      {
        posted_date: '2026-01-03',
        description: 'PAY "bonus"',
        amount_minor: 100000n,
        currency: 'USD',
        account: 'Cash'
      }
    ];
    const csv = exportTransactionsCsv(rows);
    const rec = importCsv(csv, {
      account_name: 'Cash',
      source_id: 'rt',
      imported_at: '2026-05-26T00:00:00Z'
    });
    expect(rec.transactions.map((t) => t.amount_minor)).toEqual([-450n, 100000n]);
    expect(rec.transactions.map((t) => t.description)).toEqual(['COFFEE, large', 'PAY "bonus"']);
  });
});
