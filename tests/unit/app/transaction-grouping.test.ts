/**
 * Day-grouping + friendly-date helpers for the redesigned transactions ledger.
 * groupRowsByDay must preserve order, group consecutive same-date runs, and sum
 * each day's signed net exactly (bigint). formatDayHeading must say
 * Today/Yesterday relative to a passed-in (testable) "today" and otherwise show
 * a weekday+month+day, with the year only when it differs.
 */
import { describe, expect, test } from 'vitest';
import {
  groupRowsByDay,
  formatDayHeading,
  type UnifiedRow
} from '../../../src/lib/app/transaction-view';

function row(date: string, cents: bigint, desc = 'x'): UnifiedRow {
  return {
    bank_name: 'Chase',
    account_type: 'checking',
    account_last_4: '9535',
    pdf_source_hash: 'h',
    adapter_name: 'a',
    adapter_version: '1',
    posted_date: date,
    description: desc,
    amount_minor: cents,
    currency: 'USD',
    transaction_type: 'purchase',
    raw_text: desc,
    import_index: 0,
    transaction_index: 0
  };
}

describe('groupRowsByDay', () => {
  test('groups consecutive same-date runs in order, one group per day', () => {
    const rows = [
      row('2026-05-30', -575n),
      row('2026-05-30', -8240n),
      row('2026-05-29', -3999n),
      row('2026-05-27', 320000n),
      row('2026-05-27', -180000n)
    ];
    const groups = groupRowsByDay(rows);
    expect(groups.map((g) => g.date)).toEqual(['2026-05-30', '2026-05-29', '2026-05-27']);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 1, 2]);
  });

  test('net_minor is the exact signed sum of each day', () => {
    const groups = groupRowsByDay([
      row('2026-05-27', 320000n), // salary
      row('2026-05-27', -180000n) // rent
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.net_minor).toBe(140000n); // +$1,400 net that day
  });

  test('a date that recurs non-consecutively makes a NEW group (caller sorts by date)', () => {
    // Non-date sort can interleave dates; we group runs, never merge across.
    const groups = groupRowsByDay([
      row('2026-05-30', -1n),
      row('2026-05-29', -1n),
      row('2026-05-30', -1n)
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-05-30', '2026-05-29', '2026-05-30']);
  });

  test('empty input yields no groups', () => {
    expect(groupRowsByDay([])).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const rows = [row('2026-05-30', -1n)];
    const copy = [...rows];
    groupRowsByDay(rows);
    expect(rows).toEqual(copy);
  });
});

describe('formatDayHeading', () => {
  const today = '2026-05-30';
  test('today → "Today"', () => {
    expect(formatDayHeading('2026-05-30', today)).toBe('Today');
  });
  test('yesterday → "Yesterday"', () => {
    expect(formatDayHeading('2026-05-29', today)).toBe('Yesterday');
  });
  test('yesterday across a month boundary', () => {
    expect(formatDayHeading('2026-04-30', '2026-05-01')).toBe('Yesterday');
  });
  test('older same-year date → "Wkd, Mon D" with no year', () => {
    expect(formatDayHeading('2026-05-26', today)).toBe('Tue, May 26');
  });
  test('different-year date appends the year', () => {
    expect(formatDayHeading('2025-12-25', today)).toBe('Thu, Dec 25, 2025');
  });
  test('a future date (not today/yesterday) still formats as a weekday', () => {
    expect(formatDayHeading('2026-06-01', today)).toBe('Mon, Jun 1');
  });
});
