import { describe, test, expect } from 'vitest';
import {
  categoryColor,
  categoryIconName,
  CATEGORY_PALETTE
} from '../../../src/lib/app/category-visuals';

describe('categoryColor', () => {
  test('is deterministic for the same id', () => {
    expect(categoryColor('groceries')).toBe(categoryColor('groceries'));
  });
  test('null (uncategorized) is the neutral grey', () => {
    expect(categoryColor(null)).toBe('#94a3b8');
  });
  test('returns a colour from the palette', () => {
    expect(CATEGORY_PALETTE).toContain(categoryColor('rent'));
  });
});

describe('categoryIconName', () => {
  test('maps keywords to pictograms', () => {
    expect(categoryIconName('Groceries')).toBe('cart');
    expect(categoryIconName('Rent')).toBe('home');
    expect(categoryIconName('Gas')).toBe('fuel');
    expect(categoryIconName('Subscriptions')).toBe('repeat');
    expect(categoryIconName('Dining out')).toBe('utensils');
    expect(categoryIconName('Salary')).toBe('wallet');
  });
  test('falls back to a generic tag for unknown names', () => {
    expect(categoryIconName('Miscellaneous xyz')).toBe('tag');
  });

  test('streaming services map to the generic streaming icon (NOT brand logos)', () => {
    // We never bundle the official trademarked logos; every OTT service shares
    // one generic "play" glyph and is told apart by its NAME.
    for (const name of [
      'Netflix',
      'Hotstar',
      'Disney+',
      'Hulu',
      'Zee5',
      'SonyLIV',
      'JioCinema',
      'Amazon Prime Video',
      'HBO',
      'Crunchyroll',
      'Sun NXT'
    ]) {
      expect(categoryIconName(name)).toBe('play');
    }
  });

  test('music / generic memberships stay on the repeat (loop) icon', () => {
    expect(categoryIconName('Spotify')).toBe('repeat');
    expect(categoryIconName('Gym Membership')).toBe('repeat');
    expect(categoryIconName('Subscriptions')).toBe('repeat');
  });

  test('South-Indian savoury dishes share the curry-bowl glyph', () => {
    for (const name of [
      'Idli',
      'Dosa',
      'Upma',
      'Pongal',
      'Poori',
      'Biryani',
      'Paratha',
      'Uttapam',
      'Meals',
      'Thali'
    ]) {
      expect(categoryIconName(name)).toBe('bowl');
    }
  });

  test('round fried snacks share the donut ring glyph', () => {
    for (const name of ['Vada', 'Medu Vada', 'Bonda', 'Bajji', 'Pakora']) {
      expect(categoryIconName(name)).toBe('donut');
    }
  });
});
