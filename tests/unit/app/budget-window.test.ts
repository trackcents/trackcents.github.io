// Tests for the budget-month grouper (US-P2-D, increment 2).
//
// The grouper is pure structure: it pairs chronologically-ordered paychecks
// into anchored budget months.  It never touches amounts and never guesses
// the calendar month from dates — the anchor alone decides labels.
//
// Layers exercised here:
//   - Example tests (the obvious shapes: 0,1,2,3,4,5 paychecks)
//   - Anchor-offset + year-rollover (the user's real "May funds June" case)
//   - Input-guard tests (bad anchor throws — no silent mislabeling)
//   - Property tests (invariants over random paycheck series + anchors)
//   - Metamorphic tests (date-shift, amount-scale, anchor-shift relationships)
//   - Integration (detector output → grouper)

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  groupIntoBudgetWindows,
  type BudgetAnchor,
  type BudgetWindow
} from '../../../src/lib/app/budget-window';
import { detectPaychecks, type Paycheck } from '../../../src/lib/app/paycheck-detector';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';

// ── Fixture builders ─────────────────────────────────────────────────────────

function mkPaycheck(date: string, amount: number, txIdx = 0): Paycheck {
  return {
    posted_date: date,
    amount_minor: BigInt(Math.round(amount * 100)),
    description: 'PAYROLL ACME',
    import_index: 0,
    transaction_index: txIdx,
    confidence: 'high',
    stream_key: 'PAYROLL ACME'
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

/** A biweekly paycheck series of `count` deposits, 14 days apart. */
function biweeklySeries(start: string, count: number, amount = 3200): Paycheck[] {
  const out: Paycheck[] = [];
  for (let i = 0; i < count; i++) {
    out.push(mkPaycheck(addDays(start, i * 14), amount, i));
  }
  return out;
}

/** Absolute month index for "YYYY-MM" comparison: year*12 + (month-1). */
function absMonth(budgetMonth: string): number {
  const [y, m] = budgetMonth.split('-').map((s) => parseInt(s, 10));
  return y! * 12 + (m! - 1);
}

const ANCHOR: BudgetAnchor = { year: 2026, month: 6 }; // June 2026

// ── Example tests ──────────────────────────────────────────────────────────────

describe('groupIntoBudgetWindows — basic shapes', () => {
  test('no paychecks → no windows', () => {
    expect(groupIntoBudgetWindows([], ANCHOR)).toEqual([]);
  });

  test('one paycheck → one in-progress, incomplete window', () => {
    const w = groupIntoBudgetWindows([mkPaycheck('2026-05-23', 3200, 0)], ANCHOR);
    expect(w).toHaveLength(1);
    expect(w[0]!.paychecks).toHaveLength(1);
    expect(w[0]!.complete).toBe(false);
    expect(w[0]!.start_date).toBe('2026-05-23');
    expect(w[0]!.end_date).toBeNull(); // last window stays open
    expect(w[0]!.budget_month).toBe('2026-06');
  });

  test('two paychecks → one complete window, still open (no next window known)', () => {
    const w = groupIntoBudgetWindows(biweeklySeries('2026-05-23', 2), ANCHOR);
    expect(w).toHaveLength(1);
    expect(w[0]!.paychecks).toHaveLength(2);
    expect(w[0]!.complete).toBe(true);
    expect(w[0]!.end_date).toBeNull();
  });

  test('three paychecks → first window complete & closed, third opens an incomplete window', () => {
    const series = biweeklySeries('2026-05-23', 3); // 05-23, 06-06, 06-20
    const w = groupIntoBudgetWindows(series, ANCHOR);
    expect(w).toHaveLength(2);

    expect(w[0]!.paychecks).toHaveLength(2);
    expect(w[0]!.complete).toBe(true);
    expect(w[0]!.start_date).toBe('2026-05-23');
    // closes the day BEFORE the next window (which opens on the 3rd paycheck, 06-20)
    expect(w[0]!.end_date).toBe('2026-06-19');
    expect(w[0]!.budget_month).toBe('2026-06');

    expect(w[1]!.paychecks).toHaveLength(1);
    expect(w[1]!.complete).toBe(false);
    expect(w[1]!.start_date).toBe('2026-06-20');
    expect(w[1]!.end_date).toBeNull();
    expect(w[1]!.budget_month).toBe('2026-07'); // label advances one calendar month
  });

  test('four paychecks → two complete windows', () => {
    const w = groupIntoBudgetWindows(biweeklySeries('2026-05-23', 4), ANCHOR);
    expect(w).toHaveLength(2);
    expect(w.every((win) => win.complete)).toBe(true);
    expect(w.map((win) => win.budget_month)).toEqual(['2026-06', '2026-07']);
    expect(w[0]!.end_date).toBe(addDays(w[1]!.start_date, -1));
    expect(w[1]!.end_date).toBeNull();
  });

  test('five paychecks → two complete + one trailing incomplete', () => {
    const w = groupIntoBudgetWindows(biweeklySeries('2026-05-23', 5), ANCHOR);
    expect(w).toHaveLength(3);
    expect(w[0]!.complete).toBe(true);
    expect(w[1]!.complete).toBe(true);
    expect(w[2]!.complete).toBe(false);
    expect(w.map((win) => win.budget_month)).toEqual(['2026-06', '2026-07', '2026-08']);
  });
});

describe('groupIntoBudgetWindows — anchoring captures the user forward-offset', () => {
  test("a paycheck dated in MAY can fund the JUNE budget month (Hemanth's real case)", () => {
    // Paycheck posted_date is in May; the anchor says it funds June.  The
    // window keeps the real posted_date but labels the budget month June.
    const w = groupIntoBudgetWindows([mkPaycheck('2026-05-23', 3200)], { year: 2026, month: 6 });
    expect(w[0]!.start_date).toBe('2026-05-23');
    expect(w[0]!.budget_month).toBe('2026-06');
  });

  test('budget-month labels roll over the year boundary', () => {
    const w = groupIntoBudgetWindows(biweeklySeries('2026-12-04', 6), { year: 2026, month: 12 });
    expect(w.map((win) => win.budget_month)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  test('indices are sequential from zero', () => {
    const w = groupIntoBudgetWindows(biweeklySeries('2026-05-23', 6), ANCHOR);
    expect(w.map((win) => win.index)).toEqual([0, 1, 2]);
  });

  test('two paychecks sharing the same posted_date still group cleanly', () => {
    // e.g. a split direct deposit landing twice on one day.
    const w = groupIntoBudgetWindows(
      [mkPaycheck('2026-05-23', 1600, 0), mkPaycheck('2026-05-23', 1600, 1)],
      ANCHOR
    );
    expect(w).toHaveLength(1);
    expect(w[0]!.paychecks).toHaveLength(2);
    expect(w[0]!.complete).toBe(true);
    expect(w[0]!.start_date).toBe('2026-05-23');
  });

  test('caller order is not trusted — unsorted paychecks are grouped chronologically', () => {
    const sortedSeries = biweeklySeries('2026-05-23', 4);
    const shuffled = [sortedSeries[2]!, sortedSeries[0]!, sortedSeries[3]!, sortedSeries[1]!];
    const w = groupIntoBudgetWindows(shuffled, ANCHOR);
    expect(w[0]!.start_date).toBe('2026-05-23');
    expect(w[0]!.paychecks[0]!.posted_date).toBe('2026-05-23');
    expect(w[0]!.paychecks[1]!.posted_date).toBe('2026-06-06');
    expect(w[1]!.paychecks[0]!.posted_date).toBe('2026-06-20');
  });
});

// ── Input guards (no silent mislabeling) ─────────────────────────────────────

describe('groupIntoBudgetWindows — rejects a bad anchor loudly', () => {
  test.each([0, 13, -1, 6.5, NaN])('month %p throws', (month) => {
    expect(() =>
      groupIntoBudgetWindows(biweeklySeries('2026-05-23', 2), { year: 2026, month })
    ).toThrow(/anchor\.month/);
  });

  test.each([1969, 10000, 2026.5, NaN])('year %p throws', (year) => {
    expect(() =>
      groupIntoBudgetWindows(biweeklySeries('2026-05-23', 2), { year, month: 6 })
    ).toThrow(/anchor\.year/);
  });

  test('an empty paycheck list with a bad anchor still throws (guard runs first)', () => {
    expect(() => groupIntoBudgetWindows([], { year: 2026, month: 0 })).toThrow(/anchor\.month/);
  });
});

// ── Property tests ────────────────────────────────────────────────────────────

const arbPaychecks = fc
  .tuple(
    fc.integer({ min: 0, max: 20 }),
    fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 20, maxLength: 20 })
  )
  .map(([count, gaps]) => {
    const out: Paycheck[] = [];
    let date = '2026-01-01';
    for (let i = 0; i < count; i++) {
      if (i > 0) date = addDays(date, gaps[i - 1]!);
      out.push(mkPaycheck(date, 3000 + i, i));
    }
    return out;
  });

const arbAnchor = fc.record({
  year: fc.integer({ min: 2000, max: 2100 }),
  month: fc.integer({ min: 1, max: 12 })
});

describe('groupIntoBudgetWindows — properties', () => {
  test('I1: window count is ceil(n / 2)', () => {
    fc.assert(
      fc.property(arbPaychecks, arbAnchor, (pcs, anchor) => {
        const w = groupIntoBudgetWindows(pcs, anchor);
        expect(w.length).toBe(Math.ceil(pcs.length / 2));
      })
    );
  });

  test('I2: every paycheck is placed in exactly one window (no loss, no duplication)', () => {
    fc.assert(
      fc.property(arbPaychecks, arbAnchor, (pcs, anchor) => {
        const w = groupIntoBudgetWindows(pcs, anchor);
        const placed = w.reduce((sum, win) => sum + win.paychecks.length, 0);
        expect(placed).toBe(pcs.length);
      })
    );
  });

  test('I3: windows are contiguous and non-overlapping — each closes the day before the next opens', () => {
    fc.assert(
      fc.property(arbPaychecks, arbAnchor, (pcs, anchor) => {
        const w = groupIntoBudgetWindows(pcs, anchor);
        for (let i = 0; i < w.length - 1; i++) {
          expect(w[i]!.end_date).not.toBeNull();
          expect(daysBetween(w[i]!.end_date!, w[i + 1]!.start_date)).toBe(1);
        }
      })
    );
  });

  test('I4: exactly the LAST window is open (end_date null); all earlier windows are closed', () => {
    fc.assert(
      fc.property(arbPaychecks, arbAnchor, (pcs, anchor) => {
        const w = groupIntoBudgetWindows(pcs, anchor);
        if (w.length === 0) return;
        expect(w[w.length - 1]!.end_date).toBeNull();
        for (let i = 0; i < w.length - 1; i++) {
          expect(w[i]!.end_date).not.toBeNull();
        }
      })
    );
  });

  test('I5: only the last window may be incomplete; all earlier ones have 2 paychecks', () => {
    fc.assert(
      fc.property(arbPaychecks, arbAnchor, (pcs, anchor) => {
        const w = groupIntoBudgetWindows(pcs, anchor);
        for (let i = 0; i < w.length - 1; i++) {
          expect(w[i]!.complete).toBe(true);
          expect(w[i]!.paychecks.length).toBe(2);
        }
        if (w.length > 0) {
          expect(w[w.length - 1]!.complete).toBe(pcs.length % 2 === 0);
        }
      })
    );
  });

  test('I6: budget-month labels advance by exactly one calendar month per window', () => {
    fc.assert(
      fc.property(arbPaychecks, arbAnchor, (pcs, anchor) => {
        const w = groupIntoBudgetWindows(pcs, anchor);
        for (let i = 0; i < w.length; i++) {
          expect(absMonth(w[i]!.budget_month)).toBe(absMonth(w[0]!.budget_month) + i);
        }
        if (w.length > 0) {
          expect(w[0]!.budget_month).toBe(
            `${anchor.year}-${String(anchor.month).padStart(2, '0')}`
          );
        }
      })
    );
  });
});

// ── Metamorphic tests ──────────────────────────────────────────────────────────

describe('groupIntoBudgetWindows — metamorphic relations', () => {
  test('M1: shifting every paycheck date by a constant shifts window dates by the same constant, structure unchanged', () => {
    fc.assert(
      fc.property(arbPaychecks, fc.integer({ min: -400, max: 400 }), (pcs, offset) => {
        const base = groupIntoBudgetWindows(pcs, ANCHOR);
        const shifted = groupIntoBudgetWindows(
          pcs.map((p) => ({ ...p, posted_date: addDays(p.posted_date, offset) })),
          ANCHOR
        );
        expect(shifted.length).toBe(base.length);
        for (let i = 0; i < base.length; i++) {
          // Structure is invariant.
          expect(shifted[i]!.complete).toBe(base[i]!.complete);
          expect(shifted[i]!.budget_month).toBe(base[i]!.budget_month);
          expect(shifted[i]!.paychecks.length).toBe(base[i]!.paychecks.length);
          // Dates translate by exactly `offset`.
          expect(daysBetween(base[i]!.start_date, shifted[i]!.start_date)).toBe(offset);
          if (base[i]!.end_date === null) {
            expect(shifted[i]!.end_date).toBeNull();
          } else {
            expect(daysBetween(base[i]!.end_date!, shifted[i]!.end_date!)).toBe(offset);
          }
        }
      })
    );
  });

  test('M2: scaling all amounts changes nothing — grouping is amount-blind', () => {
    fc.assert(
      fc.property(arbPaychecks, fc.bigInt({ min: 1n, max: 1000n }), (pcs, k) => {
        const base = groupIntoBudgetWindows(pcs, ANCHOR);
        const scaled = groupIntoBudgetWindows(
          pcs.map((p) => ({ ...p, amount_minor: p.amount_minor * k })),
          ANCHOR
        );
        // Compare everything except the (scaled) amounts.
        const strip = (w: BudgetWindow[]) =>
          w.map((win) => ({
            index: win.index,
            budget_month: win.budget_month,
            start_date: win.start_date,
            end_date: win.end_date,
            complete: win.complete,
            count: win.paychecks.length
          }));
        expect(strip(scaled)).toEqual(strip(base));
      })
    );
  });

  test('M3: shifting the anchor by k months shifts every budget-month label by k, structure unchanged', () => {
    fc.assert(
      fc.property(arbPaychecks, fc.integer({ min: -24, max: 24 }), (pcs, k) => {
        const base = groupIntoBudgetWindows(pcs, ANCHOR);
        // Apply k-month shift to the anchor (June 2026 → +k months).
        const shiftedAnchorAbs = ANCHOR.year * 12 + (ANCHOR.month - 1) + k;
        const shiftedAnchor: BudgetAnchor = {
          year: Math.floor(shiftedAnchorAbs / 12),
          month: (shiftedAnchorAbs % 12) + 1
        };
        const shifted = groupIntoBudgetWindows(pcs, shiftedAnchor);
        expect(shifted.length).toBe(base.length);
        for (let i = 0; i < base.length; i++) {
          expect(absMonth(shifted[i]!.budget_month)).toBe(absMonth(base[i]!.budget_month) + k);
          // Everything date/structure-wise is unchanged by an anchor relabel.
          expect(shifted[i]!.start_date).toBe(base[i]!.start_date);
          expect(shifted[i]!.end_date).toBe(base[i]!.end_date);
          expect(shifted[i]!.complete).toBe(base[i]!.complete);
        }
      })
    );
  });
});

// ── Integration with the detector ────────────────────────────────────────────

function mkImport(txns: ParsedTransaction[]): ImportSuccess {
  const statement: ParsedStatement = {
    account_type: 'checking',
    account_last_4: '9535',
    period_start: '2026-01-01',
    period_end: '2026-06-30',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor: null,
    statement_balance_minor: null,
    printed_transaction_count: txns.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: '2026-06-30',
    minimum_payment_due_minor: null,
    parser_provides: ['A']
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name: 'Chase',
    pdf_source_hash: 'hash-checking-9535',
    statement,
    transactions: txns,
    checksum: { ok: true, strategy_used: 'A', level_results: [] }
  };
}

describe('groupIntoBudgetWindows — integration with detectPaychecks', () => {
  test('a real biweekly stream flows detector → grouper into correctly-paired windows', () => {
    const txns: ParsedTransaction[] = [];
    const base = new Date('2026-05-09T00:00:00Z');
    for (let i = 0; i < 6; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i * 14);
      txns.push({
        posted_date: d.toISOString().slice(0, 10),
        description: 'PAYROLL ACME CORP',
        raw_text: 'PAYROLL ACME CORP',
        amount_minor: 320_000n,
        currency: 'USD',
        transaction_type: 'deposit'
      });
    }
    const detected = detectPaychecks([mkImport(txns)]);
    expect(detected.paychecks).toHaveLength(6);

    const windows = groupIntoBudgetWindows(detected.paychecks, { year: 2026, month: 6 });
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.complete)).toBe(true);
    expect(windows.map((w) => w.budget_month)).toEqual(['2026-06', '2026-07', '2026-08']);
    // First window funded by the first two paychecks.
    expect(windows[0]!.paychecks.map((p) => p.posted_date)).toEqual(['2026-05-09', '2026-05-23']);
  });
});
