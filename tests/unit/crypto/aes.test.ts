// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  encryptBytes,
  decryptBytes,
  encryptString,
  decryptString,
  IV_BYTES
} from '../../../src/lib/crypto/aes';
import { deriveKey } from '../../../src/lib/crypto/kdf';
import { generateSalt } from '../../../src/lib/crypto/salt';

const FAST = { iterations: 1000 }; // low iterations: fast tests, same code path

async function freshKey(): Promise<CryptoKey> {
  return deriveKey('aes-test-passphrase', generateSalt(), FAST);
}

describe('aes-256-gcm', () => {
  test('byte round-trip preserves the plaintext exactly', async () => {
    const key = await freshKey();
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 250, 0, 99]);
    const out = await decryptBytes(key, await encryptBytes(key, plaintext));
    expect(Array.from(out)).toEqual(Array.from(plaintext));
  });

  test('string round-trip preserves unicode', async () => {
    const key = await freshKey();
    const text = 'café — $1,234.56 · 日本語 · 🔐';
    expect(await decryptString(key, await encryptString(key, text))).toBe(text);
  });

  test('a fresh IV per encrypt makes identical plaintext encrypt differently', async () => {
    const key = await freshKey();
    const pt = new TextEncoder().encode('same plaintext');
    const a = await encryptBytes(key, pt);
    const b = await encryptBytes(key, pt);
    expect(Array.from(a)).not.toEqual(Array.from(b)); // differing IVs ⇒ differing blobs
    expect(await decryptString(key, a)).toBe('same plaintext'); // still decrypts
  });

  test('blob layout is [IV][ciphertext+16-byte tag]', async () => {
    const key = await freshKey();
    const blob = await encryptBytes(key, new Uint8Array([42]));
    expect(blob.byteLength).toBe(IV_BYTES + 1 + 16); // 12 IV + 1 byte + 16 GCM tag
  });

  test('tampering any byte makes authenticated decryption fail', async () => {
    const key = await freshKey();
    const blob = await encryptBytes(key, new TextEncoder().encode('secret'));
    const i = blob.byteLength - 1; // flip a tag byte
    blob[i] = ((blob[i] ?? 0) ^ 0xff) & 0xff;
    await expect(decryptBytes(key, blob)).rejects.toThrow();
  });

  test('a wrong key cannot decrypt', async () => {
    const a = await freshKey();
    const b = await freshKey();
    const blob = await encryptBytes(a, new TextEncoder().encode('x'));
    await expect(decryptBytes(b, blob)).rejects.toThrow();
  });

  test('a blob shorter than the IV is rejected', async () => {
    const key = await freshKey();
    await expect(decryptBytes(key, new Uint8Array(5))).rejects.toThrow(/too short/);
  });
});
