<script lang="ts">
  import type { ChecksumGateResult } from '$lib/app/checksum';

  interface Props {
    result: ChecksumGateResult;
  }
  let { result }: Props = $props();
</script>

{#if result.ok}
  <div
    class="rounded-xl border p-4"
    style="border-color: var(--color-success); background-color: color-mix(in oklab, var(--color-success) 12%, transparent);"
  >
    <p class="font-medium text-[var(--color-success)]">
      Checksum verified — strategy <span class="font-mono">{result.strategy_used}</span>
    </p>
    <ul class="mt-2 space-y-1 text-sm text-[var(--color-text)]">
      {#each result.level_results as r (r.level)}
        <li class="font-mono text-xs">{r.message}</li>
      {/each}
    </ul>
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
