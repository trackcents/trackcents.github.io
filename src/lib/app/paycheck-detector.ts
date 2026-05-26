// Paycheck + income detector (US-P2-D, increment 1).
//
// Foundation for the paycheck-window budgeting feature.  Scans checking /
// savings deposits and separates them into:
//   - PAYCHECKS: recurring deposits with a biweekly (≈14-day) cadence
//   - OTHER INCOME: irregular deposits (Zelle from friends, refunds, tax
//     returns, and — flagged specially — likely BONUSES)
//
// Per the design note (specs/001-money-tracker-mvp/design-paycheck-windows.md
// Step 1) and the user's clarifications on 2026-05-23:
//   - The user is paid biweekly (≈ every 14 days).
//   - Bonuses are irregular and must be tracked separately from regular pay.
//   - Detection is a SUGGESTION; the eventual UI lets the user override
//     (mark a deposit as paycheck / bonus / other).  This module produces
//     the suggestion; it does not persist or enforce anything.
//
// Pure function — same imports in, same classification out.  No side effects.
// Money stays bigint cents throughout (Constitution Principle II).

import type { ImportSuccess } from './import';
import type { ParsedTransaction } from '../adapters/types';

// ── Tunable detection thresholds (named so they're easy to adjust) ──────────

/** Inter-arrival days that count as "biweekly."  14 ± 2 covers weekends /
 *  holidays shifting a deposit by a day or two. */
const BIWEEKLY_MIN_DAYS = 12;
const BIWEEKLY_MAX_DAYS = 16;

/** Inter-arrival days that count as "semi-monthly" (1st & 15th style):
 *  ~15-16 days between the two monthly deposits, then a longer gap.  We
 *  accept this as a paycheck cadence too since some employers pay
 *  semi-monthly rather than strictly biweekly. */
const SEMIMONTHLY_MIN_DAYS = 14;
const SEMIMONTHLY_MAX_DAYS = 17;

/** A descriptor group needs at least this many deposits to be considered a
 *  recurring paycheck stream.  The design note says ≥3 over 90 days, but with
 *  the user's current ~2 months of data that's too strict — 2 occurrences
 *  with the right spacing is enough to suggest a paycheck (the user confirms). */
const MIN_OCCURRENCES = 2;

// NOTE (2026-05-24): we deliberately DO NOT try to auto-classify non-paycheck
// deposits as "bonus" vs "other".  Amount is not a reliable signal — a bonus
// can be $50 or $5000, a friend's gift or an IRS refund can be any size.  The
// ONLY thing reliably detectable from the data is biweekly recurrence
// (→ paycheck).  Everything else is "other income," and the USER labels what
// each one actually is (bonus / gift / tax refund / interest / …) in the UI.

// ── Output types ─────────────────────────────────────────────────────────────

/** Provenance pointer shared by both paycheck and income rows. */
interface DepositRef {
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // positive (a deposit)
  description: string;
  import_index: number;
  transaction_index: number;
}

export interface Paycheck extends DepositRef {
  /** Detection confidence:
   *  'high'   — ≥3 occurrences with tight biweekly spacing
   *  'medium' — exactly 2 occurrences with biweekly spacing
   *  'low'    — spacing matched semi-monthly or had some jitter */
  confidence: 'high' | 'medium' | 'low';
  /** The normalized descriptor key this paycheck was grouped under. */
  stream_key: string;
}

export interface IncomeEvent extends DepositRef {
  /** What this deposit actually is — assigned by the USER, not guessed by the
   *  detector.  Examples: 'bonus', 'gift', 'tax refund', 'interest', 'sale',
   *  'reimbursement'.  null until the user labels it.  The detector cannot
   *  infer this from the data (amount and descriptor are unreliable signals),
   *  so it always emits null and the UI prompts the user to label. */
  user_label: string | null;
}

export interface PaycheckDetectionResult {
  paychecks: Paycheck[];
  other_income: IncomeEvent[];
  /** Median inter-arrival in days across all detected paycheck streams, or
   *  null if no paycheck stream was found.  Used by the budget-month grouper
   *  later to predict 3-paycheck months. */
  detected_cadence_days: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a descriptor for grouping recurring deposits.  Strips digits,
 *  common ID tokens, and collapses whitespace so "PAYROLL ACME 0425" and
 *  "PAYROLL ACME 0509" group together. */
export function normalizeDescriptor(description: string): string {
  return description
    .toUpperCase()
    .replace(/\b(PPD|CCD|WEB|ID|CONF|REF|TRACE|ORIG|CO)\b/g, ' ') // ACH boilerplate tokens
    .replace(/\d+/g, ' ') // strip all digit runs (dates, IDs, amounts in descriptor)
    .replace(/[#*:/\\|-]+/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.UTC(
    parseInt(isoA.slice(0, 4), 10),
    parseInt(isoA.slice(5, 7), 10) - 1,
    parseInt(isoA.slice(8, 10), 10)
  );
  const b = Date.UTC(
    parseInt(isoB.slice(0, 4), 10),
    parseInt(isoB.slice(5, 7), 10) - 1,
    parseInt(isoB.slice(8, 10), 10)
  );
  return Math.round((b - a) / 86_400_000);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Is this inter-arrival list consistent with a recurring paycheck? */
function classifyCadence(interArrivals: number[]): {
  isPaycheck: boolean;
  confidence: 'high' | 'medium' | 'low';
  medianDays: number;
} {
  if (interArrivals.length === 0) {
    return { isPaycheck: false, confidence: 'low', medianDays: 0 };
  }
  const med = median(interArrivals);
  const biweekly = med >= BIWEEKLY_MIN_DAYS && med <= BIWEEKLY_MAX_DAYS;
  const semimonthly = med >= SEMIMONTHLY_MIN_DAYS && med <= SEMIMONTHLY_MAX_DAYS;

  if (!biweekly && !semimonthly) {
    return { isPaycheck: false, confidence: 'low', medianDays: med };
  }

  // Confidence scales with how many samples + how tight the spacing is.
  // interArrivals.length === N-1 where N = occurrences.
  const occurrences = interArrivals.length + 1;
  const allTight = interArrivals.every((d) => d >= BIWEEKLY_MIN_DAYS && d <= SEMIMONTHLY_MAX_DAYS);
  let confidence: 'high' | 'medium' | 'low';
  if (occurrences >= 3 && allTight && biweekly) confidence = 'high';
  else if (occurrences >= 2 && biweekly) confidence = 'medium';
  else confidence = 'low';

  return { isPaycheck: true, confidence, medianDays: med };
}

// ── Main detector ─────────────────────────────────────────────────────────────

/**
 * Detect paychecks and classify other income across all imported statements.
 *
 * Only deposits in checking / savings accounts are considered (credit-card
 * "deposits" would be payments/refunds, handled elsewhere).
 */
export function detectPaychecks(imports: ImportSuccess[]): PaycheckDetectionResult {
  // 1. Collect every positive deposit from checking / savings accounts.
  const deposits: DepositRef[] = [];
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i]!;
    const at = imp.statement.account_type;
    if (at !== 'checking' && at !== 'savings') continue;
    for (let j = 0; j < imp.transactions.length; j++) {
      const t: ParsedTransaction = imp.transactions[j]!;
      if (t.transaction_type !== 'deposit') continue;
      if (t.amount_minor <= 0n) continue; // a deposit must be a positive inflow
      deposits.push({
        posted_date: t.posted_date,
        amount_minor: t.amount_minor,
        description: t.description,
        import_index: i,
        transaction_index: j
      });
    }
  }

  if (deposits.length === 0) {
    return { paychecks: [], other_income: [], detected_cadence_days: null };
  }

  // 2. Group deposits by normalized descriptor.
  const groups = new Map<string, DepositRef[]>();
  for (const d of deposits) {
    const key = normalizeDescriptor(d.description);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  // 3. Classify each group as paycheck-stream or not.
  const paychecks: Paycheck[] = [];
  const nonPaycheckDeposits: DepositRef[] = [];
  const allStreamCadences: number[] = [];

  for (const [key, groupDeposits] of groups) {
    const sorted = [...groupDeposits].sort((a, b) =>
      a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : 0
    );

    if (sorted.length < MIN_OCCURRENCES) {
      nonPaycheckDeposits.push(...sorted);
      continue;
    }

    const interArrivals: number[] = [];
    for (let k = 1; k < sorted.length; k++) {
      interArrivals.push(daysBetween(sorted[k - 1]!.posted_date, sorted[k]!.posted_date));
    }

    const cadence = classifyCadence(interArrivals);
    if (cadence.isPaycheck) {
      allStreamCadences.push(cadence.medianDays);
      for (const d of sorted) {
        paychecks.push({ ...d, confidence: cadence.confidence, stream_key: key });
      }
    } else {
      nonPaycheckDeposits.push(...sorted);
    }
  }

  // 4. Everything that isn't a recurring paycheck is "other income."  We do
  //    NOT guess what kind (bonus / gift / refund / …) — amount and descriptor
  //    are unreliable signals, and only the user knows.  user_label is null
  //    until the user assigns it in the UI.
  const other_income: IncomeEvent[] = nonPaycheckDeposits.map((d) => ({
    ...d,
    user_label: null
  }));

  // 5. Sort outputs chronologically for stable, predictable consumption.
  paychecks.sort((a, b) =>
    a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : 0
  );
  other_income.sort((a, b) =>
    a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : 0
  );

  return {
    paychecks,
    other_income,
    detected_cadence_days: allStreamCadences.length > 0 ? median(allStreamCadences) : null
  };
}
