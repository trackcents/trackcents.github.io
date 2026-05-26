// @vitest-environment node
// Web Crypto (crypto.getRandomValues, btoa/atob) is exercised here; the suite
// default is jsdom, so this file forces the node environment which has full WebCrypto.
import { describe, expect, test } from 'vitest';
import {
  generateSalt,
  saltToBase64,
  saltFromBase64,
  SALT_BYTES
} from '../../../src/lib/crypto/salt';

describe('salt', () => {
  test('generateSalt returns SALT_BYTES random bytes', () => {
    const s = generateSalt();
    expect(s).toBeInstanceOf(Uint8Array);
    expect(s.byteLength).toBe(SALT_BYTES);
  });

  test('two generated salts differ (randomness)', () => {
    expect(saltToBase64(generateSalt())).not.toBe(saltToBase64(generateSalt()));
  });

  test('base64 round-trip is lossless for a random salt', () => {
    const s = generateSalt();
    expect(Array.from(saltFromBase64(saltToBase64(s)))).toEqual(Array.from(s));
  });

  test('round-trips boundary byte values (0x00 and 0xFF)', () => {
    const s = new Uint8Array([0, 255, 128, 1, 254, 200, 16, 7]);
    expect(Array.from(saltFromBase64(saltToBase64(s)))).toEqual(Array.from(s));
  });
});
