<script lang="ts">
  // Home "Income · what's left" — one rich card per income pocket (spec
  // 002-income-pockets §3, Option A; mockup reports/mockups/home-pockets-A.html).
  // Replaces the old single combined "Spent of income" hero. Carries its own
  // centered month-nav widget (◀ pill ▶) so the page still browses months.
  //
  // Each card: logo chip + name + "manage ›"; the big REMAINING number (red when
  // negative, with an "over by $X" note); "of $TOTAL · NN% used"; a progress bar
  // (clamped 0–100 width, red when over). Negative remaining is allowed and shown,
  // never hidden — the whole point of honest pockets.
  import { formatMoney } from '$lib/util/money';
  import type { PocketSummary } from '$lib/app/pockets';

  interface Props {
    summaries: PocketSummary[];
    monthLabel: string;
    /** ◀ / ▶ tap handlers — parent navigates ±1 month inside its month list. */
    onPrevMonth?: () => void;
    onNextMonth?: () => void;
    canPrev?: boolean;
    canNext?: boolean;
    /** Tap the month pill — opens the month picker sheet. */
    onLabelClick: () => void;
    /** Tap "manage ›" on a pocket card. */
    onManage?: (pocketId: string) => void;
  }

  const {
    summaries,
    monthLabel,
    onPrevMonth,
    onNextMonth,
    canPrev = true,
    canNext = true,
    onLabelClick,
    onManage
  }: Props = $props();

  /** No-decimal money for the headline + subline (matches the mockup "$7,290"). */
  function money0(minor: bigint): string {
    const sign = minor < 0n ? -1n : 1n;
    const abs = minor < 0n ? -minor : minor;
    const rounded = ((abs + 50n) / 100n) * 100n;
    return formatMoney(sign * rounded).replace(/\.\d+$/, '');
  }

  /** Map a pocket's colour token to a CSS custom-property, with a safe fallback. */
  function colorVar(color: string): string {
    switch (color) {
      case 'success':
        return 'var(--color-success)';
      case 'danger':
        return 'var(--color-danger)';
      case 'accent':
      default:
        return 'var(--color-accent)';
    }
  }
</script>

<section class="pockets" aria-label="Income pockets for {monthLabel}">
  <!-- Centered month nav widget ◀ pill ▶ (same control as the old hero). -->
  <div class="nav-wrap">
    <div class="nav-widget" role="group" aria-label="Switch month">
      <button
        type="button"
        class="nav-btn"
        onclick={onPrevMonth}
        disabled={!canPrev || onPrevMonth === undefined}
        aria-label="Previous month"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M15 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="month-pill"
        onclick={onLabelClick}
        aria-label="Pick a different month, currently {monthLabel}"
      >
        <span class="num">{monthLabel}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        class="nav-btn"
        onclick={onNextMonth}
        disabled={!canNext || onNextMonth === undefined}
        aria-label="Next month"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>

  <p class="seclabel">Income · what's left</p>

  {#each summaries as s (s.pocket.id)}
    {@const over = s.remaining < 0n}
    {@const barFill = Math.min(100, Math.max(0, s.pctUsed))}
    <div class="card rise pocket">
      <div class="pk-head">
        <div
          class="chip"
          style:background="color-mix(in oklab, {colorVar(s.pocket.color)} 14%, transparent)"
        >
          {s.pocket.logo}
        </div>
        <div class="pk-name">{s.pocket.name}</div>
        <button
          type="button"
          class="manage"
          onclick={() => onManage?.(s.pocket.id)}
          disabled={onManage === undefined}
        >
          manage ›
        </button>
      </div>

      <p class="num big" style:color={over ? 'var(--color-danger)' : 'var(--color-text)'}>
        {money0(s.remaining)}
      </p>
      <p class="remaining-lbl">
        remaining{#if over}<span class="over"> · over by {money0(-s.remaining)}</span>{/if}
      </p>

      <p class="sub">of {money0(s.total)} · {s.pctUsed}% used</p>
      <div class="bar">
        <div
          class="fill"
          style:width="{barFill}%"
          style:background={over ? 'var(--color-danger)' : colorVar(s.pocket.color)}
        ></div>
      </div>
    </div>
  {/each}
</section>

<style>
  .nav-wrap {
    display: flex;
    justify-content: center;
    margin-bottom: 1.1rem;
  }
  .nav-widget {
    display: inline-flex;
    align-items: stretch;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    overflow: hidden;
    height: 38px;
  }
  .nav-btn {
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0 0.95rem;
    color: var(--color-muted);
    display: inline-flex;
    align-items: center;
    transition:
      background-color 0.16s ease,
      color 0.16s ease;
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
  .nav-btn:active:not(:disabled) {
    transform: scale(0.95);
  }
  .nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .month-pill {
    background: var(--color-surface);
    border: 0;
    border-left: 1px solid var(--color-border);
    border-right: 1px solid var(--color-border);
    color: var(--color-text);
    font-weight: 600;
    font-size: 0.92rem;
    padding: 0 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    transition: background-color 0.16s ease;
    max-width: 62vw;
    white-space: nowrap;
    overflow: hidden;
  }
  .month-pill:hover {
    background: var(--color-surface-hover);
  }
  .month-pill svg {
    color: var(--color-muted);
  }

  .seclabel {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin: 0 0.25rem 0.6rem;
  }

  .pocket {
    padding: 1rem;
    margin-bottom: 0.75rem;
  }
  .pk-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }
  .chip {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-size: 19px;
    flex: none;
  }
  .pk-name {
    font-weight: 700;
    font-size: 1rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .manage {
    color: var(--color-accent);
    font-weight: 600;
    font-size: 0.82rem;
    background: none;
    border: 0;
    padding: 0.2rem 0.1rem;
    cursor: pointer;
    flex: none;
    font-family: inherit;
  }
  .manage:disabled {
    color: var(--color-muted);
    cursor: default;
  }
  .big {
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .remaining-lbl {
    font-size: 0.72rem;
    color: var(--color-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 0.25rem;
  }
  .remaining-lbl .over {
    color: var(--color-danger);
  }
  .sub {
    font-size: 0.82rem;
    color: var(--color-muted);
    margin: 0.65rem 0 0.5rem;
  }
  .bar {
    height: 9px;
    border-radius: 999px;
    background: var(--color-elevated);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }
</style>
