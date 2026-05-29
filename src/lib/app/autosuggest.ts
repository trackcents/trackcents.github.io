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
    for (const word of raw.split(/[^A-Za-z]+/)) {
      const w = word.trim();
      if (w.length < 3) continue;
      const k = w.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
  };
  for (const n of categoryNames) add(n);
  for (const n of accountNames) add(n);
  for (const t of COMMON_TERMS) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
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
  // Only complete when actively typing a word at the very end (>= 2 letters,
  // and not right after a space/number).
  const m = text.match(/([A-Za-z]{2,})$/);
  if (m === null) return null;
  const lastWord = m[1]!;
  const lower = lastWord.toLowerCase();

  let best: string | null = null;
  for (const term of terms) {
    const t = term.toLowerCase();
    if (t.length <= lower.length) continue; // must add at least one char
    if (!t.startsWith(lower)) continue;
    // Prefer the shortest matching term (the most likely / least surprising).
    if (best === null || term.length < best.length) best = term;
  }
  if (best === null) return null;

  const suffix = best.slice(lastWord.length);
  if (suffix.length === 0) return null;
  // Append to what they typed so their own casing is preserved
  // ("Cof" + "fee" → "Coffee").
  return { suffix, accepted: text + suffix };
}
