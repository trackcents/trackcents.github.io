<script lang="ts">
  // REQ-B1.2 — developer jargon hidden from end users.  The internal
  // checksum "strategy" id (e.g. "B+C+D") is meaningless to a human and
  // makes the app look like a half-built prototype.  We now show the plain
  // "Totals match this statement" badge and tuck the level-by-level diag
  // behind a "Details" expander only the dev/debug path opens.
  import type { ChecksumGateResult } from '$lib/app/checksum';

  interface Props {
    result: ChecksumGateResult;
  }
  let { result }: Props = $props();

  let showDetails = $state(false);
</script>

{#if result.ok}
  <div
    class="rounded-xl border p-4"
    style="border-color: var(--color-success); background-color: color-mix(in oklab, var(--color-success) 12%, transparent);"
  >
    <p class="font-medium text-[var(--color-success)]">✓ Totals match this statement</p>
    <button
      type="button"
      class="mt-1 text-xs underline-offset-2 hover:underline"
      style="color: var(--color-muted);"
      onclick={() => (showDetails = !showDetails)}
    >
      {showDetails ? 'Hide' : 'Details'}
    </button>
    {#if showDetails}
      <ul class="mt-2 space-y-1 text-xs text-[var(--color-text)]">
        {#each result.level_results as r (r.level)}
          <li class="font-mono">{r.message}</li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
  <div
    class="rounded-xl border p-4"
    style="border-color: var(--color-danger); background-color: color-mix(in oklab, var(--color-danger) 12%, transparent);"
  >
    <p class="font-medium text-[var(--color-danger)]">Checksum refused — import blocked</p>
    <p class="mt-2 text-sm text-[var(--color-text)]">{result.reason}</p>
    {#if result.level_results.length > 0}
      <ul class="mt-3 space-y-1 text-xs">
        {#each result.level_results as r (r.level)}
          <li
            class="font-mono"
            class:text-[var(--color-success)]={r.passed}
            class:text-[var(--color-danger)]={!r.passed}
          >
            {r.message}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
