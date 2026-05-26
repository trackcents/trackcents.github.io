import { describe, test, expect } from 'vitest';
import {
  merchantTrends,
  priceJumps,
  frequentMerchants,
  largestPurchases,
  type MerchantTxn
} from '../../../src/lib/app/merchant-trends';

const tx = (posted_date: string, amount_minor: bigint, description: string): MerchantTxn => ({
  posted_date,
  amount_minor,
  description
});

describe('merchantTrends', () => {
  test('groups outflows by normalized merchant and needs ≥2 charges', () => {
    // normalizeDescriptor uppercases + strips digits/#, so "NETFLIX #0125" and
    // "NETFLIX #0225" both collapse to the key "NETFLIX".
    const out = merchantTrends([
      tx('2026-01-01', -1599n, 'NETFLIX #0125'),
      tx('2026-02-01', -1799n, 'NETFLIX #0225'),
      tx('2026-01-15', -500n, 'ONE TIME SHOP') // single charge → dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.merchant_key).toBe('NETFLIX');
    expect(out[0]!.occurrences).toBe(2);
    expect(out[0]!.first_amount_minor).toBe(1599n);
    expect(out[0]!.last_amount_minor).toBe(1799n);
    expect(out[0]!.total_spent_minor).toBe(3398n);
    expect(out[0]!.average_amount_minor).toBe(1699n);
  });

  test('excludes inflows (deposits/refunds) from price tracking', () => {
    const out = merchantTrends([
      tx('2026-01-01', 200000n, 'PAYROLL ACME'),
      tx('2026-02-01', 200000n, 'PAYROLL ACME')
    ]);
    expect(out).toHaveLength(0);
  });

  test('computes the latest-vs-previous jump (absolute + percent)', () => {
    const out = merchantTrends([
      tx('2026-01-01', -1599n, 'NETFLIX'),
      tx('2026-02-01', -1599n, 'NETFLIX'),
      tx('2026-03-01', -1799n, 'NETFLIX')
    ]);
    expect(out[0]!.previous_amount_minor).toBe(1599n);
    expect(out[0]!.jump_minor).toBe(200n);
    expect(out[0]!.jump_pct).toBeCloseTo(12.5078, 2);
  });

  test('windows by `since`', () => {
    const txns = [
      tx('2025-12-01', -1000n, 'GYM'),
      tx('2026-01-01', -1000n, 'GYM'),
      tx('2026-02-01', -1000n, 'GYM')
    ];
    expect(merchantTrends(txns, { since: '2026-01-01' })[0]!.occurrences).toBe(2);
  });

  test('sorted by total spent descending', () => {
    const out = merchantTrends([
      tx('2026-01-01', -100n, 'CHEAP'),
      tx('2026-02-01', -100n, 'CHEAP'),
      tx('2026-01-01', -5000n, 'PRICEY'),
      tx('2026-02-01', -5000n, 'PRICEY')
    ]);
    expect(out.map((m) => m.merchant_key)).toEqual(['PRICEY', 'CHEAP']);
  });
});

describe('priceJumps', () => {
  test('only merchants whose latest charge changed, biggest %% jump first', () => {
    const out = priceJumps([
      // +12.5%
      tx('2026-01-01', -1599n, 'NETFLIX'),
      tx('2026-02-01', -1799n, 'NETFLIX'),
      // +100%
      tx('2026-01-01', -500n, 'SPOTIFY'),
      tx('2026-02-01', -1000n, 'SPOTIFY'),
      // unchanged → excluded
      tx('2026-01-01', -1000n, 'RENT'),
      tx('2026-02-01', -1000n, 'RENT')
    ]);
    expect(out.map((m) => m.merchant_key)).toEqual(['SPOTIFY', 'NETFLIX']);
  });

  test('a price drop is still a jump (negative jump_minor)', () => {
    const out = priceJumps([tx('2026-01-01', -2000n, 'PHONE'), tx('2026-02-01', -1500n, 'PHONE')]);
    expect(out[0]!.jump_minor).toBe(-500n);
    expect(out[0]!.jump_pct).toBeCloseTo(-25, 5);
  });
});

describe('frequentMerchants', () => {
  test('ranked by occurrence count', () => {
    const out = frequentMerchants([
      tx('2026-01-01', -100n, 'COFFEE'),
      tx('2026-01-08', -100n, 'COFFEE'),
      tx('2026-01-15', -100n, 'COFFEE'),
      tx('2026-01-01', -100n, 'GAS'),
      tx('2026-02-01', -100n, 'GAS')
    ]);
    expect(out[0]!.merchant_key).toBe('COFFEE');
    expect(out[0]!.occurrences).toBe(3);
  });
});

describe('largestPurchases', () => {
  test('top outflows by magnitude, capped at limit', () => {
    const out = largestPurchases(
      [
        tx('2026-01-01', -100n, 'a'),
        tx('2026-01-02', -9999n, 'b'),
        tx('2026-01-03', -5000n, 'c'),
        tx('2026-01-04', 200000n, 'deposit') // inflow excluded
      ],
      { limit: 2 }
    );
    expect(out.map((r) => r.description)).toEqual(['b', 'c']);
    expect(out[0]!.amount_minor).toBe(9999n);
  });
});
