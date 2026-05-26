import { describe, test, expect } from 'vitest';
import {
  encodeBlobFrame,
  decodeBlobFrame,
  BLOB_FORMAT_VERSION
} from '../../../src/lib/sync/blob-format';
import { BlobCorruptError } from '../../../src/lib/sync/types';

function fakeAesBlob(payload = 40): Uint8Array {
  const a = new Uint8Array(12 + payload + 16); // IV + payload + GCM tag
  for (let i = 0; i < a.length; i++) a[i] = i % 256;
  return a;
}

describe('blob-format framing', () => {
  test('encode then decode round-trips the AES blob and version', () => {
    const aes = fakeAesBlob();
    const { version, aesBlob } = decodeBlobFrame(encodeBlobFrame(aes));
    expect(version).toBe(BLOB_FORMAT_VERSION);
    expect(Array.from(aesBlob)).toEqual(Array.from(aes));
  });

  test("framed blob starts with the 'MTRB' magic", () => {
    const framed = encodeBlobFrame(fakeAesBlob());
    expect(new TextDecoder().decode(framed.subarray(0, 4))).toBe('MTRB');
  });

  test('bad magic throws BlobCorruptError', () => {
    const framed = encodeBlobFrame(fakeAesBlob());
    framed[0] = 0x00;
    expect(() => decodeBlobFrame(framed)).toThrow(BlobCorruptError);
  });

  test('a too-short blob throws BlobCorruptError', () => {
    expect(() => decodeBlobFrame(new Uint8Array(10))).toThrow(BlobCorruptError);
  });

  test('preserves a non-default format version', () => {
    expect(decodeBlobFrame(encodeBlobFrame(fakeAesBlob(), 7)).version).toBe(7);
  });
});
