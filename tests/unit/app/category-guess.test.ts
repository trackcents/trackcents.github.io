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

  // Sub-category auto-fill by NAME (Hemanth: added "Coffee" under Food, typing
  // "coffee" must fill Food › Coffee, not just the Food parent).
  it('auto-fills a user-created sub-category by its own name', () => {
    const cats: Category[] = [
      { id: 'c-food', name: 'Food', color: '#f00' },
      { id: 'c-coffee', name: 'Coffee', color: '#f80', parent_id: 'c-food' }
    ];
    expect(guessCategoryId('morning coffee 80', cats, NO_RULES)).toBe('c-coffee');
  });

  it('a matching sub-category name beats its parent (most-specific wins)', () => {
    const cats: Category[] = [
      { id: 'c-food', name: 'Food', color: '#f00' },
      { id: 'c-biryani', name: 'Biryani', color: '#f80', parent_id: 'c-food' }
    ];
    expect(guessCategoryId('biryani for lunch', cats, NO_RULES)).toBe('c-biryani');
  });

  it('still falls back to the keyword intent when no category name matches', () => {
    const cats: Category[] = [{ id: 'c-food', name: 'Food', color: '#f00' }];
    expect(guessCategoryId('chai 20', cats, NO_RULES)).toBe('c-food');
  });

  it('does not match a category name embedded in a longer word', () => {
    const cats: Category[] = [
      { id: 'c-food', name: 'Food', color: '#f00' },
      { id: 'c-gas', name: 'Gas', color: '#0f0' }
    ];
    // "gas" inside "gastropub" must not pull the Gas category (word boundary).
    expect(guessCategoryId('gastropub 500', cats, NO_RULES)).toBeNull();
  });

  it('a named sub beats a seeded default rule pointing at the parent', () => {
    // The real bug: the seed ships a "COFFEE → Food" rule; the user adds a
    // Coffee sub under Food. Typing "coffee" must pick the SUB, not the parent.
    const cats: Category[] = [
      { id: 'c-food', name: 'Food', color: '#f00' },
      { id: 'c-coffee', name: 'Coffee', color: '#f80', parent_id: 'c-food' }
    ];
    const seedRules: CategoryRule[] = [
      { id: 'seed-rule-1', contains: 'COFFEE', category_id: 'c-food' }
    ];
    expect(guessCategoryId('morning coffee 80', cats, seedRules)).toBe('c-coffee');
  });

  // ── Pushpa's loophole: broaden recognition + resolve an intent to a
  //    DIFFERENTLY-named user category (no longer needs an exact name match). ──
  it('recognises Indian app/service names (rapido → Transport, blinkit → Groceries)', () => {
    const cats: Category[] = [
      { id: 'c-transport', name: 'Transport' },
      { id: 'c-groceries', name: 'Groceries' }
    ];
    expect(guessCategoryId('rapido bike ride', cats, NO_RULES)).toBe('c-transport');
    expect(guessCategoryId('blinkit order', cats, NO_RULES)).toBe('c-groceries');
  });

  it('maps a cloud/SaaS name to a Subscriptions category (onedrive → Subscriptions)', () => {
    const cats: Category[] = [{ id: 'c-subs', name: 'Subscriptions' }];
    expect(guessCategoryId('one drive monthly', cats, NO_RULES)).toBe('c-subs');
    expect(guessCategoryId('icloud storage', cats, NO_RULES)).toBe('c-subs');
  });

  it('resolves an intent to a differently-named category via synonyms (Travel, not Transport)', () => {
    // The user named their transport bucket "Travel" — an "uber" intent must
    // still land there even though "transport" isn't in the name.
    const cats: Category[] = [{ id: 'c-travel', name: 'Travel' }];
    expect(guessCategoryId('uber to office', cats, NO_RULES)).toBe('c-travel');
    expect(guessCategoryId('petrol fill', cats, NO_RULES)).toBe('c-travel');
  });

  it('prefers a matching SUB-category over its parent for an intent (Food › Dining)', () => {
    const cats: Category[] = [
      { id: 'c-food', name: 'Food' },
      { id: 'c-dining', name: 'Dining', parent_id: 'c-food' }
    ];
    // "swiggy" → food intent; the Dining sub's synonym ('dining') wins over Food.
    expect(guessCategoryId('swiggy dinner', cats, NO_RULES)).toBe('c-dining');
  });
});
