/**
 * Recurring bills + subscriptions — pure logic (spec 002-income-pockets §7.5–§7.10).
 * MONTH-AWARE model: cadence date math, per-month status, partial/installment
 * payments recorded in a history, and per-month section totals. Money is bigint
 * cents; dates are injected (never reads a clock).
 */
import { describe, expect, test } from 'vitest';
import {
  advanceDueDate,
  applyPayment,
  cadenceLabel,
  DEFAULT_SECTIONS,
  defaultSectionForKind,
  dueDateInMonth,
  findSection,
  isActiveInMonth,
  latestPaymentInMonth,
  monthOf,
  nextDueDate,
  paidCappedInMonth,
  paidInMonth,
  remainingInMonth,
  SECTION_BILLS,
  SECTION_SUBSCRIPTIONS,
  sectionTotalsForMonth,
  statusInMonth,
  unpayMonth,
  type PaymentRecord,
  type RecurringItem
} from '../../../src/lib/app/recurring-items';

function item(over: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: over.id ?? 'i1',
    section_id: over.section_id ?? 'bills',
    name: over.name ?? 'Car EMI',
    amount_minor: over.amount_minor ?? 1250_00n,
    paid_from: over.paid_from ?? 'paychecks',
    cadence: over.cadence ?? 'monthly',
    due_date: over.due_date ?? '2026-06-14',
    payments: over.payments ?? [],
    order: over.order ?? 0,
    ...(over.logo !== undefined ? { logo: over.logo } : {}),
    ...(over.archived !== undefined ? { archived: over.archived } : {})
  };
}
function pay(
  month: string,
  amount: bigint,
  paid_date = `${month}-10`,
  paid_from = 'paychecks'
): PaymentRecord {
  return { month, amount_minor: amount, paid_date, paid_from };
}

describe('isActiveInMonth', () => {
  test('monthly is active every month from its start, never before', () => {
    const it = item({ cadence: 'monthly', due_date: '2026-03-14' });
    expect(isActiveInMonth(it, '2026-02')).toBe(false); // before start
    expect(isActiveInMonth(it, '2026-03')).toBe(true);
    expect(isActiveInMonth(it, '2026-04')).toBe(true);
    expect(isActiveInMonth(it, '2027-01')).toBe(true);
  });
  test('one-time is active ONLY in its own month', () => {
    const it = item({ cadence: 'once', due_date: '2026-03-14' });
    expect(isActiveInMonth(it, '2026-02')).toBe(false);
    expect(isActiveInMonth(it, '2026-03')).toBe(true);
    expect(isActiveInMonth(it, '2026-04')).toBe(false);
  });
  test('every-3-months lands on the cadence grid only', () => {
    const it = item({ cadence: 'every_3_months', due_date: '2026-01-15' });
    expect(isActiveInMonth(it, '2026-01')).toBe(true);
    expect(isActiveInMonth(it, '2026-02')).toBe(false);
    expect(isActiveInMonth(it, '2026-04')).toBe(true);
    expect(isActiveInMonth(it, '2026-07')).toBe(true);
  });
  test('yearly recurs only in the anchor month', () => {
    const it = item({ cadence: 'yearly', due_date: '2026-02-28' });
    expect(isActiveInMonth(it, '2026-02')).toBe(true);
    expect(isActiveInMonth(it, '2026-08')).toBe(false);
    expect(isActiveInMonth(it, '2027-02')).toBe(true);
  });
  test('custom months grid; custom weeks treated as every month', () => {
    expect(
      isActiveInMonth(
        item({ cadence: { every: 2, unit: 'months' }, due_date: '2026-01-10' }),
        '2026-03'
      )
    ).toBe(true);
    expect(
      isActiveInMonth(
        item({ cadence: { every: 2, unit: 'months' }, due_date: '2026-01-10' }),
        '2026-02'
      )
    ).toBe(false);
    expect(
      isActiveInMonth(
        item({ cadence: { every: 2, unit: 'weeks' }, due_date: '2026-01-10' }),
        '2026-05'
      )
    ).toBe(true);
  });
});

describe('dueDateInMonth — anchor day, clamped to month length', () => {
  test('same day in the target month', () => {
    expect(dueDateInMonth(item({ due_date: '2026-06-14' }), '2026-09')).toBe('2026-09-14');
  });
  test('day 31 clamps to Feb 28 (2026)', () => {
    expect(dueDateInMonth(item({ due_date: '2026-01-31' }), '2026-02')).toBe('2026-02-28');
  });
  test('day 31 clamps to Feb 29 (2028 leap)', () => {
    expect(dueDateInMonth(item({ due_date: '2026-01-31' }), '2028-02')).toBe('2028-02-29');
  });
});

describe('paid / remaining / status per month', () => {
  const it = item({
    amount_minor: 1000_00n,
    due_date: '2026-04-05',
    payments: [pay('2026-04', 1000_00n), pay('2026-05', 400_00n)]
  });
  test('paidInMonth only sums that month', () => {
    expect(paidInMonth(it, '2026-04')).toBe(1000_00n);
    expect(paidInMonth(it, '2026-05')).toBe(400_00n);
    expect(paidInMonth(it, '2026-06')).toBe(0n);
  });
  test('remaining floors at 0, caps work', () => {
    expect(remainingInMonth(it, '2026-04')).toBe(0n);
    expect(remainingInMonth(it, '2026-05')).toBe(600_00n);
    expect(remainingInMonth(it, '2026-06')).toBe(1000_00n);
  });
  test('overpay: capped paid never exceeds the amount', () => {
    const over = item({ amount_minor: 1000_00n, payments: [pay('2026-04', 1200_00n)] });
    expect(paidInMonth(over, '2026-04')).toBe(1200_00n);
    expect(paidCappedInMonth(over, '2026-04')).toBe(1000_00n);
    expect(remainingInMonth(over, '2026-04')).toBe(0n);
  });
  test('status: paid in April, partial in May, due/overdue in June', () => {
    expect(statusInMonth(it, '2026-04', '2026-06-01')).toBe('paid');
    expect(statusInMonth(it, '2026-05', '2026-06-01')).toBe('partial');
    // June unpaid: due date 06-05; before it → due, after it → overdue.
    expect(statusInMonth(it, '2026-06', '2026-06-01')).toBe('due');
    expect(statusInMonth(it, '2026-06', '2026-06-30')).toBe('overdue');
  });
  test('latestPaymentInMonth returns the right record', () => {
    expect(latestPaymentInMonth(it, '2026-05')?.amount_minor).toBe(400_00n);
    expect(latestPaymentInMonth(it, '2026-06')).toBeNull();
  });
});

describe('sectionTotalsForMonth — conserved, only active + non-archived', () => {
  const month = '2026-06';
  const items = [
    item({ id: 'a', amount_minor: 1250_00n }), // active, unpaid
    item({ id: 'b', amount_minor: 2200_00n, payments: [pay('2026-06', 2200_00n)] }), // paid
    item({ id: 'c', amount_minor: 1500_00n, payments: [pay('2026-06', 500_00n)] }), // partial
    item({ id: 'd', amount_minor: 999_00n, archived: true }), // excluded
    item({ id: 'e', amount_minor: 800_00n, cadence: 'once', due_date: '2026-05-01' }) // not active in June
  ];
  test('totals only count active, non-archived items', () => {
    const t = sectionTotalsForMonth(items, month);
    expect(t.dueMinor).toBe(1250_00n + 2200_00n + 1500_00n);
    expect(t.paidMinor).toBe(2200_00n + 500_00n);
    expect(t.leftMinor).toBe(1250_00n + 1000_00n);
  });
  test('CONSERVATION: due === paid + left', () => {
    const t = sectionTotalsForMonth(items, month);
    expect(t.dueMinor).toBe(t.paidMinor + t.leftMinor);
  });
});

describe('applyPayment — records a payment toward a month (does NOT touch the amount)', () => {
  test('full payment appends a record and marks the month paid', () => {
    const it = item({ amount_minor: 1250_00n });
    const paid = applyPayment(it, {
      month: '2026-06',
      payingNowMinor: 1250_00n,
      paidFrom: 'extra',
      paidOn: '2026-06-12'
    });
    expect(paid.amount_minor).toBe(1250_00n); // unchanged — editing the bill is separate
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toEqual({
      month: '2026-06',
      amount_minor: 1250_00n,
      paid_date: '2026-06-12',
      paid_from: 'extra'
    });
    expect(paid.paid_from).toBe('extra');
    expect(statusInMonth(paid, '2026-06', '2026-06-12')).toBe('paid');
  });

  test('partial then the remainder accumulates to fully paid for the month', () => {
    const half = applyPayment(item({ amount_minor: 1500_00n }), {
      month: '2026-06',
      payingNowMinor: 500_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-03'
    });
    expect(remainingInMonth(half, '2026-06')).toBe(1000_00n);
    expect(statusInMonth(half, '2026-06', '2026-06-03')).toBe('partial');
    const rest = applyPayment(half, {
      month: '2026-06',
      payingNowMinor: 1000_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-20'
    });
    expect(remainingInMonth(rest, '2026-06')).toBe(0n);
    expect(statusInMonth(rest, '2026-06', '2026-06-20')).toBe('paid');
    expect(rest.payments).toHaveLength(2);
  });

  test('a payment for one month leaves another month untouched', () => {
    const it = item({ amount_minor: 1000_00n, payments: [pay('2026-05', 1000_00n)] });
    const paid = applyPayment(it, {
      month: '2026-06',
      payingNowMinor: 1000_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-10'
    });
    expect(paidInMonth(paid, '2026-05')).toBe(1000_00n);
    expect(paidInMonth(paid, '2026-06')).toBe(1000_00n);
  });

  test('non-positive payingNow records nothing (cannot un-pay by paying ≤ 0)', () => {
    const it = item({ payments: [pay('2026-06', 500_00n)] });
    const zero = applyPayment(it, {
      month: '2026-06',
      payingNowMinor: 0n,
      paidFrom: 'x',
      paidOn: '2026-06-12'
    });
    const neg = applyPayment(it, {
      month: '2026-06',
      payingNowMinor: -100_00n,
      paidFrom: 'x',
      paidOn: '2026-06-12'
    });
    expect(zero.payments).toHaveLength(1);
    expect(neg.payments).toHaveLength(1);
    expect(paidInMonth(neg, '2026-06')).toBe(500_00n);
  });
});

describe('unpayMonth', () => {
  test('removes only the target month, keeps the others', () => {
    const it = item({
      payments: [pay('2026-05', 500_00n), pay('2026-06', 700_00n), pay('2026-06', 300_00n)]
    });
    const r = unpayMonth(it, '2026-06');
    expect(paidInMonth(r, '2026-06')).toBe(0n);
    expect(paidInMonth(r, '2026-05')).toBe(500_00n);
    expect(r.payments).toHaveLength(1);
  });
});

describe('monthOf', () => {
  test('slices the month key', () => {
    expect(monthOf('2026-06-14')).toBe('2026-06');
  });
});

describe('sections (user-owned grouping)', () => {
  test('two built-in sections ship by default and are non-deletable', () => {
    expect(DEFAULT_SECTIONS.map((s) => s.id)).toEqual([SECTION_BILLS, SECTION_SUBSCRIPTIONS]);
    for (const s of DEFAULT_SECTIONS) expect(s.builtin).toBe(true);
  });
  test('defaultSectionForKind maps a detected kind to a built-in section', () => {
    expect(defaultSectionForKind('bill')).toBe(SECTION_BILLS);
    expect(defaultSectionForKind('subscription')).toBe(SECTION_SUBSCRIPTIONS);
  });
  test('findSection returns the section or null', () => {
    const custom = [...DEFAULT_SECTIONS, { id: 'loans', name: 'Loans', icon: '🚗', order: 2 }];
    expect(findSection(custom, 'loans')?.name).toBe('Loans');
    expect(findSection(custom, SECTION_BILLS)?.builtin).toBe(true);
    expect(findSection(custom, 'nope')).toBeNull();
  });
  test('an item can live in a custom section; totals + activity are section-agnostic', () => {
    const it = item({ section_id: 'loans', amount_minor: 736_00n, due_date: '2026-06-11' });
    expect(isActiveInMonth(it, '2026-06')).toBe(true);
    expect(sectionTotalsForMonth([it], '2026-06').dueMinor).toBe(736_00n);
  });
});

describe('advanceDueDate — cadence math with month-end clamp', () => {
  test('monthly', () => {
    expect(advanceDueDate('2026-06-14', 'monthly')).toBe('2026-07-14');
  });
  test('every 3 / 6 months', () => {
    expect(advanceDueDate('2026-01-15', 'every_3_months')).toBe('2026-04-15');
    expect(advanceDueDate('2026-01-15', 'every_6_months')).toBe('2026-07-15');
  });
  test('yearly', () => {
    expect(advanceDueDate('2026-02-28', 'yearly')).toBe('2027-02-28');
  });
  test('month-end clamps (Jan 31 +1mo → Feb 28 in 2026)', () => {
    expect(advanceDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
  });
  test('leap year (Jan 31 +1mo → Feb 29 in 2028)', () => {
    expect(advanceDueDate('2028-01-31', 'monthly')).toBe('2028-02-29');
  });
  test('custom every 2 weeks (biweekly)', () => {
    expect(advanceDueDate('2026-06-14', { every: 2, unit: 'weeks' })).toBe('2026-06-28');
  });
  test('custom every 45 days crosses month boundary', () => {
    expect(advanceDueDate('2026-06-01', { every: 45, unit: 'days' })).toBe('2026-07-16');
  });
  test('custom every 18 months', () => {
    expect(advanceDueDate('2026-06-14', { every: 18, unit: 'months' })).toBe('2027-12-14');
  });
  test('once → unchanged', () => {
    expect(advanceDueDate('2026-06-14', 'once')).toBe('2026-06-14');
  });
});

describe('nextDueDate', () => {
  test('null for one-time, a date for recurring', () => {
    expect(nextDueDate(item({ cadence: 'once' }))).toBeNull();
    expect(nextDueDate(item({ cadence: 'monthly', due_date: '2026-06-14' }))).toBe('2026-07-14');
  });
});

describe('cadenceLabel', () => {
  test('presets + custom singular/plural', () => {
    expect(cadenceLabel('once')).toBe('One-time');
    expect(cadenceLabel('monthly')).toBe('Monthly');
    expect(cadenceLabel('yearly')).toBe('Yearly');
    expect(cadenceLabel({ every: 2, unit: 'weeks' })).toBe('Every 2 weeks');
    expect(cadenceLabel({ every: 1, unit: 'months' })).toBe('Every 1 month');
  });
});
