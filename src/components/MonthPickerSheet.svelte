<script lang="ts">
  // Bottom sheet for picking a (year, month) to jump to.  Opens when the user
  // taps the month label inside the BudgetBox.  Year selector at the top, a
  // 4×3 month grid below.  Months that already have data show a small dot.

  interface Props {
    open: boolean;
    /** YYYY-MM, the month currently shown by the slider (highlighted in the grid). */
    currentMonth: string;
    /** YYYY-MM keys we have ANY transaction data for — those get a "data" dot. */
    monthsWithData: Set<string>;
    onSelect: (month: string) => void;
    onClose: () => void;
  }

  const { open, currentMonth, monthsWithData, onSelect, onClose }: Props = $props();

  // Year being viewed (state).  Initialised to the device's current year so the
  // value is set BEFORE props are first read (which avoids Svelte's
  // `state_referenced_locally` warning); the $effect below then syncs it to the
  // active month's year every time the sheet OPENS, so reopening feels
  // predictable.
  let viewYear = $state(new Date().getUTCFullYear());
  $effect(() => {
    if (open) viewYear = parseInt(currentMonth.slice(0, 4), 10);
  });

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];

  function monthKey(m1to12: number): string {
    return `${viewYear}-${String(m1to12).padStart(2, '0')}`;
  }
  function isCurrent(m1to12: number): boolean {
    return monthKey(m1to12) === currentMonth;
  }
  function hasData(m1to12: number): boolean {
    return monthsWithData.has(monthKey(m1to12));
  }
  function select(m1to12: number): void {
    onSelect(monthKey(m1to12));
    onClose();
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close month picker" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick a month">
    <div class="year-nav">
      <button
        type="button"
        class="year-btn"
        onclick={() => (viewYear -= 1)}
        aria-label="Previous year">‹</button
      >
      <span class="year-label num">{viewYear}</span>
      <button type="button" class="year-btn" onclick={() => (viewYear += 1)} aria-label="Next year"
        >›</button
      >
    </div>
    <div class="month-grid">
      {#each MONTHS as label, i (label)}
        {@const m = i + 1}
        <button
          type="button"
          class="month-cell"
          class:current={isCurrent(m)}
          class:has-data={hasData(m)}
          onclick={() => select(m)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(15, 20, 28, 0.4);
    border: 0;
    cursor: pointer;
    animation: fade 0.2s ease both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 50;
    background: var(--color-surface);
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: rise 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .year-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.5rem 0.85rem;
  }
  .year-btn {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 1.1rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease;
  }
  .year-btn:hover {
    background: var(--color-surface-hover);
  }
  .year-btn:active {
    transform: scale(0.96);
  }
  .year-label {
    font-size: 1.1rem;
    font-weight: 600;
  }
  .month-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  .month-cell {
    position: relative;
    padding: 0.85rem 0.5rem;
    border-radius: 14px;
    background: var(--color-elevated);
    border: 1px solid transparent;
    color: var(--color-text);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease,
      border-color 0.16s ease;
  }
  .month-cell:hover {
    background: var(--color-surface-hover);
  }
  .month-cell:active {
    transform: scale(0.97);
  }
  .month-cell.has-data::after {
    /* Tiny data dot under the month name. */
    content: '';
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-accent);
  }
  .month-cell.current {
    background: var(--color-accent-soft);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
</style>
