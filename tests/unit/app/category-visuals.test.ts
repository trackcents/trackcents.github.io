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
});
