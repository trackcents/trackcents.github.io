import { describe, expect, test } from 'vitest';
import {
  estimatePassphraseStrength,
  MIN_LENGTH
} from '../../../src/lib/crypto/passphrase-strength';

describe('estimatePassphraseStrength', () => {
  test('empty → score 0, fails minimum', () => {
    const r = estimatePassphraseStrength('');
    expect(r.score).toBe(0);
    expect(r.meetsMinimum).toBe(false);
  });

  test('common password → forced to score 0 (case-insensitive)', () => {
    expect(estimatePassphraseStrength('password').score).toBe(0);
    expect(estimatePassphraseStrength('Password').score).toBe(0);
  });

  test('short but complex fails the length gate', () => {
    const r = estimatePassphraseStrength('Ab1!xyz?'); // 8 chars, 4 classes
    expect(r.meetsMinimum).toBe(false);
    expect(r.suggestions.join(' ')).toMatch(/at least 12/);
  });

  test('long multi-word passphrase meets minimum even with low variety', () => {
    const r = estimatePassphraseStrength('correct horse battery staple');
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.meetsMinimum).toBe(true);
  });

  test('12+ chars with full variety → strong, meets minimum', () => {
    const r = estimatePassphraseStrength('Tr0ub4dour&3x'); // 13 chars, 4 classes
    expect(r.meetsMinimum).toBe(true);
    expect(r.label).toBe('strong');
  });

  test('a single repeated character is capped weak', () => {
    expect(estimatePassphraseStrength('aaaaaaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
  });

  test('documented minimum length is 12', () => {
    expect(MIN_LENGTH).toBe(12);
  });
});
