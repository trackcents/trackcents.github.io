// Unit tests for the natural-language quick-add parser.  Locks in the cases
// from the design brainstorm (Hemanth's "40 chai today" / "EMI 360 on June 4"
// examples) so future tweaks can't silently regress.

import { describe, expect, it } from 'vitest';
import { parseQuickAddText } from '../../../src/lib/app/nl-quick-add';

const TODAY = '2026-05-27';

describe('parseQuickAddText', () => {
  it('parses "40 milkshake today" → 4000n, today, expense, "milkshake"', () => {
    const p = parseQuickAddText('40 milkshake today', TODAY);
    expect(p.amount_minor).toBe(4000n);
    expect(p.date_iso).toBe(TODAY);
    expect(p.direction).toBe('expense');
    expect(p.description.toLowerCase()).toContain('milkshake');
  });

  it('parses "$360 EMI on June 4" → 36000n, 2026-06-04, expense, "EMI"', () => {
    const p = parseQuickAddText('$360 EMI on June 4', TODAY);
    expect(p.amount_minor).toBe(36000n);
    expect(p.date_iso).toBe('2026-06-04');
    expect(p.direction).toBe('expense');
    // Date phrase should be stripped — "4" must NOT have been the amount.
    expect(p.description.toLowerCase()).toContain('emi');
  });

  it('treats "Salary 50000 yesterday" as income', () => {
    const p = parseQuickAddText('Salary 50000 yesterday', TODAY);
    expect(p.amount_minor).toBe(5000000n);
    expect(p.date_iso).toBe('2026-05-26');
    expect(p.direction).toBe('income');
    expect(p.description.toLowerCase()).toContain('salary');
  });

  it('treats "received 500 from dad" as income (received keyword)', () => {
    // NB: bare "got 500" is intentionally ambiguous (you can "get" coffee just
    // as easily as money), so we require an unambiguous income verb.
    const p = parseQuickAddText('received 500 from dad', TODAY);
    expect(p.amount_minor).toBe(50000n);
    expect(p.direction).toBe('income');
    expect(p.description.toLowerCase()).toContain('dad');
  });

  it('handles thousands separators: "rent 15,000"', () => {
    const p = parseQuickAddText('rent 15,000', TODAY);
    expect(p.amount_minor).toBe(1500000n);
    expect(p.description.toLowerCase()).toContain('rent');
  });

  it('handles ₹ symbol: "₹40 chai"', () => {
    const p = parseQuickAddText('₹40 chai', TODAY);
    expect(p.amount_minor).toBe(4000n);
    expect(p.description.toLowerCase()).toContain('chai');
    expect(p.description).not.toContain('₹');
  });

  it('falls back to defaultDate when no date phrase appears', () => {
    const p = parseQuickAddText('coffee 250', TODAY);
    expect(p.date_iso).toBe(TODAY);
  });

  it('returns amount_minor null when no number is present', () => {
    const p = parseQuickAddText('forgot to add the amount', TODAY);
    expect(p.amount_minor).toBeNull();
  });

  it('picks the largest numeric value when several appear', () => {
    // e.g. "paid 1200 for 2 coffees" — 1200 is the amount, not 2.
    const p = parseQuickAddText('paid 1200 for 2 coffees', TODAY);
    expect(p.amount_minor).toBe(120000n);
  });

  it('parses decimals: "12.34 lunch"', () => {
    const p = parseQuickAddText('12.34 lunch', TODAY);
    expect(p.amount_minor).toBe(1234n);
  });

  it('handles "yesterday" relative date', () => {
    const p = parseQuickAddText('uber 250 yesterday', TODAY);
    expect(p.date_iso).toBe('2026-05-26');
  });

  it('strips leading connector words from the description', () => {
    // "on" / "for" / "of" stuck at the start after stripping should be cleaned.
    const p = parseQuickAddText('150 for groceries', TODAY);
    expect(p.description.toLowerCase().startsWith('on ')).toBe(false);
    expect(p.description.toLowerCase()).toContain('groceries');
  });

  // ── Smart-year heuristic (Hemanth feedback) ─────────────────────────────
  // chrono-node with forwardDate:true picks NEXT year when a partial date
  // (no year) lands in the past.  For a money tracker that's almost always
  // wrong — entries are historical 99% of the time.  We post-process to roll
  // back one year when the parsed date lands more than ~2 months in the
  // future AND the user didn't type an explicit year.

  it('prefers current year for partial dates: "may 23" when today is May 28 2026', () => {
    const p = parseQuickAddText('ate biryani on may 23 worth $46', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-23'); // not 2027-05-23
    expect(p.amount_minor).toBe(4600n);
  });

  it('prefers current year for partial dates: "december 15" when today is January', () => {
    // December is in the recent past for someone in January — pick 2025.
    const p = parseQuickAddText('hotel december 15', '2026-01-10');
    expect(p.date_iso).toBe('2025-12-15');
  });

  it('keeps the typed year when the user is explicit', () => {
    // User explicitly typed 2027 — keep it (forward-dated transaction).
    const p = parseQuickAddText('emi 360 on may 23 2027', '2026-05-28');
    expect(p.date_iso).toBe('2027-05-23');
  });

  it('does NOT roll near-future dates back ("in 3 days" stays this year)', () => {
    // "in 3 days" from May 28 = May 31, still in the same year.  No bump.
    const p = parseQuickAddText('rent in 3 days', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-31');
  });

  // ── Time extraction (Hemanth feedback: "time is not being autopopulated") ─
  it('extracts time from "ate biryani on 23rd may 03:40 PM"', () => {
    const p = parseQuickAddText('ate biryani on 23rd may 03:40 PM for 450.56', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-23');
    expect(p.time_hhmm).toBe('15:40');
    expect(p.amount_minor).toBe(45056n);
  });

  it('extracts time from bare "10am chai" — no AM/PM ambiguity', () => {
    const p = parseQuickAddText('10am chai', TODAY);
    expect(p.time_hhmm).toBe('10:00');
  });

  it('extracts 24-hour times: "22:30 dinner"', () => {
    const p = parseQuickAddText('22:30 dinner 450', TODAY);
    expect(p.time_hhmm).toBe('22:30');
  });

  it('returns null time when the user did NOT type one', () => {
    // "may 23" by itself has only a date — chrono will default to noon, but
    // isCertain('hour') is false, so we leave time_hhmm null and let the
    // user keep their existing time field value.
    const p = parseQuickAddText('biryani on may 23 worth 450', '2026-05-28');
    expect(p.time_hhmm).toBeNull();
  });

  // ── Screenshot regressions (2026-05-28 review) ──────────────────────────
  // Three bugs Hemanth surfaced in screenshots:
  //   1. "drank milkshake on 22nd may"        → amount was $22 (took "22"
  //      from the DATE phrase).  After fix: amount null.
  //   2. "drank milkshake on 22nd may 75 dollars" → amount was $7 + date
  //      05/22/1975 (chrono read "75" as year 1975, swallowing it into
  //      the date span).  After fix: amount 75, date 2026-05-22.
  //   3. "shake on 22nd may 75 dollars and on 03:34 PM" → amount was $34
  //      (stolen from "03:34 PM" because the time was a SEPARATE chrono
  //      result and the amount filter only knew about the date span).
  //      After fix: amount 75, date 2026-05-22, time 15:34.

  it('SCREENSHOT 1: "drank milkshake on 22nd may" → no amount, date OK', () => {
    const p = parseQuickAddText('drank milkshake on 22nd may', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-22');
    expect(p.amount_minor).toBeNull(); // never claim "22" as the amount
    expect(p.description.toLowerCase()).toContain('milkshake');
  });

  it('SCREENSHOT 2: "drank milkshake on 22nd may 75 dollars" → $75 + 2026', () => {
    const p = parseQuickAddText('drank milkshake on 22nd may 75 dollars', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-22'); // NOT 1975-05-22
    expect(p.amount_minor).toBe(7500n); // 75.00
    expect(p.description.toLowerCase()).toContain('milkshake');
  });

  it('SCREENSHOT 3: "shake on 22nd may 75 dollars and on 03:34 PM" → 75 + 15:34 + 2026', () => {
    const p = parseQuickAddText('shake on 22nd may 75 dollars and on 03:34 PM', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-22');
    expect(p.amount_minor).toBe(7500n); // never steal "34" from the time
    expect(p.time_hhmm).toBe('15:34'); // multi-chrono-result extraction
    expect(p.description.toLowerCase()).toContain('shake');
  });

  it('explicit 4-digit year still wins (must not be stripped by the 2-digit fix)', () => {
    const p = parseQuickAddText('hotel on 22nd may 1975', '2026-05-28');
    expect(p.date_iso).toBe('1975-05-22');
  });

  it('"may 22" alone (day-only) still resolves to the 22nd, not stripped', () => {
    // The trailing-digit strip should only fire when chrono's INFERRED year
    // is way off (1975) — not when chrono picks the current/next year for
    // a partial date.  "may 22" with today=May 28 → next year May 22 →
    // rolled back to current year May 22 via the existing heuristic.
    const p = parseQuickAddText('biryani on may 22', '2026-05-28');
    expect(p.date_iso).toBe('2026-05-22');
  });
});
