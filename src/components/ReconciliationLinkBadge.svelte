<script lang="ts">
  import type { ReconciliationLink } from '$lib/app/reconciliation';

  interface Props {
    link: ReconciliationLink;
  }
  let { link }: Props = $props();

  // Confidence < 1.0 means the matcher inferred the last_4 instead of reading
  // it explicitly out of the bank-tx description.  Surfacing that lets the
  // user spot a wrong auto-match without having to dig into the code.
  let pct = $derived(Math.round(link.confidence_score * 100));
  let isAuto = $derived(link.link_type === 'auto');
</script>

<span
  class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide whitespace-nowrap"
  style:border-color={isAuto ? 'var(--color-border)' : 'var(--color-accent)'}
  style:color={isAuto ? 'var(--color-muted)' : 'var(--color-accent)'}
  style:background-color={isAuto
    ? 'var(--color-surface)'
    : 'color-mix(in oklab, var(--color-accent) 12%, transparent)'}
  title={isAuto
    ? `Auto-matched · matcher chose this with ${pct}% confidence (1 unique candidate)`
    : 'You manually linked these two transactions'}
>
  {link.link_type}
  {#if isAuto}<span aria-hidden="true">·</span><span>{pct}%</span>{/if}
</span>
