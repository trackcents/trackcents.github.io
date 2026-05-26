/**
 * AES-256-GCM authenticated encryption (Web Crypto API).
 *
 * Constitution Principle X. Wire format of the returned blob:
 *   [ 12-byte random IV ][ ciphertext + 16-byte GCM auth tag ]
 * A fresh random IV is generated on every encrypt (never reuse an IV under the
 * same key). GCM is authenticated, so any tampering (or a wrong key) makes
 * decryption fail rather than return garbage.
 */

/** GCM nonce length. 96 bits is the recommended/standard IV size for AES-GCM. */
export const IV_BYTES = 12;

export async function encryptBytes(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource)
  );
  const blob = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  blob.set(iv, 0);
  blob.set(ciphertext, IV_BYTES);
  return blob;
}

export async function decryptBytes(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.byteLength <= IV_BYTES) {
    throw new Error('decryptBytes: blob too short to contain an IV + ciphertext');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const ciphertext = blob.subarray(IV_BYTES);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ciphertext as BufferSource
      )
    );
  } catch {
    // Authentication failed: wrong key OR tampered data. Do not leak which one.
    throw new Error('decryptBytes: decryption failed (wrong key or corrupted/tampered data)');
  }
}

export async function encryptString(key: CryptoKey, text: string): Promise<Uint8Array> {
  return encryptBytes(key, new TextEncoder().encode(text));
}

export async function decryptString(key: CryptoKey, blob: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(key, blob));
}
