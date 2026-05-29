/**
 * Natural-language quick-add parser.
 *
 * Turns a one-line user sentence ("40 chai today", "₹360 EMI on June 4",
 * "Salary 50000 yesterday") into a structured draft transaction the user can
 * confirm.  Pure on-device — no AI, no cloud — combining:
 *
 *   • `chrono-node` for human dates ("today", "yesterday", "last Friday",
 *     "June 4", "2026-05-27", "in 3 days", "next Monday", …)
 *   • a tight currency-aware amount regex (largest numeric token wins,
 *     never the year/day that chrono already claimed).
 *   • a small keyword list to detect income vs expense direction.
 *
 * Returns a draft for the entry form to pre-fill — the user always sees and
 * confirms the result, so a misparse costs ONE tap, never a wrong balance.
 * Money math itself stays exact and rule-based; this parser only fills the
 * form, never the math.
 */
import * as chrono from 'chrono-node';

export interface ParsedQuickAdd {
  /** Magnitude as bigint MINOR units (cents/paise); null if no amount detected. */
  amount_minor: bigint | null;
  /** ISO YYYY-MM-DD; falls back to `defaultDateIso` when no date phrase found. */
  date_iso: string;
  /** 24-hour "HH:MM" when the user typed a time (e.g. "03:40 PM" / "10am");
   *  null when the parsed date phrase didn't include a time. */
  time_hhmm: string | null;
  /** Original text with the matched amount + date phrases stripped, trimmed. */
  description: string;
  /** `income` when income-leaning keywords appear; `expense` is the default. */
  direction: 'expense' | 'income';
}

// Income hints — any one of these flips direction to "income".  Order doesn't
// matter; word-boundaries keep "earned" from matching "learned" etc.
const INCOME_HINTS =
  /\b(salary|paycheck|pay[\s-]?check|received|got\s+paid|bonus|refund|earned|income|cashback|stipend|allowance|reimbursement)\b/i;

// Currency-aware amount: optional symbol, then a number with optional thousands
// separators (comma or thin space) and up to 2 decimals.  We capture the digits.
const AMOUNT_RE = /(?:[₹$€£¥]\s*)?(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

interface AmountMatch {
  value: number;
  start: number;
  end: number;
}

function findAmounts(text: string): AmountMatch[] {
  const out: AmountMatch[] = [];
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    const raw = m[1]!.replace(/[\s,]/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) continue;
    out.push({ value: v, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Parse a natural-language transaction line.
 *
 * @param text           User-typed line. Any reasonable casing/spacing.
 * @param defaultDateIso ISO YYYY-MM-DD used when the text contains no date
 *                       phrase (typically `today()` — the device-local date).
 */
export function parseQuickAddText(text: string, defaultDateIso: string): ParsedQuickAdd {
  const direction: 'expense' | 'income' = INCOME_HINTS.test(text) ? 'income' : 'expense';

  // Anchor chrono at noon LOCAL on the default date so DST / timezone edges
  // don't tip the parsed day. `forwardDate: true` resolves naked "Friday" as
  // the nearest upcoming Friday — what the user usually means for weekdays.
  const refDate = new Date(`${defaultDateIso}T12:00:00`);
  const chronoResults = chrono.parse(text, refDate, { forwardDate: true });

  let dateIso = defaultDateIso;
  let timeHhmm: string | null = null;
  /** Every chrono span — used to exclude amounts that fall inside ANY
   *  date/time phrase (not just the first one).  The screenshot bug 3
   *  was caused by only filtering against the first span: chrono
   *  returned ["22nd may 75" (date), "03:34 PM" (time)] as two separate
   *  results and the "3"/"34" inside the time span leaked into the
   *  amount because the filter only knew about the date. */
  const chronoSpans: Array<[number, number]> = [];

  if (chronoResults.length > 0) {
    const r0 = chronoResults[0]!;
    let d = r0.date();
    const dateStart = r0.index;
    let dateEnd = r0.index + r0.text.length;

    // ── Year heuristic (handles BOTH directions of "wrong" 2-digit years) ──
    //
    // 1. Explicit 4-digit year (e.g. "may 23 2027") → trust it.
    // 2. No 4-digit year, but chrono inferred a year > 5 years away from
    //    today → almost certainly chrono's 2-digit-year rule firing on
    //    what the user intended as an AMOUNT (Hemanth's "22nd may 75
    //    dollars" → chrono read 1975, swallowing "75" into the date span
    //    so the amount fell back to "34" stolen from "03:34 PM").  Reset
    //    the year to today's AND shrink the date span so the trailing
    //    "75" can be re-claimed by the amount logic.
    // 3. Past-month-this-year heuristic still applies (forwardDate=true
    //    picks NEXT year for "may 23" when today is May 28 → roll back).
    const has4DigitYear = /\b(19|20)\d{2}\b/.test(r0.text);
    const refYear = refDate.getFullYear();
    const parsedYear = d.getFullYear();
    if (!has4DigitYear && Math.abs(parsedYear - refYear) > 5) {
      // The "75" / "27" trailing the date phrase was chrono's 2-digit-year
      // inference, not a real year.  Shrink the span to strip it; reset
      // the year to refYear.
      const trailing = r0.text.match(/\s+\d{1,2}\s*$/);
      if (trailing) {
        const beforeDigits = r0.text.slice(0, r0.text.length - trailing[0].length);
        dateEnd = r0.index + beforeDigits.length;
      }
      d = new Date(refYear, d.getMonth(), d.getDate(), 12, 0, 0);
    }
    const daysAhead = (d.getTime() - refDate.getTime()) / 86_400_000;
    if (!has4DigitYear && daysAhead > 60) {
      d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), 12, 0, 0);
    }

    dateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    chronoSpans.push([dateStart, dateEnd]);

    // ── Time extraction across ALL chrono results ─────────────────────────
    // chrono.parse may return separate results for date and time (e.g.
    // "22nd may 75" + "03:34 PM" come back as two results).  Scan every
    // result for the first one carrying an explicit hour; if none, leave
    // time null (the description had no time phrase the user typed).
    for (const cr of chronoResults) {
      if (!cr.start.isCertain('hour')) continue;
      const hh = cr.start.get('hour');
      const mm = cr.start.get('minute') ?? 0;
      if (hh !== null && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        timeHhmm = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        break;
      }
    }

    // Record every chrono span (date AND time) so the amount filter
    // excludes digits inside any of them.
    for (let i = 1; i < chronoResults.length; i++) {
      const cr = chronoResults[i]!;
      chronoSpans.push([cr.index, cr.index + cr.text.length]);
    }
  }

  // Pick the largest amount that doesn't overlap ANY chrono span (so
  // "June 4" never has "4" stolen as the amount, AND "03:34 PM" never
  // has "34" stolen either).
  let amountMinor: bigint | null = null;
  let amountStart = -1;
  let amountEnd = -1;
  const amounts = findAmounts(text);
  const candidates = amounts.filter((a) => !chronoSpans.some(([s, e]) => a.end > s && a.start < e));
  if (candidates.length > 0) {
    const best = candidates.reduce((acc, m) => (m.value > acc.value ? m : acc));
    amountMinor = BigInt(Math.round(best.value * 100));
    amountStart = best.start;
    amountEnd = best.end;
  }

  // Build the description by stripping every span (longest span first so
  // indices stay valid as we cut).  Now strips EVERY chrono span — date,
  // time, and the amount.
  const spans: [number, number][] = [...chronoSpans];
  if (amountStart !== -1) spans.push([amountStart, amountEnd]);
  spans.sort((a, b) => b[0] - a[0]);
  let desc = text;
  for (const [s, e] of spans) desc = desc.slice(0, s) + desc.slice(e);
  // Tidy: drop stray currency symbols, collapse whitespace, strip leading
  // connector words that don't read well after the stripping ("on", "for", "of").
  desc = desc
    .replace(/[₹$€£¥]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:on|for|of|at|to|from|in)\s+/i, '')
    .replace(/\s+(?:on|for|of|at|to)$/i, '')
    .trim();

  if (desc.length === 0) desc = direction === 'income' ? 'Income' : 'Expense';

  return {
    amount_minor: amountMinor,
    date_iso: dateIso,
    time_hhmm: timeHhmm,
    description: desc,
    direction
  };
}
