/**
 * Inline autosuggest (ghost-text) for the quick-add description — like Gmail
 * "Smart Compose" / iOS QuickType. As you type the LAST word, we suggest a
 * completion drawn from your own categories, sub-categories, accounts, plus a
 * small list of common spend words, shown greyed-out after the cursor;
 * accepting (Tab / → / the ⇥ button) fills it in.
 *
 * Hemanth's ask (2026-05-29): "if I type cof it will [show] fee in grey and if
 * I swipe it will be filled."
 *
 * Pure / on-device / deterministic.
 */

/** Common things people type, so suggestions work even before the user has a
 *  matching category. Lower-case canonical form. */
const COMMON_TERMS: readonly string[] = [
  'coffee',
  'chai',
  'tea',
  'breakfast',
  'lunch',
  'dinner',
  'brunch',
  'snacks',
  'biryani',
  'pizza',
  'burger',
  'sandwich',
  'groceries',
  'vegetables',
  'fruits',
  'restaurant',
  'cab',
  'uber',
  'auto',
  'bus',
  'train',
  'metro',
  'petrol',
  'fuel',
  'parking',
  'toll',
  'rent',
  'mortgage',
  'electricity',
  'water',
  'internet',
  'phone',
  'recharge',
  'subscription',
  'netflix',
  'spotify',
  'medicine',
  'pharmacy',
  'doctor',
  'shopping',
  'clothes',
  'gift',
  'salary',
  'interest',
  'refund',
  'transfer',
  'withdrawal'
];

/**
 * Build the suggestion dictionary from the user's own data plus the common
 * list. Multi-word names are split into words (so "Phone & Internet" →
 * "phone","internet"; "HDFC UPI" → "hdfc","upi"). De-duped, case-insensitive,
 * user terms first so they win the shortest-match tie-break.
 */
export function buildSuggestTerms(
  categoryNames: readonly string[],
  accountNames: readonly string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string): void => {
    const w = raw.trim();
    if (w.length < 3) return;
    const k = w.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(w);
  };
  // Keep FULL names (not split into words) so a multi-word name like "Milk
  // Shake" is suggested whole — Hemanth: typing "Mi" should offer "Milk Shake",
  // not just "Milk". User names first so they win the shortest-match tie-break.
  for (const n of categoryNames) add(n);
  for (const n of accountNames) add(n);
  for (const t of COMMON_TERMS) add(t);
  return out;
}

export interface Suggestion {
  /** The greyed-out completion to show after the typed text. */
  suffix: string;
  /** The full description text after accepting (typed text + suffix). */
  accepted: string;
}

/**
 * Suggest a completion for the LAST word being typed.
 * @returns the suggestion, or null when there's nothing useful to offer.
 */
export function suggestCompletion(text: string, terms: readonly string[]): Suggestion | null {
  // Only complete while actively typing a word (the text ends in a letter).
  if (text.length === 0 || !/[A-Za-z]$/.test(text)) return null;

  // Candidate "typed prefixes": the trailing text starting at each word
  // boundary, longest first (whole trailing phrase → … → last word). This lets
  // a multi-word name like "Milk Shake" complete from "Mi" OR from "milk sh",
  // winning over the single word "Milk".
  const starts: number[] = [0];
  for (let i = 1; i < text.length; i++) {
    if (/\s/.test(text[i - 1]!) && !/\s/.test(text[i]!)) starts.push(i);
  }

  for (const start of starts) {
    const typed = text.slice(start);
    if (typed.replace(/\s/g, '').length < 2) continue; // need >= 2 letters
    const lower = typed.toLowerCase();
    let best: string | null = null;
    for (const term of terms) {
      const t = term.toLowerCase();
      if (t.length <= lower.length) continue; // must add at least one char
      if (!t.startsWith(lower)) continue;
      // Prefer the shortest matching term (least surprising).
      if (best === null || term.length < best.length) best = term;
    }
    if (best !== null) {
      const suffix = best.slice(typed.length);
      // Append to what they typed so their casing is preserved ("Mi" + "lk
      // Shake" → "Milk Shake").
      if (suffix.length > 0) return { suffix, accepted: text + suffix };
    }
  }
  return null;
}
