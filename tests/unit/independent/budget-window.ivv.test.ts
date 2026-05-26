// =============================================================================
// IV&V verification environment — budget-window.ts  (RE-VERIFICATION)
//
// Independent, coverage-driven, self-checking environment built ONLY from:
//   - specs/001-money-tracker-mvp/verification/budget-window.contract.md
//   - specs/001-money-tracker-mvp/design-paycheck-windows.md
// The verifier has NOT read the DUT source or the Designer's tests.
//
// UVM mapping:
//   Generator        -> fast-check arbitraries (constrained-random Paycheck sets)
//   Driver           -> direct call to groupIntoBudgetWindows (the DUT)
//   Monitor          -> extractObservable() normalizes window output for checking
//   Reference model  -> refGroup() : independent from-spec re-implementation
//   Scoreboard       -> Scoreboard{dut, model}.assertClean()
//   Assertions       -> INV1..INV6 properties + §8 error contract
//   Coverage         -> CoverageModel driven to closure
//   Fault injection  -> Stryker (external) + reference-model self-mutation check
// =============================================================================

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  groupIntoBudgetWindows,
  type BudgetAnchor,
  type BudgetWindow
} from '../../../src/lib/app/budget-window';
import type { Paycheck } from '../../../src/lib/app/paycheck-detector';
import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// =============================================================================
// Input type for the scoreboard (paychecks + anchor bundled)
// =============================================================================
interface Stim {
  paychecks: Paycheck[];
  anchor: BudgetAnchor;
}

// =============================================================================
// Independent calendar arithmetic — hand-rolled, NOT Date round-trip.
// Oracle hazard §9: "do not trust round-tripping through any date object".
// =============================================================================

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_LEN_COMMON = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthLength(year: number, month1: number): number {
  // month1 is 1-based
  if (month1 === 2 && isLeap(year)) return 29;
  return MONTH_LEN_COMMON[month1 - 1]!;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function pad4(n: number): string {
  // years are 1970..9999 here, but keep general
  if (n < 10) return `000${n}`;
  if (n < 100) return `00${n}`;
  if (n < 1000) return `0${n}`;
  return `${n}`;
}

interface YMD {
  y: number;
  m: number; // 1-based
  d: number;
}

function parseISO(iso: string): YMD {
  // expects YYYY-MM-DD
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return { y, m, d };
}

function formatISO(ymd: YMD): string {
  return `${pad4(ymd.y)}-${pad2(ymd.m)}-${pad2(ymd.d)}`;
}

// Subtract exactly one calendar day, hand-rolled with leap-aware month lengths.
function minusOneDay(iso: string): string {
  const { y, m, d } = parseISO(iso);
  if (d > 1) return formatISO({ y, m, d: d - 1 });
  // d === 1: roll to previous month
  if (m > 1) {
    const pm = m - 1;
    return formatISO({ y, m: pm, d: monthLength(y, pm) });
  }
  // m === 1, d === 1: roll to Dec 31 of previous year
  return formatISO({ y: y - 1, m: 12, d: 31 });
}

// Budget-month label arithmetic, hand-derived (NOT via Date).
// anchor + windowIndex months, "YYYY-MM", year-wrap correct.
function budgetMonthLabel(anchor: BudgetAnchor, windowIndex: number): string {
  const totalMonths0 = anchor.year * 12 + (anchor.month - 1) + windowIndex;
  const y = Math.floor(totalMonths0 / 12);
  const m0 = totalMonths0 - y * 12; // 0..11
  return `${pad4(y)}-${pad2(m0 + 1)}`;
}

// =============================================================================
// Reference model (the golden) — independent re-implementation of the spec.
//
//   1. §8 validation: throw on bad anchor.month / anchor.year.
//   2. R7 + R9: sort by (posted_date, import_index, transaction_index) asc.
//   3. R2/R3: chronological pairs of 2; trailing single.
//   4. R4: start = window[0].posted_date; end = next.start - 1 day; last = null.
//   5. INV5 clamp: end clamped so it never precedes own start_date.
//   6. R5: budget_month = anchor + index months.
//   7. R6: complete = (count === 2).
// =============================================================================

function validateAnchor(anchor: BudgetAnchor): void {
  if (
    typeof anchor.month !== 'number' ||
    !Number.isInteger(anchor.month) ||
    anchor.month < 1 ||
    anchor.month > 12
  ) {
    throw new Error(`anchor.month must be an integer 1-12; got ${anchor.month}`);
  }
  if (
    typeof anchor.year !== 'number' ||
    !Number.isInteger(anchor.year) ||
    anchor.year < 1970 ||
    anchor.year > 9999
  ) {
    throw new Error(`anchor.year must be an integer 1970-9999; got ${anchor.year}`);
  }
}

// Stable sort key. posted_date is ISO YYYY-MM-DD so string compare is chronological.
function refSortKey(a: Paycheck, b: Paycheck): number {
  if (a.posted_date !== b.posted_date) return a.posted_date < b.posted_date ? -1 : 1;
  if (a.import_index !== b.import_index) return a.import_index - b.import_index;
  if (a.transaction_index !== b.transaction_index) return a.transaction_index - b.transaction_index;
  return 0;
}

function refGroup(stim: Stim): BudgetWindow[] {
  const { paychecks, anchor } = stim;
  validateAnchor(anchor);

  // R7 + R9: deterministic chronological order independent of input order.
  const sorted = [...paychecks].sort(refSortKey);

  // R2/R3: pair into chronological windows of 2, trailing single.
  const groups: Paycheck[][] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    groups.push(sorted.slice(i, i + 2));
  }

  const windows: BudgetWindow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const start_date = group[0]!.posted_date;
    const isLast = i === groups.length - 1;
    let end_date: string | null;
    if (isLast) {
      end_date = null; // R4: final window in progress
    } else {
      const nextStart = groups[i + 1]![0]!.posted_date;
      let computed = minusOneDay(nextStart);
      // INV5 clamp: never precede own start_date.
      if (computed < start_date) computed = start_date;
      end_date = computed;
    }
    windows.push({
      index: i,
      budget_month: budgetMonthLabel(anchor, i),
      paychecks: group,
      start_date,
      end_date,
      complete: group.length === 2
    });
  }
  return windows;
}

// =============================================================================
// Driver wrapper for the DUT (matches the Stim shape).
// =============================================================================
function dutGroup(stim: Stim): BudgetWindow[] {
  return groupIntoBudgetWindows(stim.paychecks, stim.anchor);
}

// =============================================================================
// Generators (constrained-random stimulus)
// =============================================================================

let pcSeq = 0;
function makePaycheck(overrides: Partial<Paycheck> = {}): Paycheck {
  pcSeq += 1;
  return {
    posted_date: '2026-01-01',
    amount_minor: 100_000n,
    description: 'DIRECT DEP PAYROLL ACME',
    import_index: 0,
    transaction_index: pcSeq,
    confidence: 'high',
    stream_key: 'payroll-acme',
    ...overrides
  };
}

// Arbitrary ISO date in a safe range (avoids year boundaries of the valid window
// so the structural properties don't accidentally exercise §8 limits).
const arbDateParts = fc.record({
  y: fc.integer({ min: 2000, max: 2030 }),
  m: fc.integer({ min: 1, max: 12 }),
  d: fc.integer({ min: 1, max: 28 }) // 28 keeps every month valid
});

function partsToISO(p: { y: number; m: number; d: number }): string {
  return `${pad4(p.y)}-${pad2(p.m)}-${pad2(p.d)}`;
}

const arbPaycheck: fc.Arbitrary<Paycheck> = fc
  .record({
    parts: arbDateParts,
    amount: fc.bigInt({ min: 1n, max: 50_000_00n }),
    import_index: fc.integer({ min: 0, max: 5 }),
    transaction_index: fc.integer({ min: 0, max: 50 }),
    desc: fc.constantFrom('PAYROLL ACME', 'DIRECT DEPOSIT', 'SOC SEC', 'TREAS 310'),
    conf: fc.constantFrom<'high' | 'medium' | 'low'>('high', 'medium', 'low')
  })
  .map((r) =>
    makePaycheck({
      posted_date: partsToISO(r.parts),
      amount_minor: r.amount,
      import_index: r.import_index,
      transaction_index: r.transaction_index,
      description: r.desc,
      confidence: r.conf
    })
  );

const arbPaychecks: fc.Arbitrary<Paycheck[]> = fc.array(arbPaycheck, {
  minLength: 0,
  maxLength: 12
});

const arbAnchor: fc.Arbitrary<BudgetAnchor> = fc.record({
  year: fc.integer({ min: 1970, max: 9999 }),
  month: fc.integer({ min: 1, max: 12 })
});

const arbStim: fc.Arbitrary<Stim> = fc.record({
  paychecks: arbPaychecks,
  anchor: arbAnchor
});

// =============================================================================
// Monitor — extract observable facts for invariant checks.
// =============================================================================

function paycheckId(p: Paycheck): string {
  return `${p.posted_date}|${p.import_index}|${p.transaction_index}|${p.amount_minor}|${p.description}`;
}

// =============================================================================
// Functional coverage model — verification plan cover points.
// =============================================================================
const cov = new CoverageModel([
  // counts
  'n=0',
  'n=1',
  'n=2',
  'n=3',
  'n=4',
  'n=5',
  'n=even',
  'n=odd',
  // structure
  'window-count=ceil(n/2)',
  'has-complete-window',
  'has-incomplete-window',
  'final-window-end-null',
  // labels
  'anchor-month=december (year roll)',
  'multi-year-span (labels cross >=1 year)',
  // dates
  'leap-day-in-window',
  'end_date-crosses-month-boundary',
  'end_date-crosses-year-boundary',
  // §8 error contract boundaries
  'year=1969 throws',
  'year=1970 valid',
  'year=9999 valid',
  'year=10000 throws',
  'month=0 throws',
  'month=13 throws',
  'month-non-integer throws',
  'year-non-integer throws',
  // R9 / robustness
  'unsorted-input',
  'same-date-pair (2 share date)',
  'same-date-triple (3 share date -> INV5 clamp)',
  'R9 permuted-same-date-ties identical output',
  'INV5 clamp engaged (end_date==start_date)',
  'INV6 zero-length window observed',
  // metamorphic
  'INV2 amount-blind',
  'INV3 date-translation'
]);

// =============================================================================
// PHASE C / D — Scoreboard + invariant assertions over constrained-random.
// =============================================================================

describe('budget-window IV&V — scoreboard (DUT vs independent reference model)', () => {
  test('DUT agrees with independent reference model on constrained-random stimulus', () => {
    const sb = new Scoreboard<Stim, BudgetWindow[]>({
      dut: dutGroup,
      model: refGroup,
      show: (s) =>
        `anchor=${s.anchor.year}-${s.anchor.month} pcs=[${s.paychecks
          .map((p) => `${p.posted_date}#${p.import_index}.${p.transaction_index}`)
          .join(',')}]`
    });

    fc.assert(
      fc.property(arbStim, (stim) => {
        sb.check(stim);

        // drive functional coverage from the same stimulus
        const n = stim.paychecks.length;
        cov.cover(`n=${Math.min(n, 5)}`); // n>5 will hit nothing extra; explicit bins n=0..5 handled below
        if (n === 0) cov.cover('n=0');
        if (n === 1) cov.cover('n=1');
        if (n === 2) cov.cover('n=2');
        if (n === 3) cov.cover('n=3');
        if (n === 4) cov.cover('n=4');
        if (n === 5) cov.cover('n=5');
        cov.coverIf(n % 2 === 0 && n > 0, 'n=even');
        cov.coverIf(n % 2 === 1, 'n=odd');

        const windows = refGroup(stim); // safe: anchor always valid here
        cov.coverIf(windows.length === Math.ceil(n / 2), 'window-count=ceil(n/2)');
        cov.coverIf(
          windows.some((w) => w.complete),
          'has-complete-window'
        );
        cov.coverIf(
          windows.some((w) => !w.complete),
          'has-incomplete-window'
        );
        cov.coverIf(
          windows.length > 0 && windows[windows.length - 1]!.end_date === null,
          'final-window-end-null'
        );
        cov.coverIf(stim.anchor.month === 12, 'anchor-month=december (year roll)');
        if (windows.length > 0) {
          const firstYear = windows[0]!.budget_month.slice(0, 4);
          const lastYear = windows[windows.length - 1]!.budget_month.slice(0, 4);
          cov.coverIf(firstYear !== lastYear, 'multi-year-span (labels cross >=1 year)');
        }
        // unsorted input detection
        const dates = stim.paychecks.map((p) => p.posted_date);
        const sortedDates = [...dates].sort();
        cov.coverIf(JSON.stringify(dates) !== JSON.stringify(sortedDates), 'unsorted-input');
      }),
      { numRuns: 600 }
    );

    sb.assertClean();
  });
});

// =============================================================================
// PHASE C — Directed corner cases (n = 0..5), hand-derived golden values.
// =============================================================================

describe('budget-window IV&V — directed corners with hand-derived goldens', () => {
  const anchor: BudgetAnchor = { year: 2026, month: 6 }; // June 2026

  test('R8: n=0 -> zero windows', () => {
    const out = groupIntoBudgetWindows([], anchor);
    expect(out).toEqual([]);
  });

  test('n=1: single incomplete window, end_date null, label=anchor', () => {
    const p = makePaycheck({ posted_date: '2026-05-23', transaction_index: 1 });
    const out = groupIntoBudgetWindows([p], anchor);
    expect(out.length).toBe(1);
    const w = out[0]!;
    expect(w.index).toBe(0);
    expect(w.budget_month).toBe('2026-06'); // R1: anchor, NOT derived from May date
    expect(w.start_date).toBe('2026-05-23');
    expect(w.end_date).toBeNull(); // R4 final
    expect(w.complete).toBe(false); // R6
    expect(w.paychecks.length).toBe(1);
  });

  test('n=2: one complete window, end_date null (it is the last/only window)', () => {
    const p1 = makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 });
    const p2 = makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 });
    const out = groupIntoBudgetWindows([p1, p2], anchor);
    expect(out.length).toBe(1);
    const w = out[0]!;
    expect(w.budget_month).toBe('2026-06');
    expect(w.start_date).toBe('2026-05-09');
    expect(w.end_date).toBeNull();
    expect(w.complete).toBe(true);
    expect(w.paychecks.length).toBe(2);
  });

  test('n=3: window0 complete + window1 trailing single; end_date hand-derived', () => {
    const p1 = makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 });
    const p2 = makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 });
    const p3 = makePaycheck({ posted_date: '2026-06-06', transaction_index: 3 });
    const out = groupIntoBudgetWindows([p1, p2, p3], anchor);
    expect(out.length).toBe(2); // ceil(3/2)
    const w0 = out[0]!;
    const w1 = out[1]!;
    // window0: pcs 1,2; start 05-09; end = day before window1.start(06-06) = 06-05
    expect(w0.budget_month).toBe('2026-06');
    expect(w0.start_date).toBe('2026-05-09');
    expect(w0.end_date).toBe('2026-06-05');
    expect(w0.complete).toBe(true);
    // window1: trailing single pc3; start 06-06; end null; label advances 1 month
    expect(w1.budget_month).toBe('2026-07');
    expect(w1.start_date).toBe('2026-06-06');
    expect(w1.end_date).toBeNull();
    expect(w1.complete).toBe(false);
  });

  test('n=4: two complete windows; contiguity hand-checked', () => {
    const ps = [
      makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 }),
      makePaycheck({ posted_date: '2026-06-06', transaction_index: 3 }),
      makePaycheck({ posted_date: '2026-06-20', transaction_index: 4 })
    ];
    const out = groupIntoBudgetWindows(ps, anchor);
    expect(out.length).toBe(2);
    expect(out[0]!.budget_month).toBe('2026-06');
    expect(out[0]!.start_date).toBe('2026-05-09');
    expect(out[0]!.end_date).toBe('2026-06-05'); // day before 06-06
    expect(out[0]!.complete).toBe(true);
    expect(out[1]!.budget_month).toBe('2026-07');
    expect(out[1]!.start_date).toBe('2026-06-06');
    expect(out[1]!.end_date).toBeNull();
    expect(out[1]!.complete).toBe(true);
  });

  test('n=5: three windows, last is trailing single', () => {
    const ps = [
      makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 }),
      makePaycheck({ posted_date: '2026-06-06', transaction_index: 3 }),
      makePaycheck({ posted_date: '2026-06-20', transaction_index: 4 }),
      makePaycheck({ posted_date: '2026-07-04', transaction_index: 5 })
    ];
    const out = groupIntoBudgetWindows(ps, anchor);
    expect(out.length).toBe(3); // ceil(5/2)
    expect(out[2]!.complete).toBe(false);
    expect(out[2]!.paychecks.length).toBe(1);
    expect(out[2]!.budget_month).toBe('2026-08'); // June+2
    expect(out[2]!.end_date).toBeNull();
  });

  test('R1: paycheck month != anchor month — label uses anchor', () => {
    // Paychecks posted in March, but anchor says they fund September.
    const a: BudgetAnchor = { year: 2026, month: 9 };
    const ps = [
      makePaycheck({ posted_date: '2026-03-02', transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-03-16', transaction_index: 2 })
    ];
    const out = groupIntoBudgetWindows(ps, a);
    expect(out[0]!.budget_month).toBe('2026-09');
  });
});

// =============================================================================
// PHASE C — December year-wrap + multi-year label arithmetic (oracle hazard §9).
// =============================================================================

describe('budget-window IV&V — label year-wrap (hand-derived)', () => {
  test('anchor=December rolls label into next year', () => {
    const a: BudgetAnchor = { year: 2026, month: 12 };
    const ps = [
      makePaycheck({ posted_date: '2026-11-20', transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-12-04', transaction_index: 2 }),
      makePaycheck({ posted_date: '2026-12-18', transaction_index: 3 }),
      makePaycheck({ posted_date: '2027-01-01', transaction_index: 4 })
    ];
    const out = groupIntoBudgetWindows(ps, a);
    // window0 = Dec 2026; window1 = Jan 2027 (rolled)
    expect(out[0]!.budget_month).toBe('2026-12');
    expect(out[1]!.budget_month).toBe('2027-01');
    cov.cover('anchor-month=december (year roll)');
  });

  test('multi-year span: 27 windows from Nov anchor crosses two year boundaries', () => {
    const a: BudgetAnchor = { year: 2026, month: 11 };
    // 54 paychecks -> 27 windows. Labels: 2026-11 .. 2029-01.
    const ps: Paycheck[] = [];
    for (let i = 0; i < 54; i++) {
      // synthetic dates spaced 14 days apart starting 2026-10-15
      const base = parseISO('2026-10-15');
      // add i*14 days via a Date in UTC is fine for *generating stimulus*
      const dt = new Date(Date.UTC(base.y, base.m - 1, base.d));
      dt.setUTCDate(dt.getUTCDate() + i * 14);
      const iso = `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
      ps.push(makePaycheck({ posted_date: iso, transaction_index: i + 1 }));
    }
    const out = groupIntoBudgetWindows(ps, a);
    expect(out.length).toBe(27);
    expect(out[0]!.budget_month).toBe('2026-11');
    // window index 2 -> Jan 2027 (Nov + 2)
    expect(out[2]!.budget_month).toBe('2027-01');
    // window index 14 -> Nov 2026 + 14 months = Jan 2028
    expect(out[14]!.budget_month).toBe('2028-01');
    // window index 26 -> Nov 2026 + 26 months = Jan 2029
    expect(out[26]!.budget_month).toBe('2029-01');
    cov.cover('multi-year-span (labels cross >=1 year)');
  });
});

// =============================================================================
// PHASE C — Leap-day "day before" arithmetic (oracle hazard §9).
// =============================================================================

describe('budget-window IV&V — leap-day end_date arithmetic (hand-derived)', () => {
  test('end_date = day before Mar 1 in leap year 2028 is Feb 29', () => {
    const a: BudgetAnchor = { year: 2028, month: 3 };
    const ps = [
      makePaycheck({ posted_date: '2028-02-15', transaction_index: 1 }),
      makePaycheck({ posted_date: '2028-02-20', transaction_index: 2 }),
      makePaycheck({ posted_date: '2028-03-01', transaction_index: 3 }),
      makePaycheck({ posted_date: '2028-03-10', transaction_index: 4 })
    ];
    const out = groupIntoBudgetWindows(ps, a);
    // window0 end = day before window1.start (2028-03-01) = 2028-02-29 (leap)
    expect(out[0]!.end_date).toBe('2028-02-29');
    cov.cover('leap-day-in-window');
    cov.cover('end_date-crosses-month-boundary');
  });

  test('end_date = day before Mar 1 in NON-leap year 2027 is Feb 28', () => {
    const a: BudgetAnchor = { year: 2027, month: 3 };
    const ps = [
      makePaycheck({ posted_date: '2027-02-15', transaction_index: 1 }),
      makePaycheck({ posted_date: '2027-02-20', transaction_index: 2 }),
      makePaycheck({ posted_date: '2027-03-01', transaction_index: 3 }),
      makePaycheck({ posted_date: '2027-03-10', transaction_index: 4 })
    ];
    const out = groupIntoBudgetWindows(ps, a);
    expect(out[0]!.end_date).toBe('2027-02-28');
  });

  test('end_date = day before Jan 1 rolls to Dec 31 prior year', () => {
    const a: BudgetAnchor = { year: 2026, month: 12 };
    const ps = [
      makePaycheck({ posted_date: '2026-12-18', transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-12-25', transaction_index: 2 }),
      makePaycheck({ posted_date: '2027-01-01', transaction_index: 3 }),
      makePaycheck({ posted_date: '2027-01-15', transaction_index: 4 })
    ];
    const out = groupIntoBudgetWindows(ps, a);
    // window0 end = day before window1.start (2027-01-01) = 2026-12-31
    expect(out[0]!.end_date).toBe('2026-12-31');
    cov.cover('end_date-crosses-year-boundary');
  });
});

// =============================================================================
// PHASE C — R9 deterministic same-date tie-break + R7 unsorted robustness.
// =============================================================================

describe('budget-window IV&V — R9 tie-break + R7 robustness', () => {
  const anchor: BudgetAnchor = { year: 2026, month: 6 };

  test('R7: unsorted input yields chronological windows', () => {
    const ps = [
      makePaycheck({ posted_date: '2026-06-06', transaction_index: 3 }),
      makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 })
    ];
    const out = groupIntoBudgetWindows(ps, anchor);
    expect(out[0]!.start_date).toBe('2026-05-09');
    expect(out[0]!.paychecks[0]!.transaction_index).toBe(1);
    expect(out[0]!.paychecks[1]!.transaction_index).toBe(2);
    expect(out[1]!.start_date).toBe('2026-06-06');
    cov.cover('unsorted-input');
  });

  test('R9: same-date PAIR ties break by import_index then transaction_index', () => {
    // Two paychecks share 2026-05-23. Defined order: import 0 t1 before import 1 t0.
    const a = makePaycheck({
      posted_date: '2026-05-23',
      import_index: 1,
      transaction_index: 0,
      description: 'B'
    });
    const b = makePaycheck({
      posted_date: '2026-05-23',
      import_index: 0,
      transaction_index: 9,
      description: 'A'
    });
    // input order [a,b] (import 1 first) -> expected sorted: b (import0) then a (import1)
    const out = groupIntoBudgetWindows([a, b], anchor);
    expect(out.length).toBe(1);
    expect(out[0]!.paychecks[0]!.import_index).toBe(0);
    expect(out[0]!.paychecks[1]!.import_index).toBe(1);
    cov.cover('same-date-pair (2 share date)');
  });

  test('R9: tie-break within same import_index uses transaction_index ascending', () => {
    const hi = makePaycheck({
      posted_date: '2026-05-23',
      import_index: 0,
      transaction_index: 8,
      description: 'late'
    });
    const lo = makePaycheck({
      posted_date: '2026-05-23',
      import_index: 0,
      transaction_index: 2,
      description: 'early'
    });
    const out = groupIntoBudgetWindows([hi, lo], anchor);
    expect(out[0]!.paychecks[0]!.transaction_index).toBe(2);
    expect(out[0]!.paychecks[1]!.transaction_index).toBe(8);
  });

  test('R9: ALL permutations of same-date ties produce IDENTICAL output', () => {
    // 4 paychecks, all on 2026-05-23, distinct (import_index, transaction_index).
    const base = [
      { import_index: 0, transaction_index: 1 },
      { import_index: 0, transaction_index: 5 },
      { import_index: 1, transaction_index: 2 },
      { import_index: 2, transaction_index: 0 }
    ];
    function build(perm: { import_index: number; transaction_index: number }[]): Paycheck[] {
      return perm.map((x) =>
        makePaycheck({
          posted_date: '2026-05-23',
          import_index: x.import_index,
          transaction_index: x.transaction_index,
          description: `i${x.import_index}t${x.transaction_index}`
        })
      );
    }
    // canonical output from sorted order
    const canonical = groupIntoBudgetWindows(build(base), anchor);
    const canonicalIds = canonical.map((w) => w.paychecks.map(paycheckId));

    // brute-force all 24 permutations
    function permutations<T>(arr: T[]): T[][] {
      if (arr.length <= 1) return [arr];
      const res: T[][] = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        for (const p of permutations(rest)) res.push([arr[i]!, ...p]);
      }
      return res;
    }

    let permCount = 0;
    for (const perm of permutations(base)) {
      const out = groupIntoBudgetWindows(build(perm), anchor);
      const ids = out.map((w) => w.paychecks.map(paycheckId));
      expect(ids).toEqual(canonicalIds);
      permCount++;
    }
    expect(permCount).toBe(24);
    cov.cover('R9 permuted-same-date-ties identical output');
  });
});

// =============================================================================
// PHASE C — Same-date TRIPLE exercising INV5 clamp / INV6 (architect decision 3).
// =============================================================================

describe('budget-window IV&V — same-date triple: INV5 clamp + INV6', () => {
  const anchor: BudgetAnchor = { year: 2026, month: 6 };

  test('3 paychecks on ONE identical date: window0 end clamps to start (zero-length)', () => {
    // 3 on 2026-05-23. window0 = pc#1,#2 (start 05-23). window1 = pc#3 (start 05-23).
    // Naive end0 = day before window1.start = 05-22 < start0(05-23) => INVERTED.
    // INV5 clamp: end0 := start0 = 05-23 (zero-length, NOT inverted).
    const ps = [
      makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: 1 }),
      makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: 2 }),
      makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: 3 })
    ];
    const out = groupIntoBudgetWindows(ps, anchor);
    expect(out.length).toBe(2);
    const w0 = out[0]!;
    expect(w0.start_date).toBe('2026-05-23');
    // INV5 clamp + INV6: end must NOT be 2026-05-22 (inverted); must be 2026-05-23.
    expect(w0.end_date).toBe('2026-05-23');
    expect(w0.start_date <= (w0.end_date as string)).toBe(true); // INV6
    expect(w0.complete).toBe(true);
    // window1 trailing single
    expect(out[1]!.start_date).toBe('2026-05-23');
    expect(out[1]!.end_date).toBeNull();
    expect(out[1]!.complete).toBe(false);
    cov.cover('same-date-triple (3 share date -> INV5 clamp)');
    cov.cover('INV5 clamp engaged (end_date==start_date)');
    cov.cover('INV6 zero-length window observed');
  });

  test('5 paychecks all on one date: every non-final end clamps, none inverted', () => {
    const ps: Paycheck[] = [];
    for (let i = 0; i < 5; i++) {
      ps.push(
        makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: i + 1 })
      );
    }
    const out = groupIntoBudgetWindows(ps, anchor);
    expect(out.length).toBe(3); // ceil(5/2)
    for (const w of out) {
      if (w.end_date !== null) {
        expect(w.start_date <= w.end_date).toBe(true); // INV6
        // every shared-date non-final window is zero-length
        expect(w.end_date).toBe('2026-05-23');
      }
    }
    // last window end null
    expect(out[2]!.end_date).toBeNull();
  });
});

// =============================================================================
// PHASE C/D — Invariants as properties (INV1..INV6) over constrained-random.
// =============================================================================

describe('budget-window IV&V — invariants (properties)', () => {
  test('INV1 conservation: every input paycheck appears in exactly one window', () => {
    fc.assert(
      fc.property(arbStim, (stim) => {
        const out = groupIntoBudgetWindows(stim.paychecks, stim.anchor);
        const inputIds = stim.paychecks.map(paycheckId).sort();
        const outputIds = out.flatMap((w) => w.paychecks.map(paycheckId)).sort();
        expect(outputIds).toEqual(inputIds); // none lost, none duplicated
      }),
      { numRuns: 400 }
    );
  });

  test('INV4 count: number of windows == ceil(n/2)', () => {
    fc.assert(
      fc.property(arbStim, (stim) => {
        const out = groupIntoBudgetWindows(stim.paychecks, stim.anchor);
        expect(out.length).toBe(Math.ceil(stim.paychecks.length / 2));
      }),
      { numRuns: 400 }
    );
  });

  test('INV5 contiguity + clamp; INV6 no inverted window', () => {
    fc.assert(
      fc.property(arbStim, (stim) => {
        const out = groupIntoBudgetWindows(stim.paychecks, stim.anchor);
        for (let i = 0; i < out.length; i++) {
          const w = out[i]!;
          // INV6: never inverted
          if (w.end_date !== null) {
            expect(w.start_date <= w.end_date).toBe(true);
          }
          // last window end_date null (R4)
          if (i === out.length - 1) {
            expect(w.end_date).toBeNull();
          } else {
            // non-final: end_date is day-before-next-start, OR clamped to own start
            const next = out[i + 1]!;
            const dayBefore = minusOneDay(next.start_date);
            const expectedEnd = dayBefore < w.start_date ? w.start_date : dayBefore;
            expect(w.end_date).toBe(expectedEnd);
            cov.coverIf(w.end_date === w.start_date, 'INV5 clamp engaged (end_date==start_date)');
            cov.coverIf(w.start_date === w.end_date, 'INV6 zero-length window observed');
          }
        }
      }),
      { numRuns: 400 }
    );
  });

  test('R5 label advance: budget_month advances exactly 1 month per window', () => {
    fc.assert(
      fc.property(arbStim, (stim) => {
        const out = groupIntoBudgetWindows(stim.paychecks, stim.anchor);
        for (let i = 0; i < out.length; i++) {
          expect(out[i]!.budget_month).toBe(budgetMonthLabel(stim.anchor, i));
          expect(out[i]!.index).toBe(i); // sequential index from 0
        }
      }),
      { numRuns: 400 }
    );
  });

  test('R6 complete flag: complete iff window holds 2 paychecks', () => {
    fc.assert(
      fc.property(arbStim, (stim) => {
        const out = groupIntoBudgetWindows(stim.paychecks, stim.anchor);
        for (const w of out) {
          expect(w.complete).toBe(w.paychecks.length === 2);
        }
      }),
      { numRuns: 300 }
    );
  });
});

// =============================================================================
// PHASE D — Metamorphic relations (oracle-free).
// =============================================================================

describe('budget-window IV&V — metamorphic relations (oracle-free)', () => {
  test('INV2 amount-blind: changing amounts does not change structure/dates/labels', () => {
    fc.assert(
      fc.property(arbStim, fc.bigInt({ min: 1n, max: 9_999_999n }), (stim, newAmt) => {
        const before = groupIntoBudgetWindows(stim.paychecks, stim.anchor);
        const mutated = stim.paychecks.map((p) => ({ ...p, amount_minor: newAmt }));
        const after = groupIntoBudgetWindows(mutated, stim.anchor);
        expect(after.length).toBe(before.length);
        for (let i = 0; i < before.length; i++) {
          expect(after[i]!.budget_month).toBe(before[i]!.budget_month);
          expect(after[i]!.start_date).toBe(before[i]!.start_date);
          expect(after[i]!.end_date).toBe(before[i]!.end_date);
          expect(after[i]!.complete).toBe(before[i]!.complete);
          expect(after[i]!.paychecks.length).toBe(before[i]!.paychecks.length);
        }
        cov.cover('INV2 amount-blind');
      }),
      { numRuns: 300 }
    );
  });

  test('INV3 date-translation: shifting all dates by +k days shifts window dates by +k, labels unchanged', () => {
    fc.assert(
      fc.property(
        // use a fixed safe base so +k stays well inside valid ISO range
        fc.array(
          fc.record({
            offsetDays: fc.integer({ min: 0, max: 300 }),
            import_index: fc.integer({ min: 0, max: 3 }),
            transaction_index: fc.integer({ min: 0, max: 30 })
          }),
          { minLength: 0, maxLength: 10 }
        ),
        fc.integer({ min: 1, max: 365 }),
        arbAnchor,
        (specs, k, anchor) => {
          const baseUTC = Date.UTC(2026, 0, 1); // 2026-01-01
          const dayMs = 86_400_000;
          function isoFrom(offsetDays: number): string {
            const dt = new Date(baseUTC + offsetDays * dayMs);
            return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
          }
          const original: Paycheck[] = specs.map((s, idx) =>
            makePaycheck({
              posted_date: isoFrom(s.offsetDays),
              import_index: s.import_index,
              transaction_index: s.transaction_index * 100 + idx, // keep unique tie-break
              amount_minor: BigInt(1000 + idx)
            })
          );
          const shifted: Paycheck[] = specs.map((s, idx) =>
            makePaycheck({
              posted_date: isoFrom(s.offsetDays + k),
              import_index: s.import_index,
              transaction_index: s.transaction_index * 100 + idx,
              amount_minor: BigInt(1000 + idx)
            })
          );
          const a = groupIntoBudgetWindows(original, anchor);
          const b = groupIntoBudgetWindows(shifted, anchor);
          expect(b.length).toBe(a.length);
          for (let i = 0; i < a.length; i++) {
            // labels + completeness + counts unchanged
            expect(b[i]!.budget_month).toBe(a[i]!.budget_month);
            expect(b[i]!.complete).toBe(a[i]!.complete);
            expect(b[i]!.paychecks.length).toBe(a[i]!.paychecks.length);
            // dates shifted by exactly +k days
            const shiftIso = (iso: string): string => {
              const { y, m, d } = parseISO(iso);
              const dt = new Date(Date.UTC(y, m - 1, d) + k * dayMs);
              return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
            };
            expect(b[i]!.start_date).toBe(shiftIso(a[i]!.start_date));
            if (a[i]!.end_date === null) {
              expect(b[i]!.end_date).toBeNull();
            } else {
              expect(b[i]!.end_date).toBe(shiftIso(a[i]!.end_date as string));
            }
          }
          cov.cover('INV3 date-translation');
        }
      ),
      { numRuns: 200 }
    );
  });

  test('permutation-invariance: shuffling input never changes output (R7+R9 combined)', () => {
    fc.assert(
      fc.property(
        arbPaychecks,
        arbAnchor,
        fc.integer({ min: 0, max: 1000 }),
        (pcs, anchor, seed) => {
          // make tie-break keys unique so output is fully determined
          const unique = pcs.map((p, i) => ({
            ...p,
            import_index: i % 4,
            transaction_index: i
          }));
          const ref = groupIntoBudgetWindows(unique, anchor);
          // deterministic shuffle
          const shuffled = [...unique];
          let s = seed + 1;
          for (let i = shuffled.length - 1; i > 0; i--) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const j = s % (i + 1);
            const tmp = shuffled[i]!;
            shuffled[i] = shuffled[j]!;
            shuffled[j] = tmp;
          }
          const out = groupIntoBudgetWindows(shuffled, anchor);
          const refIds = ref.map((w) => w.paychecks.map(paycheckId));
          const outIds = out.map((w) => w.paychecks.map(paycheckId));
          expect(outIds).toEqual(refIds);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// =============================================================================
// PHASE C — §8 error contract: anchor validation (architect decision 1).
// =============================================================================

describe('budget-window IV&V — §8 error contract (throws, no silent mislabel)', () => {
  const goodPcs = [
    makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 }),
    makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 })
  ];

  // ---- anchor.month ----
  test('month=0 throws referencing anchor.month', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026, month: 0 })).toThrow(
      /anchor\.month/i
    );
    cov.cover('month=0 throws');
  });
  test('month=13 throws referencing anchor.month', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026, month: 13 })).toThrow(
      /anchor\.month/i
    );
    cov.cover('month=13 throws');
  });
  test('month=-1 throws', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026, month: -1 })).toThrow(
      /anchor\.month/i
    );
  });
  test('month=6.5 (non-integer) throws referencing anchor.month', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026, month: 6.5 })).toThrow(
      /anchor\.month/i
    );
    cov.cover('month-non-integer throws');
  });
  test('month=1 and month=12 are valid (no throw)', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026, month: 1 })).not.toThrow();
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026, month: 12 })).not.toThrow();
  });

  // ---- anchor.year (architect decision 1: 1970–9999 inclusive) ----
  test('year=1969 throws referencing anchor.year (below floor)', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 1969, month: 6 })).toThrow(
      /anchor\.year/i
    );
    cov.cover('year=1969 throws');
  });
  test('year=1970 valid (floor, no throw)', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 1970, month: 6 })).not.toThrow();
    cov.cover('year=1970 valid');
  });
  test('year=9999 valid (ceiling, no throw)', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 9999, month: 6 })).not.toThrow();
    cov.cover('year=9999 valid');
  });
  test('year=10000 throws referencing anchor.year (above ceiling)', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 10000, month: 6 })).toThrow(
      /anchor\.year/i
    );
    cov.cover('year=10000 throws');
  });
  test('year=2026.5 (non-integer) throws referencing anchor.year', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 2026.5, month: 6 })).toThrow(
      /anchor\.year/i
    );
    cov.cover('year-non-integer throws');
  });
  test('year=0 and negative years throw', () => {
    expect(() => groupIntoBudgetWindows(goodPcs, { year: 0, month: 6 })).toThrow(/anchor\.year/i);
    expect(() => groupIntoBudgetWindows(goodPcs, { year: -2026, month: 6 })).toThrow(
      /anchor\.year/i
    );
  });

  test('label at year=1970 floor formats as 1970-MM', () => {
    const out = groupIntoBudgetWindows(goodPcs, { year: 1970, month: 1 });
    expect(out[0]!.budget_month).toBe('1970-01');
  });
});

// =============================================================================
// PHASE C — drive remaining count cover points deterministically + closure gate.
// =============================================================================

describe('budget-window IV&V — coverage closure', () => {
  test('drive directed n=0..5 + boundary bins, then assert functional coverage closed', () => {
    const anchor: BudgetAnchor = { year: 2026, month: 6 };
    for (let n = 0; n <= 5; n++) {
      const ps: Paycheck[] = [];
      for (let i = 0; i < n; i++) {
        const base = new Date(Date.UTC(2026, 4, 9) + i * 14 * 86_400_000);
        const iso = `${pad4(base.getUTCFullYear())}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
        ps.push(makePaycheck({ posted_date: iso, transaction_index: i + 1 }));
      }
      const out = groupIntoBudgetWindows(ps, anchor);
      cov.cover(`n=${n}`);
      cov.coverIf(n % 2 === 0 && n > 0, 'n=even');
      cov.coverIf(n % 2 === 1, 'n=odd');
      cov.coverIf(out.length === Math.ceil(n / 2), 'window-count=ceil(n/2)');
      cov.coverIf(
        out.some((w) => w.complete),
        'has-complete-window'
      );
      cov.coverIf(
        out.some((w) => !w.complete),
        'has-incomplete-window'
      );
      cov.coverIf(
        out.length > 0 && out[out.length - 1]!.end_date === null,
        'final-window-end-null'
      );
    }

    // report + gate

    console.log(cov.report());
    cov.assertClosed();
  });
});

// =============================================================================
// PHASE E — Bench-has-teeth: self-mutate the reference model, confirm scoreboard
// DETECTS the disagreement against the DUT. Proves the scoreboard is not
// vacuously passing. (External Stryker mutation reported separately.)
// =============================================================================

describe('budget-window IV&V — fault injection (bench-has-teeth)', () => {
  // A deliberately-broken reference model: off-by-one in the label arithmetic.
  function refGroupMutant(stim: Stim): BudgetWindow[] {
    const good = refGroup(stim);
    return good.map((w) => ({
      ...w,
      // BUG injected: advance label by index+1 instead of index
      budget_month: budgetMonthLabel(stim.anchor, w.index + 1)
    }));
  }

  test('scoreboard FAILS when the reference model is mutated (label off-by-one)', () => {
    const sb = new Scoreboard<Stim, BudgetWindow[]>({
      dut: dutGroup,
      model: refGroupMutant
    });
    // Drive a stimulus guaranteed to produce >=1 window.
    const stim: Stim = {
      paychecks: [
        makePaycheck({ posted_date: '2026-05-09', transaction_index: 1 }),
        makePaycheck({ posted_date: '2026-05-23', transaction_index: 2 })
      ],
      anchor: { year: 2026, month: 6 }
    };
    sb.check(stim);
    expect(sb.mismatches.length).toBeGreaterThan(0); // bench detects the injected bug
    expect(() => sb.assertClean()).toThrow(/Scoreboard/);
  });

  test('a second injected bug (dropped end_date clamp) is also detected', () => {
    // Mutant: never clamp, always day-before-next (would invert on same-date triple).
    function refGroupNoClamp(stim: Stim): BudgetWindow[] {
      const sorted = [...stim.paychecks].sort(refSortKey);
      const groups: Paycheck[][] = [];
      for (let i = 0; i < sorted.length; i += 2) groups.push(sorted.slice(i, i + 2));
      return groups.map((group, i) => {
        const start_date = group[0]!.posted_date;
        const isLast = i === groups.length - 1;
        const end_date = isLast ? null : minusOneDay(groups[i + 1]![0]!.posted_date); // NO clamp
        return {
          index: i,
          budget_month: budgetMonthLabel(stim.anchor, i),
          paychecks: group,
          start_date,
          end_date,
          complete: group.length === 2
        };
      });
    }
    const sb = new Scoreboard<Stim, BudgetWindow[]>({ dut: dutGroup, model: refGroupNoClamp });
    // same-date triple makes the clamp matter
    const stim: Stim = {
      paychecks: [
        makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: 1 }),
        makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: 2 }),
        makePaycheck({ posted_date: '2026-05-23', import_index: 0, transaction_index: 3 })
      ],
      anchor: { year: 2026, month: 6 }
    };
    sb.check(stim);
    expect(sb.mismatches.length).toBeGreaterThan(0);
  });
});
