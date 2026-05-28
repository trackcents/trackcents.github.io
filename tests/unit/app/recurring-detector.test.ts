import { describe, test, expect } from 'vitest';
import { detectRecurring, type RecurringTxn } from '../../../src/lib/app/recurring-detector';

const t = (posted_date: string, amount_minor: bigint, description: string): RecurringTxn => ({
  posted_date,
  amount_minor,
  description
});

describe('detectRecurring', () => {
  test('detects a monthly subscription (4 stable charges ~30d apart) with a next-due date', () => {
    const streams = detectRecurring([
      t('2025-12-05', -1599n, 'NETFLIX.COM'),
      t('2026-01-05', -1599n, 'NETFLIX.COM'),
      t('2026-02-05', -1599n, 'NETFLIX.COM'),
      t('2026-03-05', -1599n, 'NETFLIX.COM')
    ]);
    expect(streams).toHaveLength(1);
    const s = streams[0]!;
    expect(s.cadence).toBe('monthly');
    expect(s.direction).toBe('outflow');
    expect(s.occurrences).toBe(4);
    expect(s.typical_amount_minor).toBe(1599n);
    expect(s.confidence).toBe('high');
    // 4 charges at Dec5/Jan5/Feb5/Mar5 → gaps 31, 31, 28 → median 31 → +31d = Apr 5.
    expect(s.next_due).toBe('2026-04-05');
  });

  test('a single occurrence is not recurring (REQ-B0.4 ≥4 hits)', () => {
    expect(detectRecurring([t('2026-01-05', -1599n, 'ONE TIME BUY')])).toEqual([]);
  });

  test('two occurrences are not enough to claim cadence (REQ-B0.4)', () => {
    // Previously the detector returned a "Weekly · overdue" stream from 2 hits.
    // Now ≥4 hits are required.
    expect(
      detectRecurring([
        t('2026-05-11', -3761n, '05/11 Payment To Chase Card Ending IN 1797'),
        t('2026-05-18', -4919n, '05/18 Payment To Chase Card Ending IN 1797')
      ])
    ).toEqual([]);
  });

  test('three occurrences are still not enough (REQ-B0.4)', () => {
    expect(
      detectRecurring([
        t('2026-03-05', -1599n, 'NETFLIX.COM'),
        t('2026-04-05', -1599n, 'NETFLIX.COM'),
        t('2026-05-05', -1599n, 'NETFLIX.COM')
      ])
    ).toEqual([]);
  });

  test('biweekly paycheck is an inflow stream (4 hits)', () => {
    const streams = detectRecurring([
      t('2025-12-19', 320000n, 'PAYROLL ACME'),
      t('2026-01-02', 320000n, 'PAYROLL ACME'),
      t('2026-01-16', 320000n, 'PAYROLL ACME'),
      t('2026-01-30', 320000n, 'PAYROLL ACME')
    ]);
    expect(streams[0]?.cadence).toBe('biweekly');
    expect(streams[0]?.direction).toBe('inflow');
    expect(streams[0]?.occurrences).toBe(4);
  });

  test('irregular spacing → irregular cadence, no predicted next due', () => {
    // Median gap = 67 days (outside any cadence band).  The amounts are
    // stable so the stream still surfaces, but cadence is 'irregular' and
    // next_due is null — we don't fabricate a prediction.
    const streams = detectRecurring([
      t('2026-01-01', -5000n, 'RANDO MERCHANT'),
      t('2026-02-05', -5000n, 'RANDO MERCHANT'),
      t('2026-04-13', -5000n, 'RANDO MERCHANT'),
      t('2026-09-22', -5000n, 'RANDO MERCHANT')
    ]);
    expect(streams[0]?.cadence).toBe('irregular');
    expect(streams[0]?.next_due).toBeNull();
  });

  test('amount-unstable stream is downgraded to irregular (REQ-B0.4)', () => {
    // Robinhood Card Payment: a $345 and a $1,967 payment averaged by the old
    // code into "$1,156 monthly" — a misleading prediction.  With amount
    // stability gating, even 4 occurrences of wildly different amounts are
    // reported as irregular and next_due is null.
    const streams = detectRecurring([
      t('2026-02-15', -34492n, 'Robinhood Card Payment'),
      t('2026-03-15', -100000n, 'Robinhood Card Payment'),
      t('2026-04-15', -196781n, 'Robinhood Card Payment'),
      t('2026-05-15', -50000n, 'Robinhood Card Payment')
    ]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.cadence).toBe('irregular');
    expect(streams[0]!.next_due).toBeNull();
  });

  test('amount-stable monthly survives the gate', () => {
    // Within ±35% of the median is fine — real-world bills vary slightly.
    const streams = detectRecurring([
      t('2026-01-15', -10000n, 'SPECTRUM INTERNET'),
      t('2026-02-15', -10500n, 'SPECTRUM INTERNET'),
      t('2026-03-15', -10000n, 'SPECTRUM INTERNET'),
      t('2026-04-15', -9800n, 'SPECTRUM INTERNET')
    ]);
    expect(streams[0]?.cadence).toBe('monthly');
    expect(streams[0]?.confidence).toBe('high');
  });

  test('groups by cleaned descriptor: ACH metadata variants land in ONE stream', () => {
    // Real example: Western Union Capture has different reference numbers
    // each time.  cleanDescription strips the trailing 9+ alphanum tail so
    // all three group under the same key "WESTERN UNION CAPTURE".
    const streams = detectRecurring([
      t('2026-01-04', -50000n, 'Western Union Capture 610380878310328 Web ID: 9222993574'),
      t('2026-02-04', -50000n, 'Western Union Capture 612585603025515 Web ID: 9222993574'),
      t('2026-03-04', -50000n, 'Western Union Capture 614087502863146 Web ID: 9222993574'),
      t('2026-04-04', -50000n, 'Western Union Capture 615838895620 Web ID: 9222993574')
    ]);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.occurrences).toBe(4);
  });

  test('groups by normalized descriptor (ignores digits/ids) and sorts by next due', () => {
    const streams = detectRecurring([
      t('2025-12-10', -1000n, 'SPOTIFY P0521'),
      t('2026-01-10', -1000n, 'SPOTIFY P0521'),
      t('2026-02-10', -1000n, 'SPOTIFY P9914'),
      t('2026-03-10', -1000n, 'SPOTIFY P9914'),
      t('2025-12-03', -6561n, 'AT&T 8881'),
      t('2026-01-03', -6561n, 'AT&T 8881'),
      t('2026-02-03', -6561n, 'AT&T 2034'),
      t('2026-03-03', -6561n, 'AT&T 2034')
    ]);
    // Two distinct streams (AT&T and SPOTIFY each get ≥4 hits); AT&T due 03 before Spotify due 10.
    expect(streams.length).toBe(2);
    expect(streams[0]!.next_due! < streams[1]!.next_due!).toBe(true);
  });
});
