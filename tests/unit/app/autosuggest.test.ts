import { describe, test, expect } from 'vitest';
import { suggestCompletion, buildSuggestTerms } from '../../../src/lib/app/autosuggest';

const TERMS = ['coffee', 'costco', 'cab', 'cash', 'biryani', 'hdfc'];

describe('suggestCompletion', () => {
  test('completes the last word being typed', () => {
    expect(suggestCompletion('morning cof', TERMS)).toEqual({
      suffix: 'fee',
      accepted: 'morning coffee'
    });
  });

  test('preserves the user typed casing ("Cof" -> "Coffee")', () => {
    expect(suggestCompletion('Cof', TERMS)).toEqual({ suffix: 'fee', accepted: 'Coffee' });
  });

  test('works with amounts/words before the last token', () => {
    expect(suggestCompletion('groceries 200 bir', TERMS)?.accepted).toBe('groceries 200 biryani');
  });

  test('shortest matching term wins (cab over cash for "ca")', () => {
    expect(suggestCompletion('ca', TERMS)).toEqual({ suffix: 'b', accepted: 'cab' });
  });

  test('no suggestion for a single-letter word', () => {
    expect(suggestCompletion('c', TERMS)).toBeNull();
  });

  test('no suggestion right after a space (not mid-word)', () => {
    expect(suggestCompletion('coffee ', TERMS)).toBeNull();
  });

  test('no suggestion when the word is already complete', () => {
    expect(suggestCompletion('coffee', TERMS)).toBeNull();
  });

  test('no suggestion when nothing matches', () => {
    expect(suggestCompletion('xyz', TERMS)).toBeNull();
  });

  test('does not trip on a trailing number', () => {
    expect(suggestCompletion('coffee 80', TERMS)).toBeNull();
  });
});

describe('buildSuggestTerms', () => {
  test('splits multi-word names and includes account words', () => {
    const terms = buildSuggestTerms(['Phone & Internet', 'Food'], ['HDFC UPI']);
    const lower = terms.map((t) => t.toLowerCase());
    expect(lower).toContain('phone');
    expect(lower).toContain('internet');
    expect(lower).toContain('food');
    expect(lower).toContain('hdfc');
    expect(lower).toContain('upi');
    // common list still merged in
    expect(lower).toContain('coffee');
  });

  test('drops words shorter than 3 chars and de-dupes', () => {
    const terms = buildSuggestTerms(['A B Food', 'food'], []);
    const foods = terms.filter((t) => t.toLowerCase() === 'food');
    expect(foods.length).toBe(1);
    expect(terms).not.toContain('A');
  });
});
