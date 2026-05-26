import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the engine so we can observe push() calls without a real provider/key.
const push = vi.fn(async () => ({ pushed: true, reason: 'ok' }));
let configured = true;
vi.mock('../../../src/lib/sync/sync-engine', () => ({
  push: () => push(),
  isConfigured: () => configured
}));

import { installSyncTriggers } from '../../../src/lib/sync/triggers';

beforeEach(() => {
  push.mockClear();
  configured = true;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sync triggers', () => {
  test('pushes when the page becomes hidden', () => {
    const uninstall = installSyncTriggers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(push).toHaveBeenCalledTimes(1);
    uninstall();
  });

  test('does not push when the page becomes visible', () => {
    const uninstall = installSyncTriggers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(push).not.toHaveBeenCalled();
    uninstall();
  });

  test('pushes on pagehide', () => {
    const uninstall = installSyncTriggers();
    window.dispatchEvent(new Event('pagehide'));
    expect(push).toHaveBeenCalledTimes(1);
    uninstall();
  });

  test('does nothing when the engine is not configured', () => {
    configured = false;
    const uninstall = installSyncTriggers();
    window.dispatchEvent(new Event('pagehide'));
    expect(push).not.toHaveBeenCalled();
    uninstall();
  });

  test('uninstall removes the listeners', () => {
    const uninstall = installSyncTriggers();
    uninstall();
    window.dispatchEvent(new Event('pagehide'));
    expect(push).not.toHaveBeenCalled();
  });
});
