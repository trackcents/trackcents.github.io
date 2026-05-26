/**
 * Encryption-at-rest for the persisted store (T109, constitution Principle X).
 *
 * The serialized-state string is encrypted with the in-memory session key
 * (AES-256-GCM, see crypto/aes) when the user is unlocked. A marker prefix lets
 * plaintext (local-only / pre-onboarding) and encrypted blobs coexist and migrate
 * forward transparently:
 *   - no session key            → stored as plaintext JSON (legacy behavior)
 *   - session key set           → stored as `MTRBenc1:<base64(iv+ciphertext+tag)>`
 *   - encrypted blob but no key  → reported as LOCKED (caller prompts to unlock)
 */
import { encryptBytes, decryptBytes } from '../crypto/aes';
import { getSessionKey } from '../crypto/session';

const ENC_MARKER = 'MTRBenc1:';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // chunk the spread so large blobs don't blow the arg limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** True if a stored string is an encrypted blob (vs legacy plaintext JSON). */
export function isEncryptedBlob(stored: string): boolean {
  return stored.startsWith(ENC_MARKER);
}

/**
 * Encode a serialized-state string for storage: encrypt with the session key if
 * unlocked, otherwise return the plaintext unchanged (local-only mode).
 */
export async function encodeStateForStorage(stateJson: string): Promise<string> {
  const key = getSessionKey();
  if (!key) return stateJson;
  const blob = await encryptBytes(key, new TextEncoder().encode(stateJson));
  return ENC_MARKER + bytesToBase64(blob);
}

export type DecodeResult =
  | { kind: 'plaintext'; json: string }
  | { kind: 'decrypted'; json: string }
  | { kind: 'locked' };

/**
 * Decode a stored string back to serialized-state JSON. Plaintext passes through;
 * an encrypted blob is decrypted with the session key, or reported as `locked`
 * when no key is loaded. Throws if an encrypted blob fails to decrypt (wrong key
 * or tampered data).
 */
export async function decodeStateFromStorage(stored: string): Promise<DecodeResult> {
  if (!isEncryptedBlob(stored)) {
    return { kind: 'plaintext', json: stored };
  }
  const key = getSessionKey();
  if (!key) return { kind: 'locked' };
  const plain = await decryptBytes(key, base64ToBytes(stored.slice(ENC_MARKER.length)));
  return { kind: 'decrypted', json: new TextDecoder().decode(plain) };
}
