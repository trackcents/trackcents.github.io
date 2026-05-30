import { describe, test, expect } from 'vitest';
import { BRAND_LOGOS, BRAND_KEYWORDS } from '../../../src/lib/app/brand-logos';
import { FOOD_ICONS, FOOD_KEYWORDS, FOOD_PALETTE } from '../../../src/lib/app/food-icons';

describe('brand-logos registry', () => {
  test('every keyword maps to a defined brand', () => {
    for (const [kw, key] of BRAND_KEYWORDS) {
      expect(BRAND_LOGOS[key], `keyword "${kw}" -> ${key}`).toBeDefined();
    }
  });

  test('keywords are sorted longest-first (most specific wins)', () => {
    for (let i = 1; i < BRAND_KEYWORDS.length; i++) {
      expect(BRAND_KEYWORDS[i - 1]![0].length).toBeGreaterThanOrEqual(BRAND_KEYWORDS[i]![0].length);
    }
  });

  test('marks have a non-empty path; letters have text + colours', () => {
    for (const [key, logo] of Object.entries(BRAND_LOGOS)) {
      if (logo.kind === 'mark') {
        expect(logo.path.length, key).toBeGreaterThan(0);
        expect(logo.hex, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      } else {
        expect(logo.text.length, key).toBeGreaterThan(0);
        expect(logo.text.length, key).toBeLessThanOrEqual(4); // fits the tile
        expect(logo.hex, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(logo.fg, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

describe('food-icons registry', () => {
  const VALID_K = new Set(['ellipse', 'circle', 'rect', 'tri', 'poly', 'line']);

  test('every keyword maps to a defined dish', () => {
    for (const [kw, key] of FOOD_KEYWORDS) {
      expect(FOOD_ICONS[key], `keyword "${kw}" -> ${key}`).toBeDefined();
    }
  });

  test('every dish has a label and at least one shape', () => {
    for (const [key, def] of Object.entries(FOOD_ICONS)) {
      expect(def.label.length, key).toBeGreaterThan(0);
      expect(def.shapes.length, key).toBeGreaterThan(0);
    }
  });

  test('shapes use known primitives and palette tokens stay in-bounds', () => {
    for (const [key, def] of Object.entries(FOOD_ICONS)) {
      for (const s of def.shapes) {
        expect(VALID_K.has(s.k), `${key}: bad k "${s.k}"`).toBe(true);
        for (const tok of [s.fill, s.stroke]) {
          if (tok && tok !== 'none') {
            expect(FOOD_PALETTE[tok], `${key}: unknown token "${tok}"`).toBeDefined();
          }
        }
      }
    }
  });

  test('poly/tri shapes carry point arrays', () => {
    for (const [key, def] of Object.entries(FOOD_ICONS)) {
      for (const s of def.shapes) {
        if (s.k === 'tri' || s.k === 'poly') {
          expect(Array.isArray(s.points), key).toBe(true);
          expect(s.points!.length, key).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
