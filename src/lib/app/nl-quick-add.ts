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
  let dateStart = -1;
  let dateEnd = -1;
  if (chronoResults.length > 0) {
    const r = chronoResults[0]!;
    let d = r.date();

    // Smart year heuristic — fix for Hemanth's feedback "I type 'may 23rd'
    // and it picks 2027 even though today is May 28 2026."  Money entries
    // are historical 99% of the time; a date >60 days in the future when
    // the user didn't type a year almost certainly means LAST year, not
    // next year (chrono + forwardDate picks next year when the partial
    // date is past).  We only roll back when no explicit 4-digit year
    // was typed, so an intentional "in 2027" stays 2027.
    const userTypedYear = /\b(19|20)\d{2}\b/.test(r.text);
    const daysAhead = (d.getTime() - refDate.getTime()) / 86_400_000;
    if (!userTypedYear && daysAhead > 60) {
      d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate(), 12, 0, 0);
    }

    dateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dateStart = r.index;
    dateEnd = r.index + r.text.length;
  }

  // Pick the largest amount that doesn't overlap the date phrase (so "June 4"
  // never has "4" stolen as the amount).
  let amountMinor: bigint | null = null;
  let amountStart = -1;
  let amountEnd = -1;
  const amounts = findAmounts(text);
  const candidates = amounts.filter(
    (a) => dateStart === -1 || a.end <= dateStart || a.start >= dateEnd
  );
  if (candidates.length > 0) {
    const best = candidates.reduce((acc, m) => (m.value > acc.value ? m : acc));
    amountMinor = BigInt(Math.round(best.value * 100));
    amountStart = best.start;
    amountEnd = best.end;
  }

  // Build the description by stripping the matched date + amount spans (longest
  // span first so indices stay valid as we cut).
  const spans: [number, number][] = [];
  if (dateStart !== -1) spans.push([dateStart, dateEnd]);
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
    description: desc,
    direction
  };
}
