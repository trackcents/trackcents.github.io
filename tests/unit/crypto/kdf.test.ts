// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { deriveKey, KDF_ITERATIONS, MIN_SALT_BYTES } from '../../../src/lib/crypto/kdf';
import { encryptString, decryptString } from '../../../src/lib/crypto/aes';
import { generateSalt } from '../../../src/lib/crypto/salt';

const FAST = { iterations: 1000 };

describe('kdf (PBKDF2-SHA-256)', () => {
  test('default iteration count is the constitutional 600,000', () => {
    expect(KDF_ITERATIONS).toBe(600_000);
  });

  test('deterministic: same passphrase + salt derive interoperable keys', async () => {
    const salt = generateSalt();
    const k1 = await deriveKey('correct horse battery staple', salt, FAST);
    const k2 = await deriveKey('correct horse battery staple', salt, FAST);
    // a returning user re-deriving the key must decrypt what a prior session wrote
    expect(await decryptString(k2, await encryptString(k1, 'secret'))).toBe('secret');
  });

  test('different salt → keys do not interoperate', async () => {
    const k1 = await deriveKey('pw', generateSalt(), FAST);
    const k2 = await deriveKey('pw', generateSalt(), FAST);
    await expect(decryptString(k2, await encryptString(k1, 'x'))).rejects.toThrow();
  });

  test('different passphrase → cannot decrypt', async () => {
    const salt = generateSalt();
    const right = await deriveKey('right-pass', salt, FAST);
    const wrong = await deriveKey('wrong-pass', salt, FAST);
    await expect(decryptString(wrong, await encryptString(right, 'x'))).rejects.toThrow();
  });

  test('empty passphrase is rejected', async () => {
    await expect(deriveKey('', generateSalt(), FAST)).rejects.toThrow(/passphrase/);
  });

  test('a salt below the minimum length is rejected', async () => {
    await expect(deriveKey('pw', new Uint8Array(MIN_SALT_BYTES - 1), FAST)).rejects.toThrow(/salt/);
  });

  test('iterations < 1 is rejected', async () => {
    await expect(deriveKey('pw', generateSalt(), { iterations: 0 })).rejects.toThrow(/iterations/);
  });
});
