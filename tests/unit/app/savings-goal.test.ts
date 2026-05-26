import { describe, test, expect } from 'vitest';
import {
  goalProgress,
  goalsTotals,
  makeGoal,
  SavingsGoalError,
  type SavingsGoal
} from '../../../src/lib/app/savings-goal';

const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g1',
  name: 'Emergency fund',
  target_minor: 100000n,
  saved_minor: 25000n,
  ...over
});

describe('goalProgress', () => {
  test('computes pct, remaining, not-complete', () => {
    const p = goalProgress(goal());
    expect(p.pct).toBeCloseTo(25, 5);
    expect(p.rawPct).toBeCloseTo(25, 5);
    expect(p.remaining_minor).toBe(75000n);
    expect(p.complete).toBe(false);
  });

  test('complete when saved >= target; remaining floors at 0', () => {
    const p = goalProgress(goal({ saved_minor: 120000n }));
    expect(p.complete).toBe(true);
    expect(p.remaining_minor).toBe(0n);
    expect(p.pct).toBe(100); // clamped
    expect(p.rawPct).toBeCloseTo(120, 5); // uncapped
  });

  test('exactly at target is complete', () => {
    expect(goalProgress(goal({ saved_minor: 100000n })).complete).toBe(true);
  });

  test('negative saved clamps to 0', () => {
    const p = goalProgress(goal({ saved_minor: -500n }));
    expect(p.pct).toBe(0);
    expect(p.remaining_minor).toBe(100000n);
  });

  test('non-positive target yields 0% and not complete (no divide-by-zero)', () => {
    expect(goalProgress(goal({ target_minor: 0n }))).toEqual({
      pct: 0,
      rawPct: 0,
      remaining_minor: 0n,
      complete: false
    });
  });
});

describe('goalsTotals', () => {
  test('sums targets and saved, floors remaining at 0', () => {
    const t = goalsTotals([
      goal({ id: 'a', target_minor: 100000n, saved_minor: 40000n }),
      goal({ id: 'b', target_minor: 50000n, saved_minor: 60000n }) // over-saved
    ]);
    expect(t.target_minor).toBe(150000n);
    expect(t.saved_minor).toBe(100000n);
    expect(t.remaining_minor).toBe(50000n);
  });
});

describe('makeGoal validation (no silent failures)', () => {
  test('builds a valid goal', () => {
    const g = makeGoal({ name: '  Car  ', target_minor: 500000n }, 'g9');
    expect(g).toEqual({ id: 'g9', name: 'Car', target_minor: 500000n, saved_minor: 0n });
  });
  test('keeps an optional deadline', () => {
    const g = makeGoal({ name: 'Trip', target_minor: 1n, deadline: '2026-12-31' }, 'g9');
    expect(g.deadline).toBe('2026-12-31');
  });
  test('rejects empty name', () => {
    expect(() => makeGoal({ name: '  ', target_minor: 1n }, 'g9')).toThrow(SavingsGoalError);
  });
  test('rejects non-positive target', () => {
    expect(() => makeGoal({ name: 'X', target_minor: 0n }, 'g9')).toThrow(/positive/);
  });
  test('rejects negative saved', () => {
    expect(() => makeGoal({ name: 'X', target_minor: 1n, saved_minor: -1n }, 'g9')).toThrow(/≥ 0/);
  });
  test('rejects a malformed deadline', () => {
    expect(() => makeGoal({ name: 'X', target_minor: 1n, deadline: '12/31/26' }, 'g9')).toThrow(
      /ISO/
    );
  });
  test('rejects an empty id', () => {
    expect(() => makeGoal({ name: 'X', target_minor: 1n }, '')).toThrow(/id/);
  });
});
