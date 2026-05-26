// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as engine from '../../../src/lib/sync/sync-engine';
import {
  ConcurrentModificationError,
  type SyncProvider,
  type EncryptedBlob,
  type BlobMetadata
} from '../../../src/lib/sync/types';
import { setSessionKey, clearSessionKey } from '../../../src/lib/crypto/session';
import { deriveKey } from '../../../src/lib/crypto/kdf';
import { generateSalt } from '../../../src/lib/crypto/salt';
import { clearState } from '../../../src/lib/db/store';

function stubLocalStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k)
  });
}

// In-memory provider implementing the SyncProvider contract.
class MockProvider implements SyncProvider {
  id = 'mock';
  display_name = 'Mock';
  blob: EncryptedBlob | null = null;
  version = 0;
  failNextWriteWithConflict = false;

  async authenticate(): Promise<{ ok: true }> {
    return { ok: true };
  }
  async isAuthenticated(): Promise<boolean> {
    return true;
  }
  async signOut(): Promise<void> {}
  async readBlob(): Promise<EncryptedBlob | null> {
    return this.blob;
  }
  async statBlob(): Promise<BlobMetadata | null> {
    if (this.blob === null) return null;
    return {
      size_bytes: this.blob.ciphertext.byteLength,
      last_modified: new Date().toISOString(),
      version: String(this.version)
    };
  }
  async writeBlob(blob: EncryptedBlob, ifMatch?: string): Promise<{ new_version: string }> {
    if (this.failNextWriteWithConflict) {
      this.failNextWriteWithConflict = false;
      throw new ConcurrentModificationError('simulated concurrent write');
    }
    if (ifMatch !== undefined && this.blob !== null && ifMatch !== String(this.version)) {
      throw new ConcurrentModificationError('version mismatch');
    }
    this.blob = blob;
    this.version += 1;
    return { new_version: String(this.version) };
  }
}

let key: CryptoKey;

beforeEach(async () => {
  stubLocalStorage();
  clearSessionKey();
  key = await deriveKey('sync-pw', generateSalt(), { iterations: 1000 });
  setSessionKey(key); // store encrypts-at-rest with the same key — consistent
  await clearState();
});
afterEach(() => {
  clearSessionKey();
  vi.unstubAllGlobals();
});

describe('sync-engine', () => {
  test('push uploads ciphertext-only; pull applies it back; provider never sees plaintext', async () => {
    const provider = new MockProvider();
    engine.configure(provider, key);

    const pushed = await engine.push();
    expect(pushed.pushed).toBe(true);

    const stored = provider.blob;
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error('expected a stored blob');
    expect(new TextDecoder().decode(stored.ciphertext)).not.toContain('reconciliation_links');
    expect(stored.sidecar.kdf_algorithm).toBe('PBKDF2-SHA-256');

    const pulled = await engine.pull(); // decrypt + deserialize must succeed (no throw)
    expect(pulled.pulled).toBe(true);
  });

  test('pull is a no-op when no remote blob exists yet', async () => {
    const provider = new MockProvider();
    engine.configure(provider, key);
    expect((await engine.pull()).pulled).toBe(false);
  });

  test('sync() resolves a concurrent-write conflict by pulling then re-pushing', async () => {
    const provider = new MockProvider();
    engine.configure(provider, key);
    provider.failNextWriteWithConflict = true; // first push conflicts once, then succeeds
    const result = await engine.sync();
    expect(result.conflict_resolved).toBe(true);
    expect(result.pushed).toBe(true);
  });

  test('push is skipped when nothing changed since the last push', async () => {
    const provider = new MockProvider();
    engine.configure(provider, key);
    const first = await engine.push(); // no remote yet → proceeds
    expect(first.pushed).toBe(true);
    const second = await engine.push(); // unchanged + remote now exists → skip
    expect(second.pushed).toBe(false);
  });

  test('status listeners observe pushing → idle', async () => {
    const provider = new MockProvider();
    const states: string[] = [];
    const unsub = engine.onStatusChange((s) => states.push(s.state));
    engine.configure(provider, key);
    await engine.push();
    unsub();
    expect(states).toContain('pushing');
    expect(states).toContain('idle');
  });
});
