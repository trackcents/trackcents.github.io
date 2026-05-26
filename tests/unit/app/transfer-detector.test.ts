import { describe, test, expect } from 'vitest';
import { detectTransfers, type TransferTxn } from '../../../src/lib/app/transfer-detector';

const tx = (
  key: string,
  account_id: string,
  posted_date: string,
  amount_minor: bigint,
  description = 'x'
): TransferTxn => ({ key, account_id, posted_date, amount_minor, description });

describe('detectTransfers', () => {
  test('pairs an outflow with an equal inflow in a different account within the window', () => {
    const pairs = detectTransfers([
      tx('chk#0', 'chk', '2026-03-01', -50000n, 'Online transfer to savings'),
      tx('sav#0', 'sav', '2026-03-02', 50000n, 'Transfer from checking')
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.outflow_key).toBe('chk#0');
    expect(pairs[0]!.inflow_key).toBe('sav#0');
    expect(pairs[0]!.amount_minor).toBe(50000n);
    expect(pairs[0]!.gap_days).toBe(1);
    expect(pairs[0]!.confidence).toBe('high'); // descriptor hint
  });

  test('does NOT pair within the same account', () => {
    expect(
      detectTransfers([
        tx('chk#0', 'chk', '2026-03-01', -50000n),
        tx('chk#1', 'chk', '2026-03-01', 50000n)
      ])
    ).toEqual([]);
  });

  test('does NOT pair when the gap exceeds maxGapDays', () => {
    const txns = [
      tx('chk#0', 'chk', '2026-03-01', -50000n),
      tx('sav#0', 'sav', '2026-03-20', 50000n)
    ];
    expect(detectTransfers(txns)).toEqual([]); // 19 days > default 5
    expect(detectTransfers(txns, { maxGapDays: 30 })).toHaveLength(1);
  });

  test('requires equal magnitude', () => {
    expect(
      detectTransfers([
        tx('chk#0', 'chk', '2026-03-01', -50000n),
        tx('sav#0', 'sav', '2026-03-02', 49999n)
      ])
    ).toEqual([]);
  });

  test('confidence is medium without a descriptor hint', () => {
    const pairs = detectTransfers([
      tx('chk#0', 'chk', '2026-03-01', -50000n, 'ACH DEBIT'),
      tx('sav#0', 'sav', '2026-03-01', 50000n, 'ACH CREDIT')
    ]);
    expect(pairs[0]!.confidence).toBe('medium');
  });

  test('each transaction is used at most once (greedy, closest gap wins)', () => {
    // one outflow, two candidate inflows; the closer-dated one is chosen.
    const pairs = detectTransfers([
      tx('chk#0', 'chk', '2026-03-01', -50000n),
      tx('sav#0', 'sav', '2026-03-05', 50000n), // gap 4
      tx('sav#1', 'sav', '2026-03-02', 50000n) // gap 1 → preferred
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.inflow_key).toBe('sav#1');
  });

  test('two distinct transfers pair independently', () => {
    const pairs = detectTransfers([
      tx('chk#0', 'chk', '2026-03-01', -50000n),
      tx('sav#0', 'sav', '2026-03-01', 50000n),
      tx('chk#1', 'chk', '2026-03-10', -20000n),
      tx('sav#1', 'sav', '2026-03-11', 20000n)
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.amount_minor)).toEqual([50000n, 20000n]); // sorted by out_date
  });

  test('is deterministic + does not mutate input regardless of order', () => {
    const txns = [
      tx('sav#0', 'sav', '2026-03-02', 50000n),
      tx('chk#0', 'chk', '2026-03-01', -50000n)
    ];
    const snapshot = JSON.stringify(txns, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
    const a = detectTransfers(txns);
    const b = detectTransfers([...txns].reverse());
    expect(a).toEqual(b);
    expect(JSON.stringify(txns, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))).toBe(snapshot);
  });

  test('empty / no-match inputs return []', () => {
    expect(detectTransfers([])).toEqual([]);
    expect(detectTransfers([tx('chk#0', 'chk', '2026-03-01', -50000n)])).toEqual([]);
  });
});
