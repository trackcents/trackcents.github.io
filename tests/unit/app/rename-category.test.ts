// Pure-helper tests for the new renameCategory() in categorization.ts.
// Covers: name update, icon set / clear / leave-alone, id stability across
// the call (so existing annotations + rules survive unchanged).

import { describe, expect, test } from 'vitest';
import { renameCategory, type Category } from '../../../src/lib/app/categorization';

const seed: Category[] = [
  { id: 'c1', name: 'Eating out', color: '#f00' },
  { id: 'c2', name: 'Transport' },
  { id: 'c3', name: 'Shopping', icon: 'bag' }
];

describe('renameCategory', () => {
  test('updates the name only on the targeted category', () => {
    const out = renameCategory(seed, 'c1', 'Food');
    expect(out.find((c) => c.id === 'c1')?.name).toBe('Food');
    expect(out.find((c) => c.id === 'c2')?.name).toBe('Transport');
    expect(out.find((c) => c.id === 'c3')?.name).toBe('Shopping');
  });

  test('preserves the id so annotations + rules keep their references', () => {
    const out = renameCategory(seed, 'c1', 'Food');
    expect(out.find((c) => c.id === 'c1')).toBeDefined();
    // Length unchanged.
    expect(out.length).toBe(seed.length);
  });

  test('sets the icon override when newIcon is non-empty', () => {
    const out = renameCategory(seed, 'c2', undefined, 'car');
    expect(out.find((c) => c.id === 'c2')?.icon).toBe('car');
    // Other categories' icons unchanged.
    expect(out.find((c) => c.id === 'c3')?.icon).toBe('bag');
  });

  test('clears the icon override when newIcon is the empty string', () => {
    const out = renameCategory(seed, 'c3', undefined, '');
    expect(out.find((c) => c.id === 'c3')?.icon).toBeUndefined();
  });

  test('leaves the icon alone when newIcon is undefined', () => {
    const out = renameCategory(seed, 'c3', 'Marketplace');
    expect(out.find((c) => c.id === 'c3')?.icon).toBe('bag');
    expect(out.find((c) => c.id === 'c3')?.name).toBe('Marketplace');
  });

  test('treats an all-whitespace newName as a no-op', () => {
    const out = renameCategory(seed, 'c1', '   ');
    expect(out.find((c) => c.id === 'c1')?.name).toBe('Eating out');
  });

  test('is pure — input array is not mutated', () => {
    const frozen = Object.freeze([...seed]);
    expect(() => renameCategory(frozen as Category[], 'c1', 'Food')).not.toThrow();
    expect(frozen[0]?.name).toBe('Eating out');
  });
});
