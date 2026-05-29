/**
 * Consistent per-category colour + icon so a category is instantly recognizable
 * across the table, charts, budget, and the Today screen (Rocket-Money cue:
 * colour-coded categories + a pictogram library). Pure + deterministic — the
 * same category id always maps to the same colour, no storage needed.
 */

/** Vibrant, evenly-spaced hues — distinct from the semantic green(in)/red(out). */
export const CATEGORY_PALETTE = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#14b8a6', // teal
  '#e11d48', // rose
  '#3b82f6' // blue
];

const UNCATEGORIZED_COLOR = '#94a3b8'; // slate — the "no category" bucket

/** Deterministic colour for a category id (null = uncategorized → neutral grey). */
export function categoryColor(id: string | null): string {
  if (id === null) return UNCATEGORIZED_COLOR;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length] as string;
}

export type IconKey =
  | 'cart'
  | 'home'
  | 'fuel'
  | 'repeat'
  | 'utensils'
  | 'bag'
  | 'car'
  | 'wallet'
  | 'heart'
  | 'plane'
  | 'bolt'
  | 'film'
  | 'book'
  | 'gift'
  | 'shield'
  | 'card'
  | 'chart-up'
  | 'undo'
  | 'percent'
  | 'banknote'
  | 'piggy'
  // ── New food / drink icons (Hemanth's "I need lots of logos") ──
  | 'pizza'
  | 'coffee'
  | 'icecream'
  | 'bowl'
  | 'salad'
  | 'sushi'
  | 'cake'
  | 'donut'
  | 'cup'
  // Other "lots and lots of" requests.
  | 'bus'
  | 'train'
  | 'medical'
  | 'tag';

/** Every IconKey + a friendly label.  Used by the IconPicker (Batch B —
 *  rename + custom icon).  Kept here so adding an icon only requires one
 *  edit to this list. */
export const ICON_OPTIONS: ReadonlyArray<{ key: IconKey; label: string }> = [
  { key: 'cart', label: 'Cart' },
  { key: 'utensils', label: 'Food' },
  // Food sub-category-friendly options.
  { key: 'pizza', label: 'Pizza' },
  { key: 'bowl', label: 'Bowl' },
  { key: 'salad', label: 'Salad' },
  { key: 'sushi', label: 'Sushi' },
  { key: 'icecream', label: 'Ice cream' },
  { key: 'cake', label: 'Cake' },
  { key: 'donut', label: 'Donut' },
  { key: 'coffee', label: 'Coffee' },
  { key: 'cup', label: 'Drink' },
  // Non-food.
  { key: 'home', label: 'Home' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'car', label: 'Car' },
  { key: 'bus', label: 'Bus' },
  { key: 'train', label: 'Train' },
  { key: 'plane', label: 'Travel' },
  { key: 'bag', label: 'Shopping' },
  { key: 'film', label: 'Movie' },
  { key: 'book', label: 'Education' },
  { key: 'gift', label: 'Gift' },
  { key: 'heart', label: 'Health' },
  { key: 'medical', label: 'Medicine' },
  { key: 'bolt', label: 'Utility' },
  { key: 'shield', label: 'Insurance' },
  { key: 'wallet', label: 'Salary' },
  { key: 'card', label: 'Card' },
  { key: 'repeat', label: 'Subscription' },
  { key: 'chart-up', label: 'Investment' },
  { key: 'undo', label: 'Refund' },
  { key: 'percent', label: 'Fees' },
  { key: 'banknote', label: 'Cash' },
  { key: 'piggy', label: 'Savings' },
  { key: 'tag', label: 'Other' }
];

/** Map a category NAME (keywords) to a pictogram. Description/structure-based,
 *  never amount-based. Falls back to a generic tag. */
export function categoryIconName(name: string): IconKey {
  const n = name.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => n.includes(w));
  // Order matters — more specific keywords first so "ice cream gift card"
  // doesn't route Food to Gift.
  if (has('grocer', 'supermarket', 'whole food')) return 'cart';
  if (has('rent', 'mortgage', 'housing')) return 'home';
  if (has('gas', 'fuel', 'shell', 'chevron')) return 'fuel';
  if (has('subscription', 'netflix', 'spotify', 'membership')) return 'repeat';
  // Specific food sub-categories first — more specific than the
  // generic "food/utensils" fallback that catches "Food" itself.
  if (has('pizza')) return 'pizza';
  if (has('coffee', 'espresso', 'cappuccino', 'latte', 'mocha', 'chai', ' tea')) return 'coffee';
  if (has('milkshake', 'shake', 'smoothie', 'lassi', 'juice', 'soda', 'coke', 'pepsi'))
    return 'cup';
  if (has('ice cream', 'icecream', 'gelato', 'kulfi', 'sundae')) return 'icecream';
  if (has('cake', 'pastry', 'muffin', 'cupcake', 'tart')) return 'cake';
  if (has('donut', 'doughnut', 'vada')) return 'donut';
  if (has('sushi', 'sashimi', 'maki')) return 'sushi';
  if (has('salad', 'wrap', 'sandwich')) return 'salad';
  if (
    has(
      'biryani',
      'curry',
      'dal',
      'sambar',
      'rasam',
      'soup',
      'ramen',
      'pho',
      'pasta',
      'noodle',
      'idli',
      'dosa',
      'rice'
    )
  )
    return 'bowl';
  if (has('dining', 'restaurant', 'food', 'eating', 'cafe', 'tiffin', 'breakfast', 'lunch'))
    return 'utensils';
  if (has('shopping', 'amazon', 'retail', 'clothes')) return 'bag';
  if (has(' bus ', 'busfare')) return 'bus';
  if (has('train', 'metro', 'subway', 'rail', 'irctc')) return 'train';
  if (has('transport', 'uber', 'lyft', 'car', 'cab', 'taxi', 'transit', 'parking', 'toll'))
    return 'car';
  if (has('salary', 'income', 'payroll', 'paycheck')) return 'wallet';
  if (has('pharmacy', 'medicine', 'pills', 'tablet')) return 'medical';
  if (has('health', 'medical', 'gym', 'fitness', 'doctor', 'hospital', 'clinic')) return 'heart';
  if (has('travel', 'flight', 'hotel', 'airbnb')) return 'plane';
  if (has('phone', 'internet', 'mobile', 'jio', 'airtel')) return 'bolt';
  if (has('utilit', 'electric', 'water')) return 'bolt';
  if (has('entertain', 'movie', 'film', 'cinema', 'concert', 'show', 'game')) return 'film';
  if (has('education', 'school', 'college', 'tuition', 'course', 'class')) return 'book';
  if (has('gift', 'family', 'birthday', 'anniv', 'wedding')) return 'gift';
  if (has('insur', 'geico', 'allstate', 'state farm')) return 'shield';
  if (has('cc payment', 'card payment', 'credit card pmt')) return 'card';
  if (has('invest', 'robinhood', 'vanguard', 'fidelity', 'schwab', 'coinbase')) return 'chart-up';
  if (has('refund', 'return')) return 'undo';
  if (has('fee', 'interest', 'charge', 'penalty')) return 'percent';
  if (has('cash', 'atm', 'withdrawal')) return 'banknote';
  if (has('saving', 'goal', 'emergency')) return 'piggy';
  if (has('loan', 'installment', 'emi')) return 'percent';
  if (has('transfer', 'move')) return 'repeat';
  return 'tag';
}
