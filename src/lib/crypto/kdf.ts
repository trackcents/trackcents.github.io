/**
 * Passphrase → AES-256-GCM key derivation via PBKDF2-SHA-256 (Web Crypto).
 *
 * Constitution Principle X (Encryption specifics): PBKDF2-SHA-256, 600,000
 * iterations, per-user salt (the salt is non-secret; see salt.ts). The derived
 * key is NON-EXTRACTABLE — it lives in the runtime's key store and is never
 * serialized, so the passphrase cannot be recovered from a leaked key handle.
 */

/** Constitutional iteration count. Production MUST use this; tests may lower it for speed. */
export const KDF_ITERATIONS = 600_000;

/** Minimum acceptable salt length in bytes (see salt.ts SALT_BYTES = 16). */
export const MIN_SALT_BYTES = 16;

export interface DeriveKeyOptions {
  /** Override the iteration count. Tests use a low value for speed; production MUST use KDF_ITERATIONS. */
  iterations?: number;
}

/**
 * Derive a 256-bit AES-GCM key from `passphrase` + `salt`. Deterministic: the
 * same inputs always yield interoperable keys (so a returning user re-deriving
 * the key can decrypt data encrypted in a previous session).
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  options: DeriveKeyOptions = {}
): Promise<CryptoKey> {
  if (passphrase.length === 0) {
    throw new Error('deriveKey: passphrase must not be empty');
  }
  if (salt.byteLength < MIN_SALT_BYTES) {
    throw new Error(`deriveKey: salt must be at least ${MIN_SALT_BYTES} bytes`);
  }
  const iterations = options.iterations ?? KDF_ITERATIONS;
  if (iterations < 1) {
    throw new Error('deriveKey: iterations must be >= 1');
  }

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}
