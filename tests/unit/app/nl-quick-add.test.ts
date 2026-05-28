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
});
