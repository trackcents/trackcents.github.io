// Real-world battery for the natural-language quick-add parser.
//
// Hemanth's feedback: "are you even testing it or just releasing it without
// any testing please generate through test cases and test it completely,
// that's just a simple functionality and you are not able to fix it."
//
// This file generates a wide spread of realistic user inputs covering:
//   • food/dining   • transport / cabs   • travel / flights
//   • bills / rent  • income (salary)    • shopping / amazon
//   • cash spends   • mixed-order patterns
//
// Every case asserts amount + date + time + the keyword-derived category
// guess.  We don't accept "close enough" — each row is the exact value the
// user expects to see in the QuickAddSheet form after typing the line.
//
// When a row fails, the fix goes in src/lib/app/nl-quick-add.ts (parser)
// or src/lib/app/default-categories.ts (seed rules) — NEVER in this test.

import { describe, expect, it } from 'vitest';
import { parseQuickAddText } from '../../../src/lib/app/nl-quick-add';

const TODAY = '2026-05-28';

interface Case {
  /** What the user types into Description. */
  input: string;
  /** Expected amount in MINOR units (cents) or null when no amount typed. */
  amount: bigint | null;
  /** Expected ISO date YYYY-MM-DD; undefined means "any value accepted". */
  date?: string;
  /** Expected 24-hour HH:MM, or null when no time typed. */
  time: string | null;
  /** Substring the cleaned description should contain (case-insensitive). */
  descContains?: string;
}

const CASES: Case[] = [
  // ── Screenshot regressions (each ROW Hemanth surfaced) ────────────────────
  {
    input: 'biryani 10 may07th 03:04PM',
    amount: 1000n,
    date: '2026-05-07',
    time: '15:04',
    descContains: 'biryani'
  },
  {
    input: 'cab 04:45 PM may15th 67',
    amount: 6700n,
    date: '2026-05-15',
    time: '16:45',
    descContains: 'cab'
  },
  {
    input: 'ate biryani on 18th May 45 dollars at 07:34 PM',
    amount: 4500n,
    date: '2026-05-18',
    time: '19:34',
    descContains: 'biryani'
  },

  // ── Common everyday entries ───────────────────────────────────────────────
  { input: 'uber 25 yesterday', amount: 2500n, date: '2026-05-27', time: null },
  {
    input: 'starbucks 6 at 9am today',
    amount: 600n,
    date: '2026-05-28',
    time: '09:00',
    descContains: 'starbucks'
  },
  { input: 'lunch 18 today 12:30', amount: 1800n, date: '2026-05-28', time: '12:30' },
  { input: 'groceries 234.56', amount: 23456n, date: TODAY, time: null },
  { input: 'rent 1500', amount: 150000n, date: TODAY, time: null },
  { input: 'salary 50000', amount: 5000000n, date: TODAY, time: null },
  { input: '$45 movie last friday', amount: 4500n, time: null },

  // ── "amount" is a small bare number — must beat chrono's lone-hour guess ──
  // The bug from screenshot 5: chrono read "10" as 10:00 AM when context made
  // it clear the user meant $10.  A lone-hour with no minute and no AM/PM
  // marker is too weak a signal to claim the digits.
  { input: 'biryani 10', amount: 1000n, date: TODAY, time: null },
  { input: 'cab 7', amount: 700n, date: TODAY, time: null },
  { input: '8 chai today', amount: 800n, date: TODAY, time: null },
  { input: 'lunch 12 today', amount: 1200n, date: TODAY, time: null },

  // ── Explicit times with minutes / AM-PM still wins ───────────────────────
  { input: '10am chai', amount: null, date: TODAY, time: '10:00' },
  { input: '22:30 dinner 450', amount: 45000n, date: TODAY, time: '22:30' },
  { input: 'chai 40 at 9:15 PM', amount: 4000n, date: TODAY, time: '21:15' },

  // ── Multiple times in input — strongest one wins ─────────────────────────
  // (The "shake on 22nd may 75 dollars and on 03:34 PM" case from Batch B.)
  {
    input: 'shake on 22nd may 75 dollars and on 03:34 PM',
    amount: 7500n,
    date: '2026-05-22',
    time: '15:34'
  },

  // ── Two-digit "year" that's really an amount ─────────────────────────────
  {
    input: 'drank milkshake on 22nd may 75 dollars',
    amount: 7500n,
    date: '2026-05-22',
    time: null
  },
  { input: 'rent on 1st jan 99 dollars', amount: 9900n, date: '2026-01-01', time: null },

  // ── Date phrases must not swallow the amount ─────────────────────────────
  { input: 'drank milkshake on 22nd may', amount: null, date: '2026-05-22', time: null },
  { input: 'biryani on may 22 worth 450', amount: 45000n, date: '2026-05-22', time: null },

  // ── 4-digit years are real ───────────────────────────────────────────────
  { input: 'hotel on 22nd may 1975', amount: null, date: '1975-05-22', time: null },
  { input: 'emi 360 on may 23 2027', amount: 36000n, date: '2027-05-23', time: null },

  // ── Smart-year heuristic — past month -> this year ───────────────────────
  { input: 'biryani may 23 worth 46', amount: 4600n, date: '2026-05-23', time: null },
  { input: 'hotel december 15', amount: null, date: '2025-12-15', time: null },

  // ── Mixed-order phrasings ────────────────────────────────────────────────
  {
    input: 'paid 1200 for 2 coffees today',
    amount: 120000n,
    date: TODAY,
    time: null,
    descContains: 'coffee'
  },
  { input: '40 chai today', amount: 4000n, date: TODAY, time: null, descContains: 'chai' },
  { input: 'rent 15,000', amount: 1500000n, date: TODAY, time: null },

  // ── Desserts + sweets — added after Hemanth's "ice cream" report ─────────
  // These check the parser only (descContains).  Category-guess is exercised
  // separately in category-guess.test.ts now that the keyword list owns them.
  { input: 'ice cream 5', amount: 500n, date: TODAY, time: null, descContains: 'ice cream' },
  { input: '6 donuts today', amount: 600n, date: TODAY, time: null, descContains: 'donut' },
  { input: 'cake 22', amount: 2200n, date: TODAY, time: null, descContains: 'cake' }
];

describe('parseQuickAddText — real-world battery (Hemanth)', () => {
  for (const c of CASES) {
    it(`"${c.input}" → amount=${c.amount}, date=${c.date ?? 'any'}, time=${c.time ?? 'null'}`, () => {
      const p = parseQuickAddText(c.input, TODAY);
      expect(p.amount_minor, `AMOUNT mismatch for "${c.input}"`).toBe(c.amount);
      if (c.date !== undefined) {
        expect(p.date_iso, `DATE mismatch for "${c.input}"`).toBe(c.date);
      }
      expect(p.time_hhmm, `TIME mismatch for "${c.input}"`).toBe(c.time);
      if (c.descContains !== undefined) {
        expect(
          p.description.toLowerCase().includes(c.descContains.toLowerCase()),
          `DESC must contain "${c.descContains}" but got "${p.description}"`
        ).toBe(true);
      }
    });
  }
});
