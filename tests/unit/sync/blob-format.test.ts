import { describe, test, expect } from 'vitest';
import {
  encodeBlobFrame,
  decodeBlobFrame,
  BLOB_FORMAT_VERSION
} from '../../../src/lib/sync/blob-format';
import { BlobCorruptError } from '../../../src/lib/sync/types';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('blob-format framing (plaintext payload)', () => {
  test('encode then decode round-trips the JSON payload and version', () => {
    const json = '{"version":1,"imports":[],"reconciliation_links":[]}';
    const { version, payload } = decodeBlobFrame(encodeBlobFrame(enc(json)));
    expect(version).toBe(BLOB_FORMAT_VERSION);
    expect(dec(payload)).toBe(json);
  });

  test("framed blob starts with the 'MTRB' magic", () => {
    const framed = encodeBlobFrame(enc('{}'));
    expect(dec(framed.subarray(0, 4))).toBe('MTRB');
  });

  test('bad magic throws BlobCorruptError', () => {
    const framed = encodeBlobFrame(enc('{}'));
    framed[0] = 0x00;
    expect(() => decodeBlobFrame(framed)).toThrow(BlobCorruptError);
  });

  test('a blob shorter than the 8-byte header throws BlobCorruptError', () => {
    expect(() => decodeBlobFrame(new Uint8Array(4))).toThrow(BlobCorruptError);
  });

  test('a tiny payload still round-trips — no AES-min-size assumption anymore', () => {
    const { payload } = decodeBlobFrame(encodeBlobFrame(enc('x')));
    expect(dec(payload)).toBe('x');
  });

  test('an empty payload is valid (header only)', () => {
    const { payload } = decodeBlobFrame(encodeBlobFrame(new Uint8Array(0)));
    expect(payload.byteLength).toBe(0);
  });

  test('preserves a non-default format version', () => {
    expect(decodeBlobFrame(encodeBlobFrame(enc('{}'), 7)).version).toBe(7);
  });
});
