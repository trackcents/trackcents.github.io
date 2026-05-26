// @vitest-environment node
//
// ============================================================================
// IV&V — P0 Crypto / Security modules
// Independent Verification & Validation. The author of this file has NOT read
// the implementation bodies of the modules under test. Expected behavior is
// derived from:
//   - the CONTRACT (the spawn prompt) + constitution Principle X
//   - the cited standards (PBKDF2-SHA-256 / AES-256-GCM, Web Crypto)
//   - ORACLE-INDEPENDENT cross-checks against Node's own `node:crypto`
//     (a completely separate PBKDF2 + AES-GCM implementation)
//
// Modules under test (imported by PUBLIC API only):
//   src/lib/crypto/kdf.ts, aes.ts, salt.ts, session.ts
//   src/lib/db/store-crypto.ts, src/lib/app/unlock.ts
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as nodeCrypto from 'node:crypto';

// ---- DUT public API imports (interface only) -------------------------------
import { deriveKey, KDF_ITERATIONS, MIN_SALT_BYTES } from '../../../src/lib/crypto/kdf';
import {
  encryptBytes,
  decryptBytes,
  encryptString,
  decryptString,
  IV_BYTES
} from '../../../src/lib/crypto/aes';
import { generateSalt, saltToBase64, saltFromBase64 } from '../../../src/lib/crypto/salt';
import {
  setSessionKey,
  clearSessionKey,
  getSessionKey,
  isUnlocked
} from '../../../src/lib/crypto/session';
import {
  encodeStateForStorage,
  decodeStateFromStorage,
  isEncryptedBlob
} from '../../../src/lib/db/store-crypto';

import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---- Reference-model knobs --------------------------------------------------
// Real iteration count is 600_000; for stimulus we use a low count for speed.
// The 600_000 CONSTANT itself is asserted directly (Phase: kdf C1).
const FAST_ITERS = 10;

// ============================================================================
// INDEPENDENT REFERENCE MODEL (node:crypto — a different implementation)
// ============================================================================

/** Independent PBKDF2-SHA256 → raw 32 bytes, computed with node:crypto. */
function refPbkdf2Raw(passphrase: string, salt: Uint8Array, iterations: number): Buffer {
  return nodeCrypto.pbkdf2Sync(
    Buffer.from(passphrase, 'utf-8'),
    Buffer.from(salt),
    iterations,
    32,
    'sha256'
  );
}

/** Import raw AES bytes as a Web Crypto AES-GCM key (so it interoperates with the DUT). */
async function importRawAesGcm(raw: Buffer): Promise<CryptoKey> {
  // Copy into a fresh ArrayBuffer-backed Uint8Array so the type is exactly
  // ArrayBufferView<ArrayBuffer> (Node Buffer's backing store is ArrayBufferLike).
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** node:crypto AES-256-GCM encrypt → DUT layout: IV(12) || ciphertext || tag(16). */
function refEncryptGcm(raw: Buffer, iv: Buffer, plaintext: Buffer): Uint8Array {
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', raw, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  return new Uint8Array(Buffer.concat([iv, ct, tag]));
}

/** node:crypto AES-256-GCM decrypt of a DUT-layout blob. Throws on tamper/wrong key. */
function refDecryptGcm(raw: Buffer, blob: Uint8Array): Uint8Array {
  const iv = Buffer.from(blob.slice(0, 12));
  const tag = Buffer.from(blob.slice(blob.length - 16));
  const ct = Buffer.from(blob.slice(12, blob.length - 16));
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', raw, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ct), decipher.final()]));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// ============================================================================
// FUNCTIONAL COVERAGE MODEL (verification plan cover points)
// ============================================================================
const cov = new CoverageModel([
  // kdf
  'kdf:default-iters-constant',
  'kdf:salt-min-constant',
  'kdf:interop-with-node-pbkdf2',
  'kdf:deterministic-same-inputs',
  'kdf:different-salt-different-key',
  'kdf:different-iters-different-key',
  'kdf:key-nonextractable',
  'kdf:key-usages-encrypt-decrypt',
  'kdf:key-is-aes256',
  'kdf:reject-empty-passphrase',
  'kdf:reject-short-salt',
  'kdf:accept-salt-exactly-min',
  'kdf:reject-iters-below-1',
  'kdf:unicode-passphrase',
  // aes
  'aes:iv-bytes-constant',
  'aes:layout-iv-prefix',
  'aes:fresh-iv-each-encrypt',
  'aes:roundtrip-bytes',
  'aes:roundtrip-empty-bytes',
  'aes:roundtrip-unicode-string',
  'aes:decrypt-wrong-key-throws',
  'aes:decrypt-tampered-iv-throws',
  'aes:decrypt-tampered-ct-throws',
  'aes:decrypt-tampered-tag-throws',
  'aes:decrypt-truncated-blob-throws',
  'aes:decrypt-blob-eq-ivbytes-throws',
  'aes:cross-decrypt-node-blob',
  'aes:cross-encrypt-for-node',
  // salt
  'salt:length-16',
  'salt:randomness',
  'salt:base64-roundtrip',
  'salt:base64-roundtrip-00-FF',
  'salt:base64-roundtrip-empty',
  // store-crypto
  'sc:no-key-encode-passthrough',
  'sc:no-key-decode-plaintext',
  'sc:key-encode-is-blob',
  'sc:key-roundtrip',
  'sc:blob-no-key-locked',
  'sc:wrong-key-decode-throws',
  'sc:large-input-roundtrip',
  'sc:isEncryptedBlob-true-on-blob',
  'sc:isEncryptedBlob-false-on-plaintext',
  // unlock
  'unlock:right-passphrase-true-key-retained',
  'unlock:wrong-passphrase-false-no-key',
  'unlock:hasStoredSalt',
  'unlock:no-salt-stored-false',
  'unlock:salt-key-constant-value'
]);

// ============================================================================
// localStorage stub (node has none) — Map-backed, matches Web Storage shape.
// ============================================================================
function installLocalStorageStub(): Map<string, string> {
  const m = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    }
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = stub;
  return m;
}
function uninstallLocalStorageStub(): void {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

// ============================================================================
// MODULE 1 — kdf.ts
// ============================================================================
describe('IV&V kdf.ts — PBKDF2-SHA-256 → AES-256-GCM key', () => {
  test('C1: KDF_ITERATIONS === 600000 and MIN_SALT_BYTES === 16 (constitution Principle X)', () => {
    expect(KDF_ITERATIONS).toBe(600_000);
    cov.cover('kdf:default-iters-constant');
    expect(MIN_SALT_BYTES).toBe(16);
    cov.cover('kdf:salt-min-constant');
  });

  test('C2: INTEROP — DUT key interoperates with an independent node:crypto PBKDF2 key', async () => {
    // Oracle-independent: derive raw bytes with node:crypto, build a Web Crypto key
    // from them, and confirm DUT key <-> node key decrypt each other's ciphertext.
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.uint8Array({ minLength: 16, maxLength: 32 }),
        fc.uint8Array({ minLength: 0, maxLength: 64 }),
        async (pass, saltArr, ptArr) => {
          const salt = saltArr.length >= 16 ? saltArr : new Uint8Array(16);
          const pt = new Uint8Array(ptArr);
          const dutKey = await deriveKey(pass, salt, { iterations: FAST_ITERS });
          const raw = refPbkdf2Raw(pass, salt, FAST_ITERS);
          const refKey = await importRawAesGcm(raw);

          // DUT encrypts -> ref (node raw) decrypts
          const dutBlob = await encryptBytes(dutKey, pt);
          const recovered = refDecryptGcm(raw, dutBlob);
          expect(new Uint8Array(recovered)).toEqual(pt);

          // ref(node) encrypts -> DUT key decrypts  (cross-compat the other way)
          const iv = nodeCrypto.randomBytes(12);
          const nodeBlob = refEncryptGcm(raw, iv, Buffer.from(pt));
          const dutRecovered = await decryptBytes(refKey, nodeBlob); // ref key decrypts ref blob (sanity)
          expect(new Uint8Array(dutRecovered)).toEqual(pt);
          const dutRecovered2 = await decryptBytes(dutKey, nodeBlob); // DUT key decrypts node blob
          expect(new Uint8Array(dutRecovered2)).toEqual(pt);
        }
      ),
      { numRuns: 25 }
    );
    cov.cover('kdf:interop-with-node-pbkdf2');
  });

  test('C3: deterministic — same (passphrase,salt,iters) => interoperable keys', async () => {
    const salt = generateSalt();
    const k1 = await deriveKey('correct horse battery staple', salt, { iterations: FAST_ITERS });
    const k2 = await deriveKey('correct horse battery staple', salt, { iterations: FAST_ITERS });
    const blob = await encryptString(k1, 'hello-determinism');
    expect(await decryptString(k2, blob)).toBe('hello-determinism');
    cov.cover('kdf:deterministic-same-inputs');
  });

  test('C4: different salt => non-interoperable key (decrypt fails)', async () => {
    const k1 = await deriveKey('pw', new Uint8Array(16).fill(1), { iterations: FAST_ITERS });
    const k2 = await deriveKey('pw', new Uint8Array(16).fill(2), { iterations: FAST_ITERS });
    const blob = await encryptString(k1, 'x');
    await expect(decryptString(k2, blob)).rejects.toThrow();
    cov.cover('kdf:different-salt-different-key');
  });

  test('C5: different iterations => non-interoperable key', async () => {
    const salt = new Uint8Array(16).fill(7);
    const k1 = await deriveKey('pw', salt, { iterations: FAST_ITERS });
    const k2 = await deriveKey('pw', salt, { iterations: FAST_ITERS + 1 });
    const blob = await encryptString(k1, 'x');
    await expect(decryptString(k2, blob)).rejects.toThrow();
    cov.cover('kdf:different-iters-different-key');
  });

  test('C6: key is AES-256-GCM, NON-EXTRACTABLE, usages encrypt+decrypt', async () => {
    const key = await deriveKey('pw', new Uint8Array(16).fill(3), { iterations: FAST_ITERS });
    // type guard: only CryptoKey has .algorithm/.extractable/.usages
    const ck = key as CryptoKey;
    expect(ck.type).toBe('secret');
    expect(ck.extractable).toBe(false);
    cov.cover('kdf:key-nonextractable');
    const algo = ck.algorithm as AesKeyAlgorithm;
    expect(algo.name).toBe('AES-GCM');
    expect(algo.length).toBe(256);
    cov.cover('kdf:key-is-aes256');
    expect([...ck.usages].sort()).toEqual(['decrypt', 'encrypt']);
    cov.cover('kdf:key-usages-encrypt-decrypt');
    // Independent proof of non-extractability: exportKey must reject.
    await expect(crypto.subtle.exportKey('raw', ck)).rejects.toThrow();
  });

  test('C7: rejects empty passphrase', async () => {
    await expect(deriveKey('', new Uint8Array(16), { iterations: FAST_ITERS })).rejects.toThrow();
    cov.cover('kdf:reject-empty-passphrase');
  });

  test('C8: rejects salt shorter than MIN_SALT_BYTES (boundary: 15 rejects, 16 accepts)', async () => {
    await expect(
      deriveKey('pw', new Uint8Array(MIN_SALT_BYTES - 1), { iterations: FAST_ITERS })
    ).rejects.toThrow();
    cov.cover('kdf:reject-short-salt');
    // boundary just-at-threshold must succeed
    const k = await deriveKey('pw', new Uint8Array(MIN_SALT_BYTES), { iterations: FAST_ITERS });
    expect((k as CryptoKey).type).toBe('secret');
    cov.cover('kdf:accept-salt-exactly-min');
  });

  test('C9: rejects iterations < 1 (0 and negative)', async () => {
    await expect(deriveKey('pw', new Uint8Array(16), { iterations: 0 })).rejects.toThrow();
    await expect(deriveKey('pw', new Uint8Array(16), { iterations: -5 })).rejects.toThrow();
    cov.cover('kdf:reject-iters-below-1');
  });

  test('C10: unicode passphrase derives a working, node-interoperable key', async () => {
    const pass = '🔐pässwörd—日本語';
    const salt = new Uint8Array(16).fill(9);
    const dutKey = await deriveKey(pass, salt, { iterations: FAST_ITERS });
    const raw = refPbkdf2Raw(pass, salt, FAST_ITERS);
    const blob = await encryptBytes(dutKey, enc.encode('ünïçødé'));
    expect(dec.decode(refDecryptGcm(raw, blob))).toBe('ünïçødé');
    cov.cover('kdf:unicode-passphrase');
  });
});

// ============================================================================
// MODULE 2 — aes.ts  (AES-256-GCM, layout IV(12)||ct||tag(16))
// ============================================================================
describe('IV&V aes.ts — AES-256-GCM encrypt/decrypt', () => {
  let key: CryptoKey;
  let raw: Buffer;
  const salt = new Uint8Array(16).fill(42);
  beforeEach(async () => {
    key = await deriveKey('aes-test-pw', salt, { iterations: FAST_ITERS });
    raw = refPbkdf2Raw('aes-test-pw', salt, FAST_ITERS);
  });

  test('A1: IV_BYTES === 12', () => {
    expect(IV_BYTES).toBe(12);
    cov.cover('aes:iv-bytes-constant');
  });

  test('A2: SCOREBOARD — DUT round-trip vs node:crypto reference (bytes), with layout + fresh-IV checks', async () => {
    // We cannot scoreboard ciphertext byte-equality (random IV), so the scoreboard
    // judges the OBSERVABLE: decrypt(node-raw, dutBlob) === plaintext.
    let comparisons = 0;
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 0, maxLength: 200 }), async (ptArr) => {
        const pt = new Uint8Array(ptArr);
        const blob = await encryptBytes(key, pt);
        // layout: at least IV + tag overhead; first 12 bytes are IV
        expect(blob.length).toBe(pt.length + IV_BYTES + 16);
        // independent oracle: node decrypts the DUT blob
        const recovered = refDecryptGcm(raw, blob);
        expect(new Uint8Array(recovered)).toEqual(pt);
        // DUT also round-trips its own
        const dutRecovered = await decryptBytes(key, blob);
        expect(new Uint8Array(dutRecovered)).toEqual(pt);
        comparisons++;
      }),
      { numRuns: 50 }
    );
    expect(comparisons).toBe(50);
    cov.cover('aes:layout-iv-prefix');
    cov.cover('aes:roundtrip-bytes');
    cov.cover('aes:cross-decrypt-node-blob');
  });

  test('A3: empty-bytes round-trip', async () => {
    const blob = await encryptBytes(key, new Uint8Array(0));
    expect(blob.length).toBe(IV_BYTES + 16);
    expect(new Uint8Array(await decryptBytes(key, blob))).toEqual(new Uint8Array(0));
    cov.cover('aes:roundtrip-empty-bytes');
  });

  test('A4: fresh random IV each encrypt — same plaintext => different blobs + different IV', async () => {
    const pt = enc.encode('repeat me');
    const blobs = await Promise.all(Array.from({ length: 8 }, () => encryptBytes(key, pt)));
    const ivs = new Set(blobs.map((b) => Buffer.from(b.slice(0, IV_BYTES)).toString('hex')));
    expect(ivs.size).toBe(8); // all IVs distinct
    const full = new Set(blobs.map((b) => Buffer.from(b).toString('hex')));
    expect(full.size).toBe(8); // all blobs distinct
    cov.cover('aes:fresh-iv-each-encrypt');
  });

  test('A5: unicode string round-trip (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 300 }), async (s) => {
        const blob = await encryptString(key, s);
        expect(await decryptString(key, blob)).toBe(s);
        // independent oracle: node decrypts -> utf8 equals s
        expect(dec.decode(refDecryptGcm(raw, blob))).toBe(s);
      }),
      { numRuns: 40 }
    );
    cov.cover('aes:roundtrip-unicode-string');
  });

  test('A6: decrypt with WRONG key throws', async () => {
    const wrong = await deriveKey('different-pw', salt, { iterations: FAST_ITERS });
    const blob = await encryptString(key, 'secret');
    await expect(decryptBytes(wrong, blob)).rejects.toThrow();
    await expect(decryptString(wrong, blob)).rejects.toThrow();
    cov.cover('aes:decrypt-wrong-key-throws');
  });

  test('A7: ADVERSARIAL — any single tampered byte (IV / ct / tag) makes decrypt throw', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 80 }),
        fc.nat(),
        async (ptArr, idxSeed) => {
          const pt = new Uint8Array(ptArr);
          const blob = await encryptBytes(key, pt);
          const i = idxSeed % blob.length;
          const tampered = Uint8Array.from(blob);
          tampered[i] = tampered[i]! ^ 0xff; // flip all bits at one position
          await expect(decryptBytes(key, tampered)).rejects.toThrow();
        }
      ),
      { numRuns: 60 }
    );
    // Directed: explicitly hit IV region, ciphertext region, tag region
    const pt = enc.encode('directed-tamper-target-payload');
    const baseBlob = await encryptBytes(key, pt);
    const flip = async (i: number) => {
      const t = Uint8Array.from(baseBlob);
      t[i] = t[i]! ^ 0x01;
      await expect(decryptBytes(key, t)).rejects.toThrow();
    };
    await flip(0); // IV
    cov.cover('aes:decrypt-tampered-iv-throws');
    await flip(IV_BYTES + 1); // ciphertext
    cov.cover('aes:decrypt-tampered-ct-throws');
    await flip(baseBlob.length - 1); // tag
    cov.cover('aes:decrypt-tampered-tag-throws');
  });

  test('A8: decrypt of blob length <= IV_BYTES throws (boundary 0,1,11,12)', async () => {
    for (const n of [0, 1, IV_BYTES - 1, IV_BYTES]) {
      await expect(decryptBytes(key, new Uint8Array(n))).rejects.toThrow();
    }
    cov.cover('aes:decrypt-blob-eq-ivbytes-throws');
    cov.cover('aes:decrypt-truncated-blob-throws');
  });

  test('A9: CROSS — DUT decrypts a blob produced entirely by node:crypto (same raw key)', async () => {
    const pt = enc.encode('encrypted by node, decrypted by the app');
    const iv = nodeCrypto.randomBytes(12);
    const nodeBlob = refEncryptGcm(raw, iv, Buffer.from(pt));
    expect(dec.decode(await decryptBytes(key, nodeBlob))).toBe(
      'encrypted by node, decrypted by the app'
    );
    cov.cover('aes:cross-encrypt-for-node');
  });
});

// ============================================================================
// MODULE 3 — salt.ts
// ============================================================================
describe('IV&V salt.ts — random salt + lossless base64', () => {
  test('S1: generateSalt() is exactly 16 bytes', () => {
    const s = generateSalt();
    expect(s).toBeInstanceOf(Uint8Array);
    expect(s.length).toBe(16);
    cov.cover('salt:length-16');
  });

  test('S2: generateSalt() is random (256 samples => all distinct; rough byte spread)', () => {
    const seen = new Set<string>();
    let allZero = 0;
    for (let i = 0; i < 256; i++) {
      const s = generateSalt();
      seen.add(Buffer.from(s).toString('hex'));
      if (s.every((b) => b === 0)) allZero++;
    }
    expect(seen.size).toBe(256); // collision-free over 256 draws of 16 random bytes
    expect(allZero).toBe(0); // a 16-byte all-zero salt is astronomically unlikely
    cov.cover('salt:randomness');
  });

  test('S3: base64 round-trip is lossless (property, incl. 0x00 and 0xFF)', () => {
    const sb = new Scoreboard<Uint8Array, string>({
      // model: independent base64 via node Buffer
      model: (bytes) => Buffer.from(bytes).toString('base64'),
      dut: (bytes) => saltToBase64(bytes)
    });
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (arr) => {
        const bytes = new Uint8Array(arr);
        sb.check(bytes);
        // full round-trip through the DUT recovers the exact bytes
        const restored = saltFromBase64(saltToBase64(bytes));
        expect(new Uint8Array(restored)).toEqual(bytes);
        // and the DUT can decode an independently-produced base64
        const fromNode = saltFromBase64(Buffer.from(bytes).toString('base64'));
        expect(new Uint8Array(fromNode)).toEqual(bytes);
      }),
      { numRuns: 200 }
    );
    sb.assertClean();
    cov.cover('salt:base64-roundtrip');
  });

  test('S4: explicit 0x00 / 0xFF boundary bytes round-trip', () => {
    const edge = new Uint8Array([0x00, 0xff, 0x00, 0xff, 0x80, 0x7f, 0x01, 0xfe]);
    expect(new Uint8Array(saltFromBase64(saltToBase64(edge)))).toEqual(edge);
    cov.cover('salt:base64-roundtrip-00-FF');
    const empty = new Uint8Array(0);
    expect(new Uint8Array(saltFromBase64(saltToBase64(empty)))).toEqual(empty);
    cov.cover('salt:base64-roundtrip-empty');
  });
});

// ============================================================================
// MODULE 4 — store-crypto.ts + session.ts
// ============================================================================
describe('IV&V store-crypto.ts — encode/decode at rest using session key', () => {
  beforeEach(() => clearSessionKey());
  afterEach(() => clearSessionKey());

  test('SC1: NO key — encode returns plaintext unchanged; decode => {plaintext}', async () => {
    expect(isUnlocked()).toBe(false);
    const json = '{"hello":"world","n":1}';
    const encoded = await encodeStateForStorage(json);
    expect(encoded).toBe(json); // pass-through
    cov.cover('sc:no-key-encode-passthrough');
    const decoded = await decodeStateFromStorage(encoded);
    expect(decoded.kind).toBe('plaintext');
    if (decoded.kind === 'plaintext') expect(decoded.json).toBe(json);
    cov.cover('sc:no-key-decode-plaintext');
    // a clearly-plaintext string is not flagged as an encrypted blob
    expect(isEncryptedBlob(json)).toBe(false);
    cov.cover('sc:isEncryptedBlob-false-on-plaintext');
  });

  test('SC2: WITH key — encode produces an opaque blob; decode round-trips to input', async () => {
    const key = await deriveKey('store-pw', new Uint8Array(16).fill(5), { iterations: FAST_ITERS });
    setSessionKey(key);
    expect(isUnlocked()).toBe(true);
    expect(getSessionKey()).not.toBeNull();

    const json = '{"transactions":[{"amount_minor":"12345","currency":"USD"}]}';
    const blob = await encodeStateForStorage(json);
    expect(blob).not.toBe(json);
    expect(isEncryptedBlob(blob)).toBe(true); // marker prefix present
    cov.cover('sc:key-encode-is-blob');
    cov.cover('sc:isEncryptedBlob-true-on-blob');
    // opaque: the plaintext json must NOT appear verbatim inside the blob
    expect(blob.includes('amount_minor')).toBe(false);
    expect(blob.includes('12345')).toBe(false);

    const decoded = await decodeStateFromStorage(blob);
    expect(decoded.kind).toBe('decrypted');
    if (decoded.kind === 'decrypted') expect(decoded.json).toBe(json);
    cov.cover('sc:key-roundtrip');
  });

  test('SC3: encrypted blob with NO key => {locked}', async () => {
    const key = await deriveKey('lock-pw', new Uint8Array(16).fill(6), { iterations: FAST_ITERS });
    setSessionKey(key);
    const blob = await encodeStateForStorage('{"x":1}');
    clearSessionKey(); // simulate fresh page load before unlock
    expect(isUnlocked()).toBe(false);
    const decoded = await decodeStateFromStorage(blob);
    expect(decoded.kind).toBe('locked');
    cov.cover('sc:blob-no-key-locked');
  });

  test('SC4: encrypted blob with WRONG key => decode throws (loud failure, not silent)', async () => {
    const k1 = await deriveKey('right-pw', new Uint8Array(16).fill(8), { iterations: FAST_ITERS });
    setSessionKey(k1);
    const blob = await encodeStateForStorage('{"secret":true}');
    const k2 = await deriveKey('WRONG-pw', new Uint8Array(16).fill(8), { iterations: FAST_ITERS });
    setSessionKey(k2);
    await expect(decodeStateFromStorage(blob)).rejects.toThrow();
    cov.cover('sc:wrong-key-decode-throws');
  });

  test('SC5: large input round-trips (1 MB), conservation: decoded === original', async () => {
    const key = await deriveKey('big-pw', new Uint8Array(16).fill(11), { iterations: FAST_ITERS });
    setSessionKey(key);
    const big = JSON.stringify({ blob: 'A'.repeat(1_000_000), n: 42 });
    const encoded = await encodeStateForStorage(big);
    expect(isEncryptedBlob(encoded)).toBe(true);
    const decoded = await decodeStateFromStorage(encoded);
    expect(decoded.kind).toBe('decrypted');
    if (decoded.kind === 'decrypted') expect(decoded.json).toBe(big);
    cov.cover('sc:large-input-roundtrip');
  });

  test('SC6: METAMORPHIC — encode∘decode is identity for arbitrary JSON-ish payloads (with key)', async () => {
    const key = await deriveKey('mm-pw', new Uint8Array(16).fill(13), { iterations: FAST_ITERS });
    setSessionKey(key);
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 500 }), async (s) => {
        const encoded = await encodeStateForStorage(s);
        const decoded = await decodeStateFromStorage(encoded);
        // with a key, any input encodes to a blob that decrypts back to the same string
        expect(decoded.kind).toBe('decrypted');
        if (decoded.kind === 'decrypted') expect(decoded.json).toBe(s);
      }),
      { numRuns: 30 }
    );
  });
});

// ============================================================================
// MODULE 5 — unlock.ts (right/wrong passphrase outcomes via stubbed storage)
// ============================================================================
describe('IV&V unlock.ts — attemptUnlock right/wrong passphrase', () => {
  // Imported lazily after the localStorage stub is installed so any module-load
  // side effects see the stub. unlock + store are imported dynamically per test.
  beforeEach(() => {
    clearSessionKey();
    installLocalStorageStub();
  });
  afterEach(() => {
    clearSessionKey();
    uninstallLocalStorageStub();
  });

  test('U1: hasStoredSalt reflects presence of the salt key; SALT_STORAGE_KEY pinned', async () => {
    const { hasStoredSalt, SALT_STORAGE_KEY } = await import('../../../src/lib/app/unlock');
    // Pin the literal: the contract names this stored key; changing it silently
    // would orphan every existing user's stored salt. (Kills the StringLiteral mutant.)
    expect(SALT_STORAGE_KEY).toBe('mtrb.salt');
    cov.cover('unlock:salt-key-constant-value');
    expect(hasStoredSalt()).toBe(false);
    localStorage.setItem(SALT_STORAGE_KEY, saltToBase64(generateSalt()));
    expect(hasStoredSalt()).toBe(true);
    cov.cover('unlock:hasStoredSalt');
  });

  test('U3: attemptUnlock returns false (no key) when NO salt is stored', async () => {
    const { attemptUnlock } = await import('../../../src/lib/app/unlock');
    // Fresh stub: nothing stored at all. Even a "correct-looking" passphrase
    // cannot unlock when there is no salt/blob to verify against.
    expect(await attemptUnlock('anything-at-all')).toBe(false);
    expect(isUnlocked()).toBe(false);
    expect(getSessionKey()).toBeNull();
    cov.cover('unlock:no-salt-stored-false');
  });

  test('U2: RIGHT passphrase => true + session key retained; WRONG => false + no key', async () => {
    const { attemptUnlock, SALT_STORAGE_KEY } = await import('../../../src/lib/app/unlock');
    const { saveState, serializeState } = await import('../../../src/lib/db/store');

    // --- Onboarding simulation (no source peeking; uses public API only) ------
    const PASSPHRASE = 'a-strong-correct-passphrase-123';
    const salt = generateSalt();
    localStorage.setItem(SALT_STORAGE_KEY, saltToBase64(salt));
    // derive the real key (low iters for speed), set as session, persist encrypted state
    const key = await deriveKey(PASSPHRASE, salt, { iterations: FAST_ITERS });
    setSessionKey(key);
    // build a minimal valid PersistedState by serializing an empty-ish state through the store,
    // then saving it so the store writes an ENCRYPTED blob to localStorage.
    // We need a valid PersistedState; obtain one via deserializeState of a known-good shape.
    const { deserializeState } = await import('../../../src/lib/db/store');
    const baseState = deserializeState(
      serializeState(deserializeState('{"version":1,"imports":[],"reconciliationLinks":[]}'))
    );
    await saveState(baseState);

    // confirm an encrypted blob now sits in storage
    const stored = localStorage.getItem('money-tracker:state');
    expect(stored).not.toBeNull();
    expect(isEncryptedBlob(stored!)).toBe(true);

    // simulate fresh load: clear the in-memory key
    clearSessionKey();
    expect(isUnlocked()).toBe(false);

    // attemptUnlock MUST re-derive from stored salt and verify decryption.
    // Use the SAME iteration count the app uses by default. Since the blob was
    // encrypted with a FAST_ITERS key, attemptUnlock (which uses KDF_ITERATIONS
    // = 600000 internally) would derive a DIFFERENT key and fail. To test the
    // right/wrong OUTCOME without a 600k-iteration cost, we re-create the blob
    // using a key derived at the DEFAULT iteration count is infeasible in test
    // time. Instead we assert the OUTCOME CONTRACT against attemptUnlock's own
    // derivation by re-encrypting with a default-iteration key.
    // (See report note "Ambiguity A2" — resolved by exercising the real path.)

    // Re-key storage with a DEFAULT-iteration key so attemptUnlock's internal
    // derivation matches. This is the real production path (600k iters).
    const realKey = await deriveKey(PASSPHRASE, salt); // default KDF_ITERATIONS
    setSessionKey(realKey);
    await saveState(baseState);
    clearSessionKey();

    // WRONG passphrase => false, no key retained
    const wrong = await attemptUnlock('totally-wrong-passphrase');
    expect(wrong).toBe(false);
    expect(isUnlocked()).toBe(false);
    expect(getSessionKey()).toBeNull();
    cov.cover('unlock:wrong-passphrase-false-no-key');

    // RIGHT passphrase => true, key retained
    const ok = await attemptUnlock(PASSPHRASE);
    expect(ok).toBe(true);
    expect(isUnlocked()).toBe(true);
    expect(getSessionKey()).not.toBeNull();
    cov.cover('unlock:right-passphrase-true-key-retained');
  }, 60_000); // allow time for two real 600k-iteration derivations
});

// ============================================================================
// COVERAGE CLOSURE GATE + reference-model self-mutation (bench-has-teeth proof)
// ============================================================================
describe('IV&V sign-off gates', () => {
  test('Z1: functional coverage closure', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });

  test('Z2: bench-has-teeth — a deliberately broken reference model is caught by the scoreboard', () => {
    // Sanity: corrupt the base64 reference model (off-by-one truncation) and prove
    // the scoreboard FAILS. This shows the scoreboard isn't vacuously passing.
    const sb = new Scoreboard<Uint8Array, string>({
      model: (bytes) => Buffer.from(bytes).toString('base64').slice(0, -1) + 'X', // CORRUPTED
      dut: (bytes) => saltToBase64(bytes)
    });
    sb.check(new Uint8Array([1, 2, 3, 4, 5]));
    expect(() => sb.assertClean()).toThrow(/mismatch/i);
  });
});
