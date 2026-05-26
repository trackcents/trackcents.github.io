/**
 * Per-user PBKDF2 salt management.
 *
 * Constitution Principle X: the salt is NON-SECRET (it just ensures two users
 * with the same passphrase derive different keys, and blocks precomputed-table
 * attacks). It is generated once at first setup and stored alongside the data.
 */

/** Salt length in bytes. */
export const SALT_BYTES = 16;

/** Generate a fresh cryptographically-random salt. */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** Encode a salt to base64 for storage (salt is non-secret). */
export function saltToBase64(salt: Uint8Array): string {
  let binary = '';
  for (const byte of salt) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decode a base64-encoded salt back to bytes. */
export function saltFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
