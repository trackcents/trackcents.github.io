// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as engine from '../../../src/lib/sync/sync-engine';
import {
  ConcurrentModificationError,
  type SyncProvider,
  type SyncBlob,
  type BlobMetadata
} from '../../../src/lib/sync/types';
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
  blob: SyncBlob | null = null;
  version = 0;
  failNextWriteWithConflict = false;

  async authenticate(): Promise<{ ok: true }> {
    return { ok: true };
  }
  async isAuthenticated(): Promise<boolean> {
    return true;
  }
  async signOut(): Promise<void> {}
  async readBlob(): Promise<SyncBlob | null> {
    return this.blob;
  }
  async statBlob(): Promise<BlobMetadata | null> {
    if (this.blob === null) return null;
    return {
      size_bytes: this.blob.bytes.byteLength,
      last_modified: new Date().toISOString(),
      version: String(this.version)
    };
  }
  async writeBlob(blob: SyncBlob, ifMatch?: string): Promise<{ new_version: string }> {
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

beforeEach(async () => {
  stubLocalStorage();
  await clearState();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync-engine (plaintext)', () => {
  test('push uploads the framed plaintext state; pull applies it back', async () => {
    const provider = new MockProvider();
    engine.configure(provider);

    const pushed = await engine.push();
    expect(pushed.pushed).toBe(true);

    const stored = provider.blob;
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error('expected a stored blob');
    // Plaintext now: the JSON is visible in the blob bytes (after the 8-byte header).
    expect(new TextDecoder().decode(stored.bytes)).toContain('reconciliation_links');
    expect(stored.sidecar.blob_version).toBeGreaterThan(0);
    expect(stored.sidecar.last_writer_device.length).toBeGreaterThan(0);

    const pulled = await engine.pull(); // decode + deserialize must succeed (no throw)
    expect(pulled.pulled).toBe(true);
  });

  test('pull is a no-op when no remote blob exists yet', async () => {
    const provider = new MockProvider();
    engine.configure(provider);
    expect((await engine.pull()).pulled).toBe(false);
  });

  test('sync() resolves a concurrent-write conflict by pulling then re-pushing', async () => {
    const provider = new MockProvider();
    engine.configure(provider);
    provider.failNextWriteWithConflict = true; // first push conflicts once, then succeeds
    const result = await engine.sync();
    expect(result.conflict_resolved).toBe(true);
    expect(result.pushed).toBe(true);
  });

  test('push is skipped when nothing changed since the last push', async () => {
    const provider = new MockProvider();
    engine.configure(provider);
    const first = await engine.push(); // no remote yet → proceeds
    expect(first.pushed).toBe(true);
    const second = await engine.push(); // unchanged + remote now exists → skip
    expect(second.pushed).toBe(false);
  });

  test('status listeners observe pushing → idle', async () => {
    const provider = new MockProvider();
    const states: string[] = [];
    const unsub = engine.onStatusChange((s) => states.push(s.state));
    engine.configure(provider);
    await engine.push();
    unsub();
    expect(states).toContain('pushing');
    expect(states).toContain('idle');
  });
});
