<script lang="ts">
  // Month picker sheet — locked design v1 (2026-05-28).
  // Spec: reports/design/home-budgetbox-v1-LOCKED.md
  //
  // Data-only: ONLY months with imported transactions appear.  Grouped by
  // year, year-heading on top, months as chips below.  Empty months are
  // hidden entirely; empty years are hidden entirely.
  //
  // Header: "Pick a month" (left) · "Today" pill (right, accent).

  interface Props {
    open: boolean;
    /** YYYY-MM currently shown by the hero — highlighted in the grid. */
    currentMonth: string;
    /** YYYY-MM keys we have ANY transaction data for. */
    monthsWithData: Set<string>;
    /** YYYY-MM of "today" — for the "Jump to today" button. */
    todayMonth: string;
    onSelect: (month: string) => void;
    onClose: () => void;
  }

  const { open, currentMonth, monthsWithData, todayMonth, onSelect, onClose }: Props = $props();

  const MONTH_LABELS = [
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

  /** Build { year → [monthIndex0to11, ...] } from monthsWithData.
   *  Always include the current shown month even if it has no data (so the
   *  highlighted "current" chip is visible).  Sorted year descending, months
   *  ascending within a year. */
  const grouped = $derived.by<Array<{ year: number; months: number[] }>>(() => {
    const map = new Map<number, Set<number>>();
    const add = (ym: string) => {
      const y = parseInt(ym.slice(0, 4), 10);
      const m = parseInt(ym.slice(5, 7), 10) - 1;
      if (Number.isNaN(y) || Number.isNaN(m) || m < 0 || m > 11) return;
      const set = map.get(y) ?? new Set<number>();
      set.add(m);
      map.set(y, set);
    };
    for (const ym of monthsWithData) add(ym);
    add(currentMonth); // ensure highlighted month is in the list

    const years = [...map.keys()].sort((a, b) => b - a); // newest first
    return years.map((year) => ({
      year,
      months: [...(map.get(year) ?? [])].sort((a, b) => a - b)
    }));
  });

  function ymOf(year: number, m: number): string {
    return `${year}-${String(m + 1).padStart(2, '0')}`;
  }
  function isCurrent(year: number, m: number): boolean {
    return ymOf(year, m) === currentMonth;
  }
  function select(year: number, m: number): void {
    onSelect(ymOf(year, m));
    onClose();
  }
  function jumpToday(): void {
    onSelect(todayMonth);
    onClose();
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close month picker" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick a month">
    <div class="grabber"></div>
    <div class="head">
      <h2>Pick a month</h2>
      <button
        type="button"
        class="today-btn"
        onclick={jumpToday}
        aria-label="Jump to current month"
      >
        Today
      </button>
    </div>

    <div class="years">
      {#each grouped as g (g.year)}
        <div class="year-group">
          <div class="year-head">{g.year}</div>
          <div class="month-pills">
            {#each g.months as m (m)}
              <button
                type="button"
                class="m-chip"
                class:selected={isCurrent(g.year, m)}
                onclick={() => select(g.year, m)}
                aria-current={isCurrent(g.year, m) ? 'true' : undefined}
              >
                {MONTH_LABELS[m]}
              </button>
            {/each}
          </div>
        </div>
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
    background: var(--color-bg);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 0.6rem 1.1rem calc(1.4rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-height: 80vh;
    overflow-y: auto;
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

  .grabber {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: rgba(42, 38, 34, 0.2);
    margin: 0 auto 0.85rem;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .head h2 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .today-btn {
    background: var(--color-accent);
    color: var(--color-accent-fg, white);
    border: 0;
    padding: 0.45rem 0.95rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease;
  }
  .today-btn:hover {
    background: color-mix(in oklab, var(--color-accent) 88%, white);
  }
  .today-btn:active {
    transform: scale(0.97);
  }

  .years {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .year-head {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--color-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 0.55rem;
  }
  .month-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .m-chip {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 0.75rem 1.05rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--color-text);
    cursor: pointer;
    min-width: 64px;
    transition:
      background-color 0.16s ease,
      transform 0.12s ease,
      border-color 0.16s ease;
  }
  .m-chip:hover {
    background: var(--color-surface-hover);
  }
  .m-chip:active {
    transform: scale(0.97);
  }
  .m-chip.selected {
    background: var(--color-text);
    color: var(--color-bg);
    border-color: var(--color-text);
  }
  .m-chip.selected:hover {
    background: var(--color-text);
  }
</style>
