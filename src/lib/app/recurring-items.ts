/**
 * Recurring bills + subscriptions — USER-OWNED model (spec 002-income-pockets
 * §7.5–§7.10). This REPLACES the old auto-detected "we spotted these repeating"
 * list (which produced nonsense like "Western Union · Weekly · $43,413/yr"). The
 * user owns the list entirely: they add each bill/subscription, set its amount,
 * default pocket, cadence and first due date, and mark it paid deliberately.
 *
 * Pure logic only — no storage, no UI, no Date.now(). Money is bigint cents.
 *
 * A "bill" and a "subscription" share the same shape; `kind` only drives which
 * section + iconography the UI shows. Each item tracks its CURRENT cycle inline:
 *   - `amount_minor` — the full amount expected this cycle (editable at pay time)
 *   - `paid_minor`   — how much has been paid toward this cycle (0 = unpaid)
 *   - `paid_date`    — the latest payment date this cycle (null = unpaid)
 *   - `due_date`     — when this cycle is due
 * Partial payments accumulate into `paid_minor`; a full payment of a recurring
 * item can be rolled to the next cycle (deliberately) via `startNextCycle`.
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

export interface RecurringItem {
  id: string;
  kind: RecurringKind;
  name: string;
  /** Emoji or brand-icon key shown on the row. */
  logo?: string;
  /** Full amount of the CURRENT cycle, in cents. Editable at pay time. */
  amount_minor: bigint;
  /** Pocket id this is paid from by default (e.g. 'paychecks'). */
  paid_from: string;
  cadence: Cadence;
  /** ISO YYYY-MM-DD — when the current cycle is due. */
  due_date: string;
  /** Paid toward the current cycle, in cents (0 = unpaid). */
  paid_minor: bigint;
  /** ISO date of the latest payment this cycle, or null when unpaid. */
  paid_date: string | null;
  /** Sort order within its section (lower first). */
  order: number;
  /** Soft-removed by the user (kept out of all views/totals). */
  archived?: boolean;
}

export type RecurringStatus = 'due' | 'overdue' | 'partial' | 'paid';

/** Cents still owed this cycle (floored at 0 — overpayment never goes negative). */
export function remainingMinor(item: Pick<RecurringItem, 'amount_minor' | 'paid_minor'>): bigint {
  const r = item.amount_minor - item.paid_minor;
  return r > 0n ? r : 0n;
}

/** Cents counted as paid this cycle (capped at the cycle amount). */
export function paidThisCycleMinor(
  item: Pick<RecurringItem, 'amount_minor' | 'paid_minor'>
): bigint {
  return item.paid_minor > item.amount_minor ? item.amount_minor : item.paid_minor;
}

/**
 * Derive the display status from the current-cycle figures + today's date.
 *   paid     — fully covered (paid_minor ≥ amount, amount > 0)
 *   partial  — some but not all paid
 *   overdue  — nothing paid and the due date is in the past
 *   due      — nothing paid and the due date is today or future
 * Pure; `todayIso` is injected so this never reads the clock.
 */
export function deriveStatus(
  item: Pick<RecurringItem, 'amount_minor' | 'paid_minor' | 'due_date'>,
  todayIso: string
): RecurringStatus {
  if (item.amount_minor > 0n && item.paid_minor >= item.amount_minor) return 'paid';
  if (item.paid_minor > 0n) return 'partial';
  if (item.due_date < todayIso) return 'overdue';
  return 'due';
}

export interface SectionTotals {
  /** Total expected this cycle across the section (= paid + left). */
  dueMinor: bigint;
  /** Total paid this cycle (each item capped at its amount). */
  paidMinor: bigint;
  /** Total still owed this cycle. */
  leftMinor: bigint;
}

/** Sum a section's due / paid / left (skips archived items). Conserves: due = paid + left. */
export function sectionTotals(items: readonly RecurringItem[]): SectionTotals {
  let dueMinor = 0n;
  let paidMinor = 0n;
  let leftMinor = 0n;
  for (const it of items) {
    if (it.archived === true) continue;
    dueMinor += it.amount_minor;
    paidMinor += paidThisCycleMinor(it);
    leftMinor += remainingMinor(it);
  }
  return { dueMinor, paidMinor, leftMinor };
}

/** Inputs from the "Mark paid" sheet. */
export interface PaymentInput {
  /** The (possibly edited) full amount of the cycle, in cents. */
  totalMinor: bigint;
  /** How much to pay right now, in cents (defaults to the remaining amount). */
  payingNowMinor: bigint;
  /** Pocket the payment is drawn from. */
  paidFrom: string;
  /** ISO date the payment was made. */
  paidOn: string;
}

/**
 * Apply a (possibly partial) payment to an item, returning a NEW item (pure).
 * Sets the cycle total to the edited amount, adds the paid amount onto
 * `paid_minor`, and records the pocket + date. Negative `payingNowMinor` is
 * floored at 0 (you cannot un-pay by paying a negative).
 */
export function applyPayment(item: RecurringItem, input: PaymentInput): RecurringItem {
  const add = input.payingNowMinor > 0n ? input.payingNowMinor : 0n;
  return {
    ...item,
    amount_minor: input.totalMinor,
    paid_minor: item.paid_minor + add,
    paid_date: input.paidOn,
    paid_from: input.paidFrom
  };
}

/** Reverse all payments for the current cycle (the "Mark unpaid" action). Pure. */
export function markUnpaid(item: RecurringItem): RecurringItem {
  return { ...item, paid_minor: 0n, paid_date: null };
}

/**
 * Advance an ISO date by a cadence, clamping the day to the target month's last
 * day (so the 31st of a month rolls to the 28th/30th, never spills over). Pure,
 * UTC-based. `once` returns the date unchanged.
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

/**
 * Roll a fully-paid RECURRING item into its next cycle: advance the due date by
 * the cadence and reset the paid figures. A `once` item has no next cycle and is
 * returned unchanged (the caller keeps it 'paid' or archives it). Pure.
 */
export function startNextCycle(item: RecurringItem): RecurringItem {
  if (item.cadence === 'once') return item;
  return {
    ...item,
    due_date: advanceDueDate(item.due_date, item.cadence),
    paid_minor: 0n,
    paid_date: null
  };
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
