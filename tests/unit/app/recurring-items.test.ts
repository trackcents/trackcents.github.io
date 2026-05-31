/**
 * Recurring bills + subscriptions — pure logic (spec 002-income-pockets §7.5–§7.10).
 * Cadence date math, status derivation, partial/installment payments, and
 * section totals. Money is bigint cents; dates are injected (never reads a clock).
 */
import { describe, expect, test } from 'vitest';
import {
  advanceDueDate,
  applyPayment,
  cadenceLabel,
  deriveStatus,
  markUnpaid,
  nextDueDate,
  paidThisCycleMinor,
  remainingMinor,
  sectionTotals,
  startNextCycle,
  type RecurringItem
} from '../../../src/lib/app/recurring-items';

function item(over: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: over.id ?? 'i1',
    kind: over.kind ?? 'bill',
    name: over.name ?? 'Car EMI',
    amount_minor: over.amount_minor ?? 1250_00n,
    paid_from: over.paid_from ?? 'paychecks',
    cadence: over.cadence ?? 'monthly',
    due_date: over.due_date ?? '2026-06-14',
    paid_minor: over.paid_minor ?? 0n,
    paid_date: over.paid_date ?? null,
    order: over.order ?? 0,
    ...(over.logo !== undefined ? { logo: over.logo } : {}),
    ...(over.archived !== undefined ? { archived: over.archived } : {})
  };
}

describe('deriveStatus', () => {
  const today = '2026-06-10';
  test('unpaid + future due → due', () => {
    expect(deriveStatus(item({ due_date: '2026-06-14' }), today)).toBe('due');
  });
  test('unpaid + past due → overdue', () => {
    expect(deriveStatus(item({ due_date: '2026-06-01' }), today)).toBe('overdue');
  });
  test('part-paid → partial (even if overdue)', () => {
    expect(deriveStatus(item({ paid_minor: 500_00n, due_date: '2026-06-01' }), today)).toBe(
      'partial'
    );
  });
  test('fully paid → paid', () => {
    expect(deriveStatus(item({ paid_minor: 1250_00n }), today)).toBe('paid');
  });
  test('overpaid still → paid', () => {
    expect(deriveStatus(item({ paid_minor: 1300_00n }), today)).toBe('paid');
  });
});

describe('remaining / paid-this-cycle (overpay clamps)', () => {
  test('remaining floors at 0 when overpaid', () => {
    expect(remainingMinor(item({ amount_minor: 1000_00n, paid_minor: 1200_00n }))).toBe(0n);
  });
  test('paid-this-cycle caps at the amount', () => {
    expect(paidThisCycleMinor(item({ amount_minor: 1000_00n, paid_minor: 1200_00n }))).toBe(
      1000_00n
    );
  });
  test('partial: remaining = amount − paid', () => {
    expect(remainingMinor(item({ amount_minor: 1500_00n, paid_minor: 500_00n }))).toBe(1000_00n);
  });
});

describe('sectionTotals — due = paid + left (conserved), skips archived', () => {
  const items = [
    item({ id: 'a', amount_minor: 1250_00n, paid_minor: 0n }),
    item({ id: 'b', amount_minor: 2200_00n, paid_minor: 2200_00n }),
    item({ id: 'c', amount_minor: 1500_00n, paid_minor: 500_00n }),
    item({ id: 'd', amount_minor: 999_00n, archived: true })
  ];
  test('totals', () => {
    const t = sectionTotals(items);
    expect(t.dueMinor).toBe(1250_00n + 2200_00n + 1500_00n); // archived excluded
    expect(t.paidMinor).toBe(2200_00n + 500_00n);
    expect(t.leftMinor).toBe(1250_00n + 1000_00n);
  });
  test('CONSERVATION: due === paid + left', () => {
    const t = sectionTotals(items);
    expect(t.dueMinor).toBe(t.paidMinor + t.leftMinor);
  });
});

describe('applyPayment — full, partial, edited total, negative floored', () => {
  test('full payment marks paid + records date/pocket', () => {
    const paid = applyPayment(item(), {
      totalMinor: 1250_00n,
      payingNowMinor: 1250_00n,
      paidFrom: 'extra',
      paidOn: '2026-06-12'
    });
    expect(paid.paid_minor).toBe(1250_00n);
    expect(paid.paid_date).toBe('2026-06-12');
    expect(paid.paid_from).toBe('extra');
    expect(deriveStatus(paid, '2026-06-12')).toBe('paid');
  });

  test('partial then the remainder accumulates to fully paid', () => {
    const half = applyPayment(item({ amount_minor: 1500_00n }), {
      totalMinor: 1500_00n,
      payingNowMinor: 500_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-03'
    });
    expect(remainingMinor(half)).toBe(1000_00n);
    expect(deriveStatus(half, '2026-06-03')).toBe('partial');
    const rest = applyPayment(half, {
      totalMinor: 1500_00n,
      payingNowMinor: 1000_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-20'
    });
    expect(remainingMinor(rest)).toBe(0n);
    expect(deriveStatus(rest, '2026-06-20')).toBe('paid');
  });

  test('editing the total at pay time changes the cycle amount', () => {
    const paid = applyPayment(item({ amount_minor: 1250_00n }), {
      totalMinor: 1300_00n, // EMI went up
      payingNowMinor: 1300_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-12'
    });
    expect(paid.amount_minor).toBe(1300_00n);
    expect(deriveStatus(paid, '2026-06-12')).toBe('paid');
  });

  test('negative payingNow is floored to 0 (cannot un-pay by paying negative)', () => {
    const r = applyPayment(item({ paid_minor: 500_00n }), {
      totalMinor: 1250_00n,
      payingNowMinor: -100_00n,
      paidFrom: 'paychecks',
      paidOn: '2026-06-12'
    });
    expect(r.paid_minor).toBe(500_00n);
  });
});

describe('markUnpaid', () => {
  test('resets paid figures', () => {
    const r = markUnpaid(item({ paid_minor: 1250_00n, paid_date: '2026-06-12' }));
    expect(r.paid_minor).toBe(0n);
    expect(r.paid_date).toBeNull();
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

describe('startNextCycle / nextDueDate', () => {
  test('recurring: advances due date + resets paid', () => {
    const rolled = startNextCycle(
      item({ cadence: 'monthly', paid_minor: 1250_00n, paid_date: '2026-06-12' })
    );
    expect(rolled.due_date).toBe('2026-07-14');
    expect(rolled.paid_minor).toBe(0n);
    expect(rolled.paid_date).toBeNull();
  });
  test('once: unchanged (no next cycle)', () => {
    const r = startNextCycle(item({ cadence: 'once', paid_minor: 100n }));
    expect(r.due_date).toBe('2026-06-14');
    expect(r.paid_minor).toBe(100n);
  });
  test('nextDueDate is null for one-time, a date for recurring', () => {
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
