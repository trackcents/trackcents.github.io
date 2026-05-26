/**
 * Savings goals (US-P4-B) — pure logic.
 *
 * A goal is a target amount the user is saving toward, with a manually-tracked
 * "saved so far". We do NOT infer progress from account balances (statements
 * don't give reliable running balances, and inferring would risk amount-based
 * guessing); the user controls `saved_minor` directly — same philosophy as the
 * rest of the app. Money is bigint cents (constitution II); `pct` is a display
 * float only.
 */

export interface SavingsGoal {
  id: string;
  name: string;
  /** Target to reach (positive cents). */
  target_minor: bigint;
  /** Amount saved so far (≥ 0 cents). */
  saved_minor: bigint;
  /** Optional ISO YYYY-MM-DD target date. */
  deadline?: string;
}

export interface GoalProgress {
  /** saved / target × 100, clamped to [0, 100] for the ring (raw available via rawPct). */
  pct: number;
  /** Uncapped percent (can exceed 100 when over-saved). */
  rawPct: number;
  /** target − saved, floored at 0 (never negative). */
  remaining_minor: bigint;
  /** True once saved ≥ target. */
  complete: boolean;
}

export class SavingsGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavingsGoalError';
  }
}

/** Progress for one goal. A non-positive target yields 0% / not complete. Pure. */
export function goalProgress(goal: SavingsGoal): GoalProgress {
  const target = goal.target_minor;
  const saved = goal.saved_minor < 0n ? 0n : goal.saved_minor;
  if (target <= 0n) {
    return { pct: 0, rawPct: 0, remaining_minor: 0n, complete: false };
  }
  const rawPct = (Number(saved) / Number(target)) * 100;
  const remaining = target - saved;
  return {
    pct: Math.max(0, Math.min(100, rawPct)),
    rawPct,
    remaining_minor: remaining < 0n ? 0n : remaining,
    complete: saved >= target
  };
}

/** Totals across goals (for a header). */
export function goalsTotals(goals: readonly SavingsGoal[]): {
  target_minor: bigint;
  saved_minor: bigint;
  remaining_minor: bigint;
} {
  let target = 0n;
  let saved = 0n;
  for (const g of goals) {
    target += g.target_minor;
    saved += g.saved_minor < 0n ? 0n : g.saved_minor;
  }
  const remaining = target - saved;
  return {
    target_minor: target,
    saved_minor: saved,
    remaining_minor: remaining < 0n ? 0n : remaining
  };
}

/** Validate + normalize new-goal input; throws SavingsGoalError with context. */
export function makeGoal(
  input: { name: string; target_minor: bigint; saved_minor?: bigint; deadline?: string },
  id: string
): SavingsGoal {
  if (id.trim() === '') throw new SavingsGoalError('savings goal: id must be non-empty');
  const name = input.name.trim();
  if (name === '') throw new SavingsGoalError('savings goal: name must be non-empty');
  if (typeof input.target_minor !== 'bigint' || input.target_minor <= 0n) {
    throw new SavingsGoalError('savings goal: target must be a positive amount');
  }
  const saved = input.saved_minor ?? 0n;
  if (typeof saved !== 'bigint' || saved < 0n) {
    throw new SavingsGoalError('savings goal: saved amount must be ≥ 0');
  }
  if (input.deadline !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
    throw new SavingsGoalError('savings goal: deadline must be ISO YYYY-MM-DD');
  }
  const goal: SavingsGoal = { id, name, target_minor: input.target_minor, saved_minor: saved };
  if (input.deadline !== undefined) goal.deadline = input.deadline;
  return goal;
}
