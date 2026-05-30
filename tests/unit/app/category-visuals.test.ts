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

  test('merchant / service names resolve to their brand logo', () => {
    const cases: Array<[string, string]> = [
      ['Netflix', 'brand:netflix'],
      ['Hotstar', 'brand:hotstar'],
      ['Disney+', 'brand:disneyplus'],
      ['Hulu', 'brand:hulu'],
      ['ZEE5', 'brand:zee5'],
      ['SonyLIV', 'brand:sonyliv'],
      ['JioCinema', 'brand:jiocinema'],
      ['Amazon Prime Video', 'brand:primevideo'], // "prime video" beats bare "amazon"
      ['Spotify', 'brand:spotify'],
      ['Uber', 'brand:uber'],
      ['Ola', 'brand:ola'],
      ['Rapido', 'brand:rapido'],
      ['Swiggy', 'brand:swiggy'],
      ['Zomato', 'brand:zomato'],
      ['PhonePe', 'brand:phonepe']
    ];
    for (const [name, expected] of cases) {
      expect(categoryIconName(name)).toBe(expected);
    }
  });

  test('word-boundary matching avoids brand false positives', () => {
    // "cred" must not fire inside "credit"; "grab" only as a whole word.
    expect(categoryIconName('Credit card')).not.toBe('brand:cred');
    expect(categoryIconName('Groceries')).toBe('cart'); // not "grab"
  });

  test('generic memberships keep the repeat (loop) icon', () => {
    expect(categoryIconName('Gym Membership')).toBe('repeat');
    expect(categoryIconName('Subscriptions')).toBe('repeat');
  });

  test('each South-Indian dish gets its OWN distinct icon (not one generic glyph)', () => {
    const cases: Array<[string, string]> = [
      ['Idli', 'food:idli'],
      ['Dosa', 'food:dosa'],
      ['Masala Dosa', 'food:dosa'],
      ['Medu Vada', 'food:vada'],
      ['Poori', 'food:poori'],
      ['Upma', 'food:upma'],
      ['Pongal', 'food:pongal'],
      ['Uttapam', 'food:uttapam'],
      ['Appam', 'food:appam'],
      ['Idiyappam', 'food:idiyappam'], // not mis-read as "appam"
      ['Samosa', 'food:samosa'],
      ['Sambar', 'food:sambar']
    ];
    const seen = new Set<string>();
    for (const [name, expected] of cases) {
      expect(categoryIconName(name)).toBe(expected);
      seen.add(expected);
    }
    // They are genuinely distinct, not all collapsed to one icon.
    expect(seen.size).toBe(new Set(cases.map((c) => c[1])).size);
  });

  test('dishes without a dedicated icon still fall back to a sensible glyph', () => {
    expect(categoryIconName('Biryani')).toBe('bowl');
    expect(categoryIconName('Gulab Jamun')).toBe('donut');
  });
});
