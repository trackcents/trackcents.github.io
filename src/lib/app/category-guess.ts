/**
 * Best-effort category guesser for the quick-add flow.
 *
 * The whole point of this is that typing "chai 40" should fill the Food
 * category for you — not make you tap through a category list every time.
 *
 * Strategy (in order, first match wins):
 *   1. The user's own RULES (`firstMatchingRule`).  These are the strongest
 *      signal because the user explicitly set them up via /categories.
 *   2. A small built-in keyword → category-name map for common merchants
 *      across both India (chai, biryani, ola, EMI) and the US (Starbucks,
 *      Uber, Costco) — matched against the user's own category names so we
 *      never invent a category the user doesn't have.
 *
 * Returns `null` when nothing matches — the form falls back to "Uncategorized"
 * and the user can pick from the dropdown.  This module is pure / on-device /
 * deterministic — and treated as a SUGGESTION the user can override, never
 * applied silently to money math.
 */
import { firstMatchingRule, type Category, type CategoryRule } from './categorization';

/** Map of "intent" → keywords that imply it.  Intent name is then matched
 *  against the user's category names with a tolerant substring check. */
const INTENT_KEYWORDS: Record<string, string[]> = {
  food: [
    'chai',
    'coffee',
    'tea',
    'biryani',
    'lunch',
    'dinner',
    'breakfast',
    'snack',
    'milkshake',
    'restaurant',
    'cafe',
    'starbucks',
    'pizza',
    'burger',
    'meal',
    'food',
    'swiggy',
    'zomato',
    'doordash',
    'ubereats'
  ],
  groceries: [
    'groceries',
    'grocery',
    'bigbasket',
    'safeway',
    'kroger',
    'walmart',
    'costco',
    'target',
    'supermarket',
    'instacart',
    'whole foods'
  ],
  transport: [
    'uber',
    'ola',
    'lyft',
    'metro',
    'bus',
    'train',
    'taxi',
    'auto',
    'rickshaw',
    'petrol',
    'gas',
    'fuel',
    'parking',
    'toll'
  ],
  housing: ['rent', 'mortgage', 'maintenance'],
  loans: ['emi', 'loan'],
  shopping: [
    'amazon',
    'flipkart',
    'shopping',
    'mall',
    'clothes',
    'apparel',
    'ebay',
    'etsy',
    'myntra'
  ],
  health: ['gym', 'doctor', 'medicine', 'pharmacy', 'hospital', 'medical', 'clinic'],
  entertainment: [
    'netflix',
    'spotify',
    'youtube',
    'movie',
    'concert',
    'cinema',
    'amazon prime',
    'disney',
    'hbo'
  ],
  bills: ['electricity', 'water', 'wifi', 'internet', 'phone', 'bill', 'utility', 'gas bill'],
  income: ['salary', 'bonus', 'paycheck', 'pay check', 'refund', 'wage', 'stipend', 'cashback']
};

function matchIntent(text: string): string | null {
  const lower = ` ${text.toLowerCase()} `;
  let bestIntent: string | null = null;
  let bestScore = 0;
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      // Word-bounded substring — "rent" inside "current" must not match.
      const padded = ` ${kw.toLowerCase()} `;
      if (lower.includes(padded)) score++;
      // Also match at the boundary of a longer hyphen/quote/punctuation chunk.
      else if (
        new RegExp(`(?:^|[\\s.,!?$₹\\-])${kw.toLowerCase()}(?:$|[\\s.,!?\\-])`, 'i').test(text)
      ) {
        score++;
      }
    }
    if (score > bestScore) {
      bestIntent = intent;
      bestScore = score;
    }
  }
  return bestIntent;
}

/**
 * Find the best category for a description.
 *
 * @returns the matched category's id, or `null` when nothing fits.
 */
export function guessCategoryId(
  description: string,
  categories: Category[],
  rules: CategoryRule[]
): string | null {
  const desc = description.trim();
  if (desc.length === 0) return null;

  // 1. The user's own rules — strongest signal because they wrote them.
  const ruleMatch = firstMatchingRule(rules, desc);
  if (ruleMatch !== null) return ruleMatch.category_id;

  // 2. Intent keyword fallback → resolved against the user's category names.
  const intent = matchIntent(desc);
  if (intent === null) return null;
  const intentLower = intent.toLowerCase();
  const cat = categories.find((c) => c.name.toLowerCase().includes(intentLower));
  return cat?.id ?? null;
}
