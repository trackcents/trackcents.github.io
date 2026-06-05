import { describe, test, expect } from 'vitest';
import { findManualDuplicates, duplicateExtraCount } from '../../../src/lib/app/duplicate-detect';
import type { UnifiedRow } from '../../../src/lib/app/transaction-view';

let seq = 0;
function row(over: Partial<UnifiedRow> = {}): UnifiedRow {
  seq += 1;
  return {
    bank_name: 'Cash',
    account_type: 'cash',
    account_last_4: null,
    pdf_source_hash: `manual-${seq}`,
    adapter_name: 'manual',
    adapter_version: '1.0.0',
    posted_date: '2026-06-04',
    description: 'Auto',
    amount_minor: -15200n,
    currency: 'INR',
    transaction_type: 'purchase',
    raw_text: '',
    import_index: seq,
    transaction_index: 0,
    ...over
  };
}

describe('findManualDuplicates', () => {
  test('groups manual rows with identical date+amount+account+description', () => {
    const rows = [
      row({ description: 'Auto' }),
      row({ description: 'Auto' }), // duplicate of the first
      row({ description: 'Watermelon', amount_minor: -3000n })
    ];
    const groups = findManualDuplicates(rows);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows.length).toBe(2);
    expect(duplicateExtraCount(groups)).toBe(1);
  });

  test('ignores the leading time prefix when comparing descriptions', () => {
    const rows = [row({ description: '09:00 · Auto' }), row({ description: '13:30 · Auto' })];
    // Same logical entry, different clock times → still flagged as duplicates.
    expect(findManualDuplicates(rows)[0]?.rows.length).toBe(2);
  });

  test('does NOT group when amount, account, or date differ', () => {
    const rows = [
      row({ description: 'Auto', amount_minor: -100n }),
      row({ description: 'Auto', amount_minor: -200n }), // different amount
      row({ description: 'Auto', bank_name: 'HDFC' }), // different account
      row({ description: 'Auto', posted_date: '2026-06-03' }) // different day
    ];
    expect(findManualDuplicates(rows)).toEqual([]);
  });

  test('never flags statement (non-manual) imports, even if identical', () => {
    const rows = [
      row({ adapter_name: 'chase', pdf_source_hash: 'pdf-1', description: 'AMAZON' }),
      row({ adapter_name: 'chase', pdf_source_hash: 'pdf-2', description: 'AMAZON' })
    ];
    expect(findManualDuplicates(rows)).toEqual([]);
  });

  test('three copies → one group of three (two extras)', () => {
    const rows = [row({ description: 'Salary', amount_minor: 2000000n })];
    rows.push(row({ description: 'Salary', amount_minor: 2000000n }));
    rows.push(row({ description: 'Salary', amount_minor: 2000000n }));
    const groups = findManualDuplicates(rows);
    expect(groups[0]!.rows.length).toBe(3);
    expect(duplicateExtraCount(groups)).toBe(2);
  });
});
