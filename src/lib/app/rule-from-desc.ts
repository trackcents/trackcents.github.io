/**
 * Extract a re-usable "contains" rule pattern from a transaction
 * description.  Used after the user manually picks a category in
 * QuickAddSheet so the NEXT time they type the same phrase, the live
 * guesser auto-picks the same category — Hemanth's ask: "if I select a
 * category to that, then from next time if I add that name again, the
 * same category should be selected."
 *
 * Approach: take the parser-cleaned description (date + amount already
 * stripped) and:
 *
 *   1. Strip leading consumption verbs ("ate biryani" → "biryani").
 *   2. Strip leading + trailing prepositions ("for milkshake" → "milkshake").
 *   3. Reject patterns shorter than 3 chars (too generic — would match
 *      false positives across unrelated transactions).
 *
 * The result is the user's distinctive phrase: usually a merchant or food
 * name they typed.  When the parser left nothing meaningful (e.g. user
 * typed "30 today"), we return null and no rule is created.
 *
 * Pure helper — caller persists the rule via saveCategorization.
 */

/** Leading verbs the user almost always types before the merchant.  Removed
 *  from the rule pattern so "ate biryani" generates the same rule as the
 *  plain "biryani". */
const LEADING_VERBS: ReadonlySet<string> = new Set([
  'ate',
  'drank',
  'had',
  'got',
  'paid',
  'spent',
  'bought',
  'purchased',
  'ordered',
  'eat',
  'drink',
  'drinking',
  'eating',
  'pay',
  'paying',
  'spend',
  'spending',
  'buy',
  'buying',
  'i',
  'just',
  'we',
  'a',
  'an',
  'the'
]);

const LEADING_PREPOSITIONS: ReadonlySet<string> = new Set([
  'on',
  'at',
  'for',
  'to',
  'from',
  'in',
  'of',
  'with'
]);

const TRAILING_PREPOSITIONS: ReadonlySet<string> = new Set([
  'on',
  'at',
  'for',
  'to',
  'from',
  'in',
  'of',
  'with',
  'and'
]);

/**
 * Extract a rule pattern from a description, or null when nothing usable
 * remains after cleanup.  The returned string is the LOWERCASE phrase the
 * user typed — matching is case-insensitive anyway.
 */
export function extractRulePattern(cleanedDescription: string): string | null {
  if (cleanedDescription.length === 0) return null;
  const words = cleanedDescription
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  // Strip leading verbs first ("ate biryani" → "biryani"), THEN any
  // leftover preposition ("for milkshake" → "milkshake").
  while (words.length > 0 && LEADING_VERBS.has(words[0]!)) words.shift();
  while (words.length > 0 && LEADING_PREPOSITIONS.has(words[0]!)) words.shift();
  while (words.length > 0 && TRAILING_PREPOSITIONS.has(words[words.length - 1]!)) words.pop();

  if (words.length === 0) return null;
  const pattern = words.join(' ').trim();
  // Too-short patterns ("at" alone, single letter) would match too many
  // unrelated descriptions.  Demand at least 3 chars.
  if (pattern.length < 3) return null;
  return pattern;
}

/**
 * Does the rule list already contain a rule with this pattern + category?
 * Case-insensitive substring match on the `contains` field.  Used to avoid
 * creating duplicate auto-rules on every manual pick of the same item.
 */
export function isDuplicateRule(
  rules: ReadonlyArray<{ contains?: string | undefined; category_id: string }>,
  pattern: string,
  categoryId: string
): boolean {
  const p = pattern.toLowerCase().trim();
  return rules.some(
    (r) =>
      r.contains !== undefined && r.contains.toLowerCase() === p && r.category_id === categoryId
  );
}
