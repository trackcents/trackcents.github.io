/**
 * Recurring bills + subscriptions — USER-OWNED, MONTH-AWARE model (spec
 * 002-income-pockets §7.5–§7.10). The user owns the list entirely: they add each
 * bill/subscription, set its amount, default pocket, cadence and first due date,
 * and mark it paid deliberately — per month.
 *
 * WHY a payment HISTORY (not a single current cycle): the user asked to "jump
 * between months and check — in February what bills did I pay for?" and to add a
 * forgotten bill to a past month. A single inline cycle (the old paid_minor /
 * paid_date) loses last month's payment the moment you roll forward, so it cannot
 * answer "what did I pay in February". Each payment is therefore recorded against
 * the BUDGET MONTH it covers, and every status / total is derived for a month.
 *
 * Pure logic only — no storage, no UI, no Date.now(). Money is bigint cents.
 *
 * Each item carries:
 *   - `amount_minor` — the standard amount expected each cycle (edited via "Edit",
 *     NOT at pay time — paying a different amount is just a smaller `payingNow`).
 *   - `due_date`     — the ANCHOR: its day-of-month is the due day every cycle, and
 *     its month is the FIRST month the item is active. It does NOT roll forward;
 *     each month computes its own due-instance from this anchor + the cadence.
 *   - `payments[]`   — history; each entry is tagged with the `month` it covers.
 */

export type RecurringKind = 'bill' | 'subscription';

/** Built-in cadences plus a custom "every N units". `once` = no repeat. */
export type CadencePreset = 'once' | 'monthly' | 'every_3_months' | 'every_6_months' | 'yearly';
export type CadenceUnit = 'days' | 'weeks' | 'months' | 'years';
export interface CustomCadence {
  every: number;
  unit: CadenceUnit;
}
export type Cadence = CadencePreset | CustomCadence;

/** One recorded payment toward an item, tagged with the budget month it covers. */
export interface PaymentRecord {
  /** Budget month this payment is FOR, 'YYYY-MM'. */
  month: string;
  /** Amount paid, in cents (positive). */
  amount_minor: bigint;
  /** ISO YYYY-MM-DD the payment was actually made. */
  paid_date: string;
  /** Pocket id the payment was drawn from. */
  paid_from: string;
}

export interface RecurringItem {
  id: string;
  kind: RecurringKind;
  name: string;
  /** Emoji or brand-icon key shown on the row. */
  logo?: string;
  /** Standard amount expected each cycle, in cents. */
  amount_minor: bigint;
  /** Pocket id this is paid from by default (e.g. 'paychecks'). */
  paid_from: string;
  cadence: Cadence;
  /** ISO YYYY-MM-DD anchor — its DAY is the due day; its MONTH is the first active month. */
  due_date: string;
  /** Full payment history, tagged by budget month. */
  payments: PaymentRecord[];
  /** Sort order within its section (lower first). */
  order: number;
  /** Soft-removed by the user (kept out of all views/totals). */
  archived?: boolean;
}

export type RecurringStatus = 'due' | 'overdue' | 'partial' | 'paid';

// ── month helpers ───────────────────────────────────────────────────────────

/** 'YYYY-MM' month key of an ISO date (or any 'YYYY-MM…' string). */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Whole months from month `a` to month `b` ('YYYY-MM'); negative if b precedes a. */
function monthsBetween(a: string, b: string): number {
  const ay = Number.parseInt(a.slice(0, 4), 10);
  const am = Number.parseInt(a.slice(5, 7), 10);
  const by = Number.parseInt(b.slice(0, 4), 10);
  const bm = Number.parseInt(b.slice(5, 7), 10);
  return (by - ay) * 12 + (bm - am);
}

/**
 * The cadence's stride in whole months, or null for sub-monthly cadences
 * (custom days / weeks) which recur at least once a month.
 */
function cadenceMonthStride(c: Cadence): number | null {
  if (c === 'once') return 1; // handled specially by isActiveInMonth (only its own month)
  if (c === 'monthly') return 1;
  if (c === 'every_3_months') return 3;
  if (c === 'every_6_months') return 6;
  if (c === 'yearly') return 12;
  if (c.unit === 'months') return Math.max(1, Math.trunc(c.every));
  if (c.unit === 'years') return Math.max(1, Math.trunc(c.every)) * 12;
  return null; // days / weeks
}

/**
 * Does this item have a due-instance in `month` ('YYYY-MM')? A `once` item is
 * active only in its own month; a recurring item is active on its cadence grid
 * from its first month onward. Sub-monthly custom cadences (days/weeks) are
 * treated as active every month from the start (month-browsing shows one row).
 */
export function isActiveInMonth(
  item: Pick<RecurringItem, 'due_date' | 'cadence'>,
  month: string
): boolean {
  const start = monthOf(item.due_date);
  const diff = monthsBetween(start, month);
  if (diff < 0) return false;
  if (item.cadence === 'once') return diff === 0;
  const stride = cadenceMonthStride(item.cadence);
  if (stride === null) return true; // sub-monthly: every month
  return diff % stride === 0;
}

/** The due date (ISO) for `month`: the anchor's day clamped to that month's length. */
export function dueDateInMonth(item: Pick<RecurringItem, 'due_date'>, month: string): string {
  const day = Number.parseInt(item.due_date.slice(8, 10), 10);
  const y = Number.parseInt(month.slice(0, 4), 10);
  const m = Number.parseInt(month.slice(5, 7), 10); // 1-based
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** Cents paid toward `month` (sum of that month's payment records). */
export function paidInMonth(item: Pick<RecurringItem, 'payments'>, month: string): bigint {
  let s = 0n;
  for (const p of item.payments) if (p.month === month) s += p.amount_minor;
  return s;
}

/** Payment records for `month`, newest payment last (insertion order). */
export function paymentsInMonth(
  item: Pick<RecurringItem, 'payments'>,
  month: string
): PaymentRecord[] {
  return item.payments.filter((p) => p.month === month);
}

/** The latest payment recorded for `month`, or null. */
export function latestPaymentInMonth(
  item: Pick<RecurringItem, 'payments'>,
  month: string
): PaymentRecord | null {
  const inMonth = paymentsInMonth(item, month);
  return inMonth.length > 0 ? inMonth[inMonth.length - 1]! : null;
}

/** Cents still owed for `month` (floored at 0 — overpayment never goes negative). */
export function remainingInMonth(
  item: Pick<RecurringItem, 'amount_minor' | 'payments'>,
  month: string
): bigint {
  const r = item.amount_minor - paidInMonth(item, month);
  return r > 0n ? r : 0n;
}

/** Cents counted as paid for `month` (capped at the cycle amount). */
export function paidCappedInMonth(
  item: Pick<RecurringItem, 'amount_minor' | 'payments'>,
  month: string
): bigint {
  const paid = paidInMonth(item, month);
  return paid > item.amount_minor ? item.amount_minor : paid;
}

/**
 * Status of an item FOR a given month:
 *   paid     — fully covered for the month (paid ≥ amount, amount > 0)
 *   partial  — some but not all paid
 *   overdue  — nothing paid and the month's due date is in the past
 *   due      — nothing paid and the due date is today or future
 * Pure; `todayIso` is injected so this never reads the clock.
 */
export function statusInMonth(
  item: Pick<RecurringItem, 'amount_minor' | 'due_date' | 'payments'>,
  month: string,
  todayIso: string
): RecurringStatus {
  const paid = paidInMonth(item, month);
  if (item.amount_minor > 0n && paid >= item.amount_minor) return 'paid';
  if (paid > 0n) return 'partial';
  if (dueDateInMonth(item, month) < todayIso) return 'overdue';
  return 'due';
}

export interface SectionTotals {
  /** Total expected for the month across the section (= paid + left). */
  dueMinor: bigint;
  /** Total paid for the month (each item capped at its amount). */
  paidMinor: bigint;
  /** Total still owed for the month. */
  leftMinor: bigint;
}

/**
 * Sum a section's due / paid / left for `month` — only items ACTIVE in that
 * month and not archived. Conserves: due = paid + left.
 */
export function sectionTotalsForMonth(
  items: readonly RecurringItem[],
  month: string
): SectionTotals {
  let dueMinor = 0n;
  let paidMinor = 0n;
  let leftMinor = 0n;
  for (const it of items) {
    if (it.archived === true) continue;
    if (!isActiveInMonth(it, month)) continue;
    dueMinor += it.amount_minor;
    paidMinor += paidCappedInMonth(it, month);
    leftMinor += remainingInMonth(it, month);
  }
  return { dueMinor, paidMinor, leftMinor };
}

/** Inputs from the "Mark paid" sheet — a payment toward ONE budget month. */
export interface PaymentInput {
  /** Budget month being paid, 'YYYY-MM'. */
  month: string;
  /** How much to pay right now, in cents (defaults to the remaining amount). */
  payingNowMinor: bigint;
  /** Pocket the payment is drawn from. */
  paidFrom: string;
  /** ISO date the payment was made. */
  paidOn: string;
}

/**
 * Record a (possibly partial) payment toward `input.month`, returning a NEW item
 * (pure). Appends a payment record and updates the default pocket. A non-positive
 * `payingNowMinor` records nothing (you cannot un-pay by paying ≤ 0).
 */
export function applyPayment(item: RecurringItem, input: PaymentInput): RecurringItem {
  if (input.payingNowMinor <= 0n) return item;
  const record: PaymentRecord = {
    month: input.month,
    amount_minor: input.payingNowMinor,
    paid_date: input.paidOn,
    paid_from: input.paidFrom
  };
  return {
    ...item,
    paid_from: input.paidFrom,
    payments: [...item.payments, record]
  };
}

/** Remove all payments recorded for `month` (the "Mark unpaid" action). Pure. */
export function unpayMonth(item: RecurringItem, month: string): RecurringItem {
  return { ...item, payments: item.payments.filter((p) => p.month !== month) };
}

/**
 * Advance an ISO date by a cadence, clamping the day to the target month's last
 * day (so the 31st of a month rolls to the 28th/30th, never spills over). Pure,
 * UTC-based. `once` returns the date unchanged. Still used for the "next due"
 * hint in the add/edit sheet and by the statement-based suggestion engine.
 */
export function advanceDueDate(due: string, cadence: Cadence): string {
  const y = Number.parseInt(due.slice(0, 4), 10);
  const m = Number.parseInt(due.slice(5, 7), 10); // 1-based
  const d = Number.parseInt(due.slice(8, 10), 10);

  let addDays = 0;
  let addMonths = 0;
  if (cadence === 'once') return due;
  else if (cadence === 'monthly') addMonths = 1;
  else if (cadence === 'every_3_months') addMonths = 3;
  else if (cadence === 'every_6_months') addMonths = 6;
  else if (cadence === 'yearly') addMonths = 12;
  else {
    const n = Math.max(1, Math.trunc(cadence.every));
    if (cadence.unit === 'days') addDays = n;
    else if (cadence.unit === 'weeks') addDays = n * 7;
    else if (cadence.unit === 'months') addMonths = n;
    else addMonths = n * 12;
  }

  if (addDays > 0) {
    const t = Date.UTC(y, m - 1, d) + addDays * 86_400_000;
    const dt = new Date(t);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  const totalMonths = y * 12 + (m - 1) + addMonths;
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths % 12; // 0-based
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return iso(ny, nm + 1, nd);
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The next due date a recurring item WOULD roll to (for "next due …" hints). */
export function nextDueDate(item: Pick<RecurringItem, 'due_date' | 'cadence'>): string | null {
  if (item.cadence === 'once') return null;
  return advanceDueDate(item.due_date, item.cadence);
}

/** Human label for a cadence (UI). */
export function cadenceLabel(cadence: Cadence): string {
  if (cadence === 'once') return 'One-time';
  if (cadence === 'monthly') return 'Monthly';
  if (cadence === 'every_3_months') return 'Every 3 months';
  if (cadence === 'every_6_months') return 'Every 6 months';
  if (cadence === 'yearly') return 'Yearly';
  const n = cadence.every;
  const unit = n === 1 ? cadence.unit.replace(/s$/, '') : cadence.unit;
  return `Every ${n} ${unit}`;
}
