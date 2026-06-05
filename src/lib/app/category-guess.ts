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
    'brunch',
    'snack',
    'snacks',
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
    'ubereats',
    // Indian / South-Asian staples (Bhargav's typing patterns).
    'tiffin',
    'idli',
    'dosa',
    'samosa',
    'kebab',
    'kabab',
    'momo',
    'paratha',
    'thali',
    'curry',
    'roti',
    'naan',
    // Desserts / sweets (Hemanth: "I typed ice cream and it didn't detected").
    'ice cream',
    'icecream',
    'dessert',
    'sweet',
    'sweets',
    'cake',
    'pastry',
    'donut',
    'doughnut',
    'cookie',
    'chocolate',
    'gelato',
    'kulfi',
    'halwa',
    'kheer',
    'rasgulla',
    'gulab jamun',
    'jalebi',
    'mithai',
    // Other meals + quick eats.
    'sandwich',
    'wrap',
    'salad',
    'soup',
    'noodles',
    'ramen',
    'sushi',
    'burrito',
    'taco',
    'kfc',
    'mcdonald',
    'chipotle',
    'subway',
    'dunkin',
    'panera',
    'taco bell'
  ],
  transport: [
    'uber',
    'ola',
    'lyft',
    'rapido',
    'porter',
    'metro',
    'bus',
    'train',
    'taxi',
    'cab',
    'auto',
    'rickshaw',
    'petrol',
    'diesel',
    'gas',
    'fuel',
    'parking',
    'toll',
    'fastag',
    'irctc',
    'redbus',
    'blablacar',
    'namma yatri',
    'rapido bike'
  ],
  housing: ['rent', 'mortgage', 'maintenance', 'society', 'pg'],
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
    'myntra',
    'ajio',
    'meesho',
    'nykaa',
    'snapdeal',
    'tatacliq',
    'decathlon',
    'ikea'
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
    'whole foods',
    // Indian quick-commerce / grocery (Bhargav + cousins type the app name).
    'blinkit',
    'zepto',
    'instamart',
    'dunzo',
    'jiomart',
    'dmart',
    'd mart',
    'milk',
    'vegetables',
    'kirana',
    'more supermarket',
    'reliance fresh'
  ],
  health: [
    'gym',
    'doctor',
    'medicine',
    'pharmacy',
    'hospital',
    'medical',
    'clinic',
    'apollo',
    'pharmeasy',
    '1mg',
    'netmeds',
    'practo',
    'cult',
    'cultfit'
  ],
  entertainment: [
    'netflix',
    'spotify',
    'youtube',
    'movie',
    'concert',
    'cinema',
    'amazon prime',
    'prime video',
    'disney',
    'hotstar',
    'zee5',
    'sonyliv',
    'sony liv',
    'jiocinema',
    'jio cinema',
    'hbo',
    'bookmyshow',
    'pvr',
    'inox',
    'gaming',
    'playstation',
    'xbox',
    'steam'
  ],
  subscriptions: [
    'subscription',
    'membership',
    'onedrive',
    'one drive',
    'icloud',
    'google one',
    'google drive',
    'dropbox',
    'github',
    'chatgpt',
    'openai',
    'notion',
    'canva',
    'adobe',
    'microsoft 365',
    'office 365',
    'linkedin premium'
  ],
  bills: [
    'electricity',
    'water',
    'wifi',
    'internet',
    'broadband',
    'phone',
    'mobile',
    'recharge',
    'postpaid',
    'prepaid',
    'dth',
    'bill',
    'utility',
    'gas bill',
    'jio',
    'airtel',
    'vi ',
    'vodafone',
    'bsnl',
    'tata power',
    'electricity bill'
  ],
  income: [
    'salary',
    'bonus',
    'paycheck',
    'pay check',
    'refund',
    'wage',
    'stipend',
    'cashback',
    'interest',
    'dividend',
    'reimbursement',
    'freelance'
  ]
};

/**
 * For each intent, the words that should match the USER's own category names —
 * so an intent resolves to a category even when the user named it differently
 * (intent "transport" → a category called "Travel" or "Cab"). This closes the
 * "auto-category only works when the typed text IS literally a category name"
 * loophole Pushpa reported. First category (by list order) whose name contains
 * any synonym wins; the bare intent word is always included as a fallback.
 */
const INTENT_CATEGORY_SYNONYMS: Record<string, string[]> = {
  food: ['food', 'dining', 'restaurant', 'eat', 'meal', 'snack', 'cafe', 'tiffin', 'swiggy'],
  groceries: ['grocer', 'grocery', 'supermarket', 'provision', 'vegetable', 'kirana', 'mart'],
  transport: [
    'transport',
    'travel',
    'commute',
    'cab',
    'taxi',
    'auto',
    'ride',
    'fuel',
    'petrol',
    'uber',
    'ola'
  ],
  housing: ['housing', 'rent', 'home', 'house', 'accommodation'],
  loans: ['loan', 'emi', 'debt', 'installment'],
  shopping: ['shopping', 'shop', 'retail', 'clothes', 'apparel', 'fashion'],
  health: ['health', 'medical', 'medicine', 'pharmacy', 'doctor', 'fitness', 'gym'],
  entertainment: ['entertain', 'movie', 'cinema', 'stream', 'ott', 'fun', 'leisure', 'game'],
  subscriptions: ['subscription', 'subscriptions', 'membership'],
  bills: [
    'bill',
    'utility',
    'utilities',
    'electric',
    'water',
    'internet',
    'phone',
    'recharge',
    'mobile'
  ],
  income: ['income', 'salary', 'pay', 'wage', 'earning', 'revenue']
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
/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Does `token` appear as a whole word in `text` (case-insensitive)? Word
 *  boundary = not a letter/digit, so "coffee" matches "morning coffee 80" and
 *  "coffee-shop" but NOT "coffees" or the "coffee" inside "scoffed". */
function containsWord(text: string, token: string): boolean {
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token.toLowerCase())}(?:$|[^a-z0-9])`, 'i');
  return re.test(text);
}
/** The id of the category in `cats` whose OWN name appears as a word in `text`,
 *  preferring the most-specific (longest) name. Null when none match. */
function bestNameMatch(cats: Category[], text: string): string | null {
  let bestId: string | null = null;
  let bestLen = 0;
  for (const c of cats) {
    const name = c.name.trim();
    if (name.length < 3) continue;
    if (containsWord(text, name) && name.length > bestLen) {
      bestId = c.id;
      bestLen = name.length;
    }
  }
  return bestId;
}
const isSubCategory = (c: Category): boolean => c.parent_id !== undefined && c.parent_id !== '';

export function guessCategoryId(
  description: string,
  categories: Category[],
  rules: CategoryRule[]
): string | null {
  const desc = description.trim();
  if (desc.length === 0) return null;

  // 0. A SUB-category whose OWN name is typed wins outright. You created it on
  //    purpose, and it's more specific than any seeded default keyword rule
  //    that points at the PARENT. (Hemanth, 2026-05-29: made a "Coffee" sub and
  //    saved it, but the seeded "COFFEE → Food" rule kept winning so only Food
  //    was picked. The named sub must beat the default rule.) Longest name wins.
  const subMatch = bestNameMatch(categories.filter(isSubCategory), desc);
  if (subMatch !== null) return subMatch;

  // 1. The user's own rules — strongest signal among the rest.
  const ruleMatch = firstMatchingRule(rules, desc);
  if (ruleMatch !== null) return ruleMatch.category_id;

  // 2. A top-level category whose OWN name is typed (e.g. type "shopping").
  const parentMatch = bestNameMatch(
    categories.filter((c) => !isSubCategory(c)),
    desc
  );
  if (parentMatch !== null) return parentMatch;

  // 3. Intent keyword fallback → resolved against the user's category names via a
  //    synonym set, so the intent matches even a differently-named category
  //    ("transport" intent → a category called "Travel"/"Cab"). Prefer a SUB
  //    match (more specific) over a top-level one. This closes Pushpa's loophole
  //    where auto-categorise only fired when the typed text was literally a
  //    category name.
  const intent = matchIntent(desc);
  if (intent === null) return null;
  const intentLower = intent.toLowerCase();
  const synonyms = INTENT_CATEGORY_SYNONYMS[intent] ?? [intentLower];
  const terms = synonyms.includes(intentLower) ? synonyms : [...synonyms, intentLower];
  const nameMatches = (c: Category): boolean => {
    const n = c.name.toLowerCase();
    return terms.some((t) => n.includes(t));
  };
  const subHit = categories.find((c) => isSubCategory(c) && nameMatches(c));
  if (subHit !== undefined) return subHit.id;
  const parentHit = categories.find((c) => !isSubCategory(c) && nameMatches(c));
  if (parentHit !== undefined) return parentHit.id;
  // Last resort: any category whose name contains the intent word itself.
  const cat = categories.find((c) => c.name.toLowerCase().includes(intentLower));
  return cat?.id ?? null;
}
