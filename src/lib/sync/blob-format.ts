/**
 * Blob framing for sync. `SyncBlob.bytes` is UTF-8 JSON wrapped with an 8-byte
 * header:  [4 bytes magic 'MTRB'][4 bytes format version, big-endian][JSON bytes]
 * Pure functions — the provider never inspects these bytes (it treats them as opaque).
 */
import { BlobCorruptError } from './types';

const MAGIC = new Uint8Array([0x4d, 0x54, 0x52, 0x42]); // 'MTRB'
const HEADER_BYTES = 8; // 4 magic + 4 version

export const BLOB_FORMAT_VERSION = 1;

/** Wrap a payload (UTF-8 JSON bytes) with the magic + version header. */
export function encodeBlobFrame(
  payload: Uint8Array,
  version: number = BLOB_FORMAT_VERSION
): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + payload.byteLength);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, version, false); // big-endian
  out.set(payload, HEADER_BYTES);
  return out;
}

/** Validate + strip the header, returning the inner payload and format version. */
export function decodeBlobFrame(framed: Uint8Array): { version: number; payload: Uint8Array } {
  if (framed.byteLength < HEADER_BYTES) {
    throw new BlobCorruptError('sync blob too short to contain the header');
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
  return { version, payload: framed.subarray(HEADER_BYTES) };
}
