/**
 * Encrypted-blob framing for sync (T153). The on-the-wire `EncryptedBlob.ciphertext`
 * is the AES-GCM blob (12-byte IV + ciphertext + 16-byte tag, from crypto/aes)
 * wrapped with an 8-byte header:
 *   [4 bytes magic 'MTRB'][4 bytes format version, big-endian][AES blob]
 * Pure functions — the provider never inspects these bytes (it only sees ciphertext).
 */
import { BlobCorruptError } from './types';

const MAGIC = new Uint8Array([0x4d, 0x54, 0x52, 0x42]); // 'MTRB'
const HEADER_BYTES = 8; // 4 magic + 4 version
const MIN_AES_BLOB = 12 + 16; // IV + GCM tag (empty plaintext)

export const BLOB_FORMAT_VERSION = 1;

/** Wrap an AES-GCM blob (iv+ciphertext+tag) with the magic + version header. */
export function encodeBlobFrame(
  aesBlob: Uint8Array,
  version: number = BLOB_FORMAT_VERSION
): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + aesBlob.byteLength);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, version, false); // big-endian
  out.set(aesBlob, HEADER_BYTES);
  return out;
}

/** Validate + strip the header, returning the inner AES blob and format version. */
export function decodeBlobFrame(framed: Uint8Array): { version: number; aesBlob: Uint8Array } {
  if (framed.byteLength < HEADER_BYTES + MIN_AES_BLOB) {
    throw new BlobCorruptError('sync blob too short to contain header + IV + tag');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (framed[i] !== MAGIC[i]) {
      throw new BlobCorruptError("sync blob has bad magic bytes (expected 'MTRB')");
    }
  }
  const version = new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getUint32(
    4,
    false
  );
  return { version, aesBlob: framed.subarray(HEADER_BYTES) };
}
