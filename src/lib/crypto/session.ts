/**
 * In-memory holder for the derived encryption key.
 *
 * Constitution Principle X: the key is held in memory ONLY — never written to
 * disk. Set at onboarding / passphrase unlock, read by the encryption-at-rest
 * layer, cleared on lock or sign-out.
 */
let sessionKey: CryptoKey | null = null;

export function setSessionKey(key: CryptoKey): void {
  sessionKey = key;
}

export function getSessionKey(): CryptoKey | null {
  return sessionKey;
}

export function clearSessionKey(): void {
  sessionKey = null;
}

export function isUnlocked(): boolean {
  return sessionKey !== null;
}
