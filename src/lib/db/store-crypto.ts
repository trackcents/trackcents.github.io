/**
 * Storage codec for the persisted stores — the single chokepoint every store
 * (store.ts + categorization/budget/goals/recurring) routes through.
 *
 * Data is stored as PLAINTEXT JSON. The passphrase / zero-knowledge encryption
 * layer was removed at the user's explicit request (2026-06-01) so sign-in is
 * the only step — see the amended Constitution Principle I. These functions are
 * kept (and kept async-shaped) so callers don't change and a future codec change
 * (compression, re-introduced encryption) has exactly one place to live.
 *
 * The `DecodeResult` union keeps its historical 'decrypted' / 'locked' variants
 * so existing call sites compile unchanged; decode now only ever returns
 * 'plaintext' (nothing is ever locked).
 */

export type DecodeResult =
  | { kind: 'plaintext'; json: string }
  | { kind: 'decrypted'; json: string }
  | { kind: 'locked' };

/** Encode a serialized-state string for storage. Plaintext passthrough. */
export function encodeStateForStorage(stateJson: string): Promise<string> {
  return Promise.resolve(stateJson);
}

/** Decode a stored string back to serialized-state JSON. Plaintext passthrough. */
export function decodeStateFromStorage(stored: string): Promise<DecodeResult> {
  return Promise.resolve({ kind: 'plaintext', json: stored });
}
