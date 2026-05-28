// Tests for the category guesser — locks in user-rule precedence over the
// built-in keyword fallback, and the everyday merchant heuristics for both
// India + US merchants we discussed in the brainstorm.

import { describe, expect, it } from 'vitest';
import { guessCategoryId } from '../../../src/lib/app/category-guess';
import type { Category, CategoryRule } from '../../../src/lib/app/categorization';

const CATS: Category[] = [
  { id: 'c-food', name: 'Food', color: '#f00' },
  { id: 'c-transport', name: 'Transport', color: '#0f0' },
  { id: 'c-rent', name: 'Housing', color: '#00f' },
  { id: 'c-shop', name: 'Shopping', color: '#ff0' },
  { id: 'c-income', name: 'Income', color: '#0ff' }
];

const NO_RULES: CategoryRule[] = [];

describe('guessCategoryId', () => {
  it('returns null for an empty description', () => {
    expect(guessCategoryId('', CATS, NO_RULES)).toBeNull();
  });

  it('matches "chai" to Food via the keyword fallback', () => {
    expect(guessCategoryId('chai with friend', CATS, NO_RULES)).toBe('c-food');
  });

  it('matches "Starbucks coffee" to Food', () => {
    expect(guessCategoryId('Starbucks coffee', CATS, NO_RULES)).toBe('c-food');
  });

  it('matches "uber to airport" to Transport', () => {
    expect(guessCategoryId('uber to airport', CATS, NO_RULES)).toBe('c-transport');
  });

  it('matches "rent" to Housing', () => {
    expect(guessCategoryId('May rent', CATS, NO_RULES)).toBe('c-rent');
  });

  it('does NOT match "rent" inside the word "current"', () => {
    // Word-boundary check — the "rent" of "current" must not pull a Housing match.
    expect(guessCategoryId('current account fee', CATS, NO_RULES)).toBeNull();
  });

  it('matches "amazon prime" to Shopping (amazon keyword)', () => {
    expect(guessCategoryId('amazon order', CATS, NO_RULES)).toBe('c-shop');
  });

  it('returns null when nothing matches and the user has no relevant category', () => {
    expect(guessCategoryId('xyz random text', CATS, NO_RULES)).toBeNull();
  });

  it('returns null when keyword matches an intent but the user has no matching category', () => {
    // No "Health" category in CATS, so the gym keyword has nowhere to land.
    expect(guessCategoryId('gym membership', CATS, NO_RULES)).toBeNull();
  });

  it('user rules win over the keyword fallback', () => {
    const rules: CategoryRule[] = [
      {
        id: 'r1',
        contains: 'STARBUCKS',
        category_id: 'c-shop' // intuitively Food, but the user's rule wins
      }
    ];
    expect(guessCategoryId('STARBUCKS #4218', CATS, rules)).toBe('c-shop');
  });
});
