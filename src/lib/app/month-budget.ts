/**
 * Month budget summary for the Home "this month" hero — pure, integer money.
 *
 * Given this month's cash flow (inflow/outflow magnitudes) and a reference date,
 * it derives income / spent / remaining, the calendar days left, a SAFE DAILY
 * PACE ("how much can I spend per remaining day"), and whether spending is ahead
 * of an even pace. Money is bigint minor units throughout (Principle II); the
 * percentage is a DISPLAY Number only, never used for money math. Income vs spent
 * come from transaction direction only — never from amount (no amount-based
 * classification).
 */
export interface MonthBudget {
  /** Inflows this month (positive). */
  income_minor: bigint;
  /** Outflow magnitude this month (positive). */
  spent_minor: bigint;
  /** income − spent (signed; negative ⇒ overspent). */
  remaining_minor: bigint;
  /** Display-only spent/income × 100, rounded to a whole percent; 0 when income is 0. */
  pct_spent: number;
  /** Whole calendar days remaining AFTER today (0 on the last day of the month). */
  days_left: number;
  /** Safe-to-spend per remaining day, including today: max(0, remaining) / (days_left + 1). */
  daily_pace_minor: bigint;
  /** True when, at the rate spent so far, the month is projected to overspend income. */
  over_pace: boolean;
}

/** Last calendar day (28–31) of a `YYYY-MM` month, leap-year aware. */
export function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  // Day 0 of the NEXT month (1-indexed m) is the last day of month m.
  return new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
}

export function monthBudget(
  flow: { inflow_minor: bigint; outflow_minor: bigint } | undefined,
  monthKey: string,
  today: string
): MonthBudget {
  const income = flow?.inflow_minor ?? 0n;
  const spent = flow?.outflow_minor ?? 0n;
  const remaining = income - spent;

  const lastDay = daysInMonth(monthKey);
  // Day-of-month from `today` when it falls in this month; a past month counts
  // as fully elapsed (0 days left), a future month as not started.
  const todayMonth = today.slice(0, 7);
  let todayDay: number;
  if (todayMonth === monthKey) todayDay = Number(today.slice(8, 10));
  else if (todayMonth > monthKey)
    todayDay = lastDay; // month already over
  else todayDay = 0; // month hasn't started

  const daysLeft = Math.max(0, lastDay - todayDay);
  const divisor = BigInt(daysLeft + 1); // include today ⇒ never divide by zero
  const pace = remaining > 0n ? remaining / divisor : 0n;

  const pctSpent = income > 0n ? Math.round(Number((spent * 1000n) / income) / 10) : 0;

  // Even-pace check via cross-multiplication (stays in bigint, no floats):
  // projected = spent * lastDay / elapsed > income  ⇔  spent*lastDay > income*elapsed.
  const elapsed = BigInt(Math.max(1, todayDay));
  const overPace = income > 0n && spent * BigInt(lastDay) > income * elapsed;

  return {
    income_minor: income,
    spent_minor: spent,
    remaining_minor: remaining,
    pct_spent: pctSpent,
    days_left: daysLeft,
    daily_pace_minor: pace,
    over_pace: overPace
  };
}
