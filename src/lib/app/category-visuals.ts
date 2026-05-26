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
  | 'tag';

/** Map a category NAME (keywords) to a pictogram. Description/structure-based,
 *  never amount-based. Falls back to a generic tag. */
export function categoryIconName(name: string): IconKey {
  const n = name.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => n.includes(w));
  if (has('grocer', 'supermarket', 'whole food')) return 'cart';
  if (has('rent', 'mortgage', 'housing', 'home')) return 'home';
  if (has('gas', 'fuel', 'shell', 'chevron')) return 'fuel';
  if (has('subscription', 'netflix', 'spotify', 'membership')) return 'repeat';
  if (has('dining', 'restaurant', 'food', 'coffee', 'cafe')) return 'utensils';
  if (has('shopping', 'amazon', 'retail', 'clothes')) return 'bag';
  if (has('transport', 'uber', 'lyft', 'car', 'transit', 'parking')) return 'car';
  if (has('salary', 'income', 'payroll', 'paycheck')) return 'wallet';
  if (has('health', 'medical', 'pharmacy', 'gym', 'fitness')) return 'heart';
  if (has('travel', 'flight', 'hotel', 'airbnb')) return 'plane';
  if (has('utilit', 'electric', 'water', 'internet', 'phone')) return 'bolt';
  return 'tag';
}
