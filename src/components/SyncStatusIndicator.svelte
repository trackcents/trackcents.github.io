<script lang="ts">
  // Sync status pill + "Sync now" button for the app header (T157 + T158).
  // Subscribes to the engine's status stream; only renders once sync is
  // configured (a provider + key have been wired in after unlock).
  import { onMount } from 'svelte';
  import { onStatusChange, isConfigured } from '$lib/sync/sync-engine';
  import { triggerSync } from '$lib/sync/sync-controller';
  import type { SyncState } from '$lib/sync/types';

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
      await triggerSync();
    } catch {
      // The status listener already surfaces the 'error' state; nothing to do.
    }
  }
</script>

{#if configured}
  <div class="flex items-center gap-2 text-sm" title={status.state === 'error' ? status.error : ''}>
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
