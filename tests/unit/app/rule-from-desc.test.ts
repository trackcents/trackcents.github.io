// Locks in the learn-from-pick pattern extractor.  When the user manually
// picks a category in QuickAddSheet, the form mints a "contains X →
// Category" rule so the next typing of the same merchant auto-picks.
// These tests pin the heuristic so a regression can't silently break
// Hemanth's "I add a name once and you remember it" expectation.

import { describe, expect, test } from 'vitest';
import { extractRulePattern, isDuplicateRule } from '../../../src/lib/app/rule-from-desc';

describe('extractRulePattern', () => {
  test('plain merchant: "biryani" → "biryani"', () => {
    expect(extractRulePattern('biryani')).toBe('biryani');
  });

  test('strips leading verb: "ate biryani" → "biryani"', () => {
    expect(extractRulePattern('ate biryani')).toBe('biryani');
  });

  test('strips multi-word verb + filler: "i just had milkshake" → "milkshake"', () => {
    expect(extractRulePattern('i just had milkshake')).toBe('milkshake');
  });

  test('preserves multi-word merchant: "ice cream" → "ice cream"', () => {
    expect(extractRulePattern('ice cream')).toBe('ice cream');
  });

  test('strips leading preposition: "for milkshake" → "milkshake"', () => {
    expect(extractRulePattern('for milkshake')).toBe('milkshake');
  });

  test('strips trailing preposition: "milkshake at" → "milkshake"', () => {
    expect(extractRulePattern('milkshake at')).toBe('milkshake');
  });

  test('case-insensitive: "Biryani" → "biryani" (lowercase output)', () => {
    expect(extractRulePattern('Biryani')).toBe('biryani');
  });

  test('returns null for too-short pattern: "hi"', () => {
    expect(extractRulePattern('hi')).toBeNull();
  });

  test('returns null for verbs only: "ate had"', () => {
    expect(extractRulePattern('ate had')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(extractRulePattern('')).toBeNull();
  });

  test('multi-word merchant phrase: "drank coke at airport" → "coke at airport"', () => {
    // Leading "drank" stripped; middle-string prepositions are NOT stripped
    // (only leading/trailing).  The user can edit the rule in /categories
    // if they want a broader match.  This documents current behavior.
    expect(extractRulePattern('drank coke at airport')).toBe('coke at airport');
  });

  test('preserves merchant brand: "starbucks" → "starbucks"', () => {
    expect(extractRulePattern('starbucks')).toBe('starbucks');
  });
});

describe('isDuplicateRule', () => {
  const rules = [
    { id: 'r1', contains: 'biryani', category_id: 'food' },
    { id: 'r2', contains: 'ICE CREAM', category_id: 'food' },
    { id: 'r3', contains: 'uber', category_id: 'transport' }
  ];

  test('matches exact existing rule (case-insensitive)', () => {
    expect(isDuplicateRule(rules, 'biryani', 'food')).toBe(true);
    expect(isDuplicateRule(rules, 'BIRYANI', 'food')).toBe(true);
    expect(isDuplicateRule(rules, 'ice cream', 'food')).toBe(true);
  });

  test('different category counts as NOT duplicate', () => {
    // Same pattern but different category — user might want both.
    expect(isDuplicateRule(rules, 'biryani', 'travel')).toBe(false);
  });

  test('new pattern is not duplicate', () => {
    expect(isDuplicateRule(rules, 'pizza', 'food')).toBe(false);
  });

  test('empty rule list: nothing is duplicate', () => {
    expect(isDuplicateRule([], 'biryani', 'food')).toBe(false);
  });

  test('rule with no contains (regex-only) is not a match', () => {
    const r = [{ id: 'r1', category_id: 'food' }];
    expect(isDuplicateRule(r, 'biryani', 'food')).toBe(false);
  });
});
