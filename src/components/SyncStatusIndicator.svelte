<script lang="ts">
  // Sync status pill + "Sync now" button for the app header (T157 + T158).
  // Subscribes to the engine's status stream; only renders once sync is
  // configured (a provider + key have been wired in after unlock).
  import { onMount } from 'svelte';
  import { onStatusChange, isConfigured } from '$lib/sync/sync-engine';
  import { triggerSync } from '$lib/sync/sync-controller';
  import type { SyncState } from '$lib/sync/types';

  // `compact` = the narrow (80px) desktop nav rail. The default horizontal pill
  // is ~118px wide and overflowed the rail (clipped "Sync now" + an x-scrollbar);
  // compact stacks a dot-badged refresh icon over a short label so it fits.
  let { compact = false }: { compact?: boolean } = $props();

  let status = $state<SyncState>({ state: 'idle', last_sync_at: null });
  let configured = $state(false);
  const busy = $derived(status.state === 'pulling' || status.state === 'pushing');

  const META: Record<SyncState['state'], { label: string; color: string }> = {
    idle: { label: 'Synced', color: 'var(--color-muted)' },
    pulling: { label: 'Pulling…', color: 'var(--color-accent)' },
    pushing: { label: 'Pushing…', color: 'var(--color-accent)' },
    conflict: { label: 'Resolving…', color: 'var(--color-accent)' },
    error: { label: 'Sync error', color: 'var(--color-danger, #dc2626)' }
  };

  onMount(() => {
    configured = isConfigured();
    // Setting configured in the listener too covers the case where the engine
    // is configured AFTER this component mounts (the first emit flips it on).
    return onStatusChange((s) => {
      status = s;
      configured = true;
    });
  });

  async function syncNow(): Promise<void> {
    try {
      const r = await triggerSync();
      // A pull rewrote the local stores (categories, paychecks, bills, …) under a
      // page that already read the old ones — reload once so the merged data shows.
      if (r.pulled && typeof location !== 'undefined') location.reload();
    } catch {
      // The status listener already surfaces the 'error' state; nothing to do.
    }
  }
</script>

{#if configured}
  {#if compact}
    <!-- Narrow rail: a single vertical button (dot-badged refresh icon + label)
         that fits the 80px column instead of overflowing it. -->
    <button
      type="button"
      class="rail-sync"
      onclick={syncNow}
      disabled={busy}
      title={status.state === 'error' ? status.error : META[status.state].label}
      aria-label="Sync now ({META[status.state].label})"
    >
      <span class="rail-sync-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class:spin={busy}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
        </svg>
        <span class="rail-sync-dot" style:background-color={META[status.state].color}></span>
      </span>
      <span class="rail-sync-label"
        >{busy ? 'Syncing' : status.state === 'error' ? 'Retry' : 'Sync'}</span
      >
    </button>
  {:else}
    <div
      class="flex items-center gap-2 text-sm"
      title={status.state === 'error' ? status.error : ''}
    >
      <span
        class="inline-block h-2 w-2 rounded-full"
        style:background-color={META[status.state].color}
        aria-hidden="true"
      ></span>
      <span style:color="var(--color-muted)">{META[status.state].label}</span>
      <button
        type="button"
        onclick={syncNow}
        disabled={busy}
        class="rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-50"
        style="border-color: var(--color-border); color: var(--color-fg);"
      >
        Sync now
      </button>
    </div>
  {/if}
{/if}

<style>
  .rail-sync {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    width: 100%;
    padding: 0.4rem 0.2rem;
    border-radius: 12px;
    background: none;
    color: var(--color-muted);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.1;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .rail-sync:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-elevated);
  }
  .rail-sync:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .rail-sync-icon {
    position: relative;
    display: inline-flex;
  }
  .rail-sync-dot {
    position: absolute;
    top: -2px;
    right: -3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid var(--color-surface);
  }
  .spin {
    animation: rail-sync-spin 0.9s linear infinite;
  }
  @keyframes rail-sync-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
