// @vitest-environment node
import { describe, expect, test, beforeEach } from 'vitest';
import {
  encodeStateForStorage,
  decodeStateFromStorage,
  isEncryptedBlob
} from '../../../src/lib/db/store-crypto';
import { setSessionKey, clearSessionKey } from '../../../src/lib/crypto/session';
import { deriveKey } from '../../../src/lib/crypto/kdf';
import { generateSalt } from '../../../src/lib/crypto/salt';

const SAMPLE = '{"version":1,"imports":[],"reconciliation_links":[]}';
const FAST = { iterations: 1000 };

async function key() {
  return deriveKey('store-pw', generateSalt(), FAST);
}

beforeEach(() => clearSessionKey());

describe('store-crypto — encryption-at-rest', () => {
  test('no session key → plaintext passthrough (local-only mode)', async () => {
    const encoded = await encodeStateForStorage(SAMPLE);
    expect(encoded).toBe(SAMPLE);
    expect(isEncryptedBlob(encoded)).toBe(false);
    expect(await decodeStateFromStorage(encoded)).toEqual({ kind: 'plaintext', json: SAMPLE });
  });

  test('with session key → encrypted blob that round-trips to the same JSON', async () => {
    setSessionKey(await key());
    const encoded = await encodeStateForStorage(SAMPLE);
    expect(isEncryptedBlob(encoded)).toBe(true);
    expect(encoded).not.toContain('reconciliation_links'); // plaintext is not readable in the blob
    const decoded = await decodeStateFromStorage(encoded);
    expect(decoded.kind).toBe('decrypted');
    if (decoded.kind === 'decrypted') expect(decoded.json).toBe(SAMPLE);
  });

  test('encrypted blob with no key loaded → locked', async () => {
    setSessionKey(await key());
    const encoded = await encodeStateForStorage(SAMPLE);
    clearSessionKey();
    expect((await decodeStateFromStorage(encoded)).kind).toBe('locked');
  });

  test('wrong key → decryption throws (authenticated)', async () => {
    setSessionKey(await key());
    const encoded = await encodeStateForStorage(SAMPLE);
    setSessionKey(await key()); // different salt ⇒ different key
    await expect(decodeStateFromStorage(encoded)).rejects.toThrow();
  });

  test('large state round-trips (chunked base64)', async () => {
    setSessionKey(await key());
    const big = JSON.stringify({
      version: 1,
      note: 'x'.repeat(100_000),
      imports: [],
      reconciliation_links: []
    });
    const decoded = await decodeStateFromStorage(await encodeStateForStorage(big));
    expect(decoded.kind === 'decrypted' && decoded.json === big).toBe(true);
  });
});
