/**
 * Budget-window money summary (US-P2-D, final increment): for each anchored
 * budget window (from budget-window.ts), how much came in vs went out, and
 * what's left. Pure bigint money math (Principle II); no I/O.
 *
 * Spending model (avoids double-counting credit cards): we count OUTFLOWS FROM
 * THE FUNDING ACCOUNTS (checking/savings) within the window's date range — i.e.
 * money that actually left the bank, which includes the credit-card PAYMENT but
 * NOT the individual card purchases (those are drill-down detail, reconciled
 * separately, and counting both would double-count). Income is the window's
 * paychecks. `remaining = income − spending`.
 *
 * v1 scope: transfers to own savings are still counted as outflow (US-P3-D
 * transfer-linking is deferred); single home currency assumed (US-P3-F deferred).
 */
import type { BudgetWindow } from './budget-window';

/** A bank-account transaction reduced to what the summary needs. */
export interface BankTxn {
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // signed; < 0 = money out of the bank
}

export interface BudgetSummary {
  window: BudgetWindow;
  /** Sum of the window's paychecks (positive). */
  income_minor: bigint;
  /** Sum of bank outflows within the window's date range (positive magnitude). */
  spending_minor: bigint;
  /** income − spending. Can be negative (overspent). */
  remaining_minor: bigint;
}

/** Inclusive ISO-date range test. `end === null` means open-ended (final window). */
function inWindow(date: string, start: string, end: string | null): boolean {
  if (date < start) return false;
  return end === null || date <= end;
}

/**
 * Compute income / spending / remaining for each budget window.
 * @param windows  Anchored windows from `groupIntoBudgetWindows`.
 * @param bankTxns Transactions from checking/savings accounts (caller filters).
 */
export function computeBudgetSummaries(
  windows: BudgetWindow[],
  bankTxns: readonly BankTxn[]
): BudgetSummary[] {
  return windows.map((window) => {
    let income = 0n;
    for (const p of window.paychecks) income += p.amount_minor;

    let spending = 0n;
    for (const t of bankTxns) {
      if (t.amount_minor < 0n && inWindow(t.posted_date, window.start_date, window.end_date)) {
        spending += -t.amount_minor;
      }
    }
    return {
      window,
      income_minor: income,
      spending_minor: spending,
      remaining_minor: income - spending
    };
  });
}
