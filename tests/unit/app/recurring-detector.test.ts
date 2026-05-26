import { describe, test, expect } from 'vitest';
import { detectRecurring, type RecurringTxn } from '../../../src/lib/app/recurring-detector';

const t = (posted_date: string, amount_minor: bigint, description: string): RecurringTxn => ({
  posted_date,
  amount_minor,
  description
});

describe('detectRecurring', () => {
  test('detects a monthly subscription (3 charges ~30d apart) with a next-due date', () => {
    const streams = detectRecurring([
      t('2026-01-05', -1599n, 'NETFLIX.COM'),
      t('2026-02-05', -1599n, 'NETFLIX.COM'),
      t('2026-03-05', -1599n, 'NETFLIX.COM')
    ]);
    expect(streams).toHaveLength(1);
    const s = streams[0]!;
    expect(s.cadence).toBe('monthly');
    expect(s.direction).toBe('outflow');
    expect(s.occurrences).toBe(3);
    expect(s.typical_amount_minor).toBe(1599n);
    expect(s.confidence).toBe('high');
    expect(s.next_due).toBe('2026-04-04'); // 2026-03-05 + ~30d
  });

  test('a single occurrence is not recurring', () => {
    expect(detectRecurring([t('2026-01-05', -1599n, 'ONE TIME BUY')])).toEqual([]);
  });

  test('biweekly paycheck is an inflow stream', () => {
    const streams = detectRecurring([
      t('2026-01-02', 320000n, 'PAYROLL ACME'),
      t('2026-01-16', 320000n, 'PAYROLL ACME'),
      t('2026-01-30', 320000n, 'PAYROLL ACME')
    ]);
    expect(streams[0]?.cadence).toBe('biweekly');
    expect(streams[0]?.direction).toBe('inflow');
  });

  test('irregular spacing → irregular cadence, no predicted next due', () => {
    const streams = detectRecurring([
      t('2026-01-01', -5000n, 'RANDO MERCHANT'),
      t('2026-01-09', -5000n, 'RANDO MERCHANT'),
      t('2026-03-20', -5000n, 'RANDO MERCHANT')
    ]);
    expect(streams[0]?.cadence).toBe('irregular');
    expect(streams[0]?.next_due).toBeNull();
  });

  test('groups by normalized descriptor (ignores digits/ids) and sorts by next due', () => {
    const streams = detectRecurring([
      t('2026-01-10', -1000n, 'SPOTIFY P0521'),
      t('2026-02-10', -1000n, 'SPOTIFY P9914'),
      t('2026-01-03', -6561n, 'AT&T 8881'),
      t('2026-02-03', -6561n, 'AT&T 2034')
    ]);
    // Two distinct streams, AT&T due 03 before Spotify due 10.
    expect(streams.length).toBe(2);
    expect(streams[0]!.next_due! < streams[1]!.next_due!).toBe(true);
  });
});
