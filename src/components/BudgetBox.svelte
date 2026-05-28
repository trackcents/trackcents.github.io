<script lang="ts">
  // Reusable month budget "hero box" — works for current, past, or future month.
  // Renders the headroom % pill (signed, goes negative when overspent), the big
  // spent number, "of ₹X income" subline, progress bar, stat row, and the
  // "+ Add expense" + "+ Income" buttons.  Pure display; the parent provides
  // the month's flow + handlers.

  import { formatMoney } from '$lib/util/money';
  import { monthBudget } from '$lib/app/month-budget';

  interface Props {
    /** YYYY-MM */
    monthKey: string;
    /** Human-readable label, e.g. "May 2026". */
    monthLabel: string;
    /** Inflow / outflow magnitudes for THIS month (undefined → zeros). */
    flow: { inflow_minor: bigint; outflow_minor: bigint } | undefined;
    /** ISO YYYY-MM-DD device-local today date. */
    todayIso: string;
    /**
     * Sum of "extra" income for the month: total income MINUS the single
     * largest income transaction (treated as the base / recurring source).
     * 0n if there's only one income source (or none); when > 0 the box shows
     * a small green "+$X extra income · tap to manage" line under the total.
     */
    extraIncomeMinor?: bigint;
    /**
     * Signed leftover from the PREVIOUS month (its income − spent).  Positive
     * means money rolled in, negative means an overspend rolled forward.  0n =
     * no prior data or exactly zero leftover; the line stays hidden.  Computed
     * by the parent; this component is pure display.
     */
    carryForwardMinor?: bigint;
    /** Human-readable label of the previous month ("April 2026") for the chip. */
    carryForwardFromLabel?: string;
    /** Tap-to-open the month picker. */
    onLabelClick: () => void;
    /** Reveal the + Income inline form (only shown on current/future months). */
    onAddIncome: () => void;
    /** Tap-to-jump to a filtered income view (for "tap to manage"). */
    onManageIncome?: () => void;
  }

  const {
    monthKey,
    monthLabel,
    flow,
    todayIso,
    extraIncomeMinor = 0n,
    carryForwardMinor = 0n,
    carryForwardFromLabel,
    onLabelClick,
    onAddIncome,
    onManageIncome
  }: Props = $props();

  // Props are reactive only when read inside `$derived`/`$effect`/the template —
  // bare top-level slicing would freeze on the initial value.
  const todayMonth = $derived(todayIso.slice(0, 7));
  const isPast = $derived(monthKey < todayMonth);
  const isFuture = $derived(monthKey > todayMonth);
  const isCurrent = $derived(monthKey === todayMonth);

  const budget = $derived(monthBudget(flow, monthKey, todayIso));
  const hasIncome = $derived(budget.income_minor > 0n);
  const overspent = $derived(budget.remaining_minor < 0n);

  // Progress bar: visually clamp 0–100; overspend communicated via color, not width.
  const barFill = $derived(Math.min(100, Math.max(0, budget.pct_spent)));
</script>

<section class="card rise budget-box">
  <div class="mb-2 flex items-center justify-between gap-2">
    <button
      type="button"
      class="month-label"
      onclick={onLabelClick}
      aria-label="Pick a different month"
    >
      <span class="num">{monthLabel}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
      >
    </button>
    {#if hasIncome}
      <!-- Headroom pill: % LEFT of the month's income (signed). Goes negative when overspent. -->
      <span
        class="num headroom-pill"
        class:over={overspent}
        title={overspent ? 'Over budget' : '% left to spend'}
      >
        {budget.pct_left}%
      </span>
    {/if}
  </div>

  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="text-sm" style:color="var(--color-muted)">
        {isPast ? 'Spent' : isFuture ? 'Planned spend' : 'Spent this month'}
      </p>
      <p class="num mt-1 text-4xl font-semibold tracking-tight">
        {formatMoney(budget.spent_minor)}
      </p>
      {#if hasIncome}
        <p class="mt-1 text-sm" style:color="var(--color-muted)">
          of {formatMoney(budget.income_minor)} income
        </p>
        {#if extraIncomeMinor > 0n}
          <!-- "Extra income" breakdown line — green, slightly smaller, tappable
               to jump to the income transactions of this month.  Shown only
               when there's more than one income source (largest = base, the
               rest sum into `extraIncomeMinor`). -->
          <button
            type="button"
            class="extra-income"
            onclick={onManageIncome}
            disabled={onManageIncome === undefined}
            aria-label="Review other inflow transactions for this month"
          >
            <span class="num font-medium">+{formatMoney(extraIncomeMinor)}</span>
            <span>other inflows</span>
            {#if onManageIncome !== undefined}
              <span class="extra-arrow" aria-hidden="true">→</span>
            {/if}
          </button>
        {/if}
        {#if carryForwardMinor !== 0n}
          <!-- Carry-forward line: last month's leftover (+ green) or overspend
               (− red) rolls forward.  Display-only for v1; informational so the
               user sees the trend without the engine doing magic math behind
               their back. -->
          {@const carryPositive = carryForwardMinor > 0n}
          <p
            class="carry-line"
            class:carry-negative={!carryPositive}
            title="Last month's net — shown here as a heads-up, NOT added to this month's totals."
          >
            <span class="num font-medium">
              {carryPositive ? '+' : '−'}{formatMoney(
                carryForwardMinor < 0n ? -carryForwardMinor : carryForwardMinor
              )}
            </span>
            <span>
              ended {carryForwardFromLabel ?? 'last month'}
              <span class="extra-manage">(FYI — not added in)</span>
            </span>
          </p>
        {/if}
      {/if}
    </div>
    {#if isCurrent}
      <button
        type="button"
        class="btn btn-ghost flex-none"
        style="padding: 0.4rem 0.8rem; font-size: 0.8rem;"
        onclick={onAddIncome}
      >
        + Income
      </button>
    {/if}
  </div>

  {#if hasIncome}
    <div
      class="mt-4 h-2 overflow-hidden rounded-full"
      style="background-color: var(--color-elevated);"
    >
      <div
        class="h-full rounded-full"
        style:width="{barFill}%"
        style:background-color={overspent ? 'var(--color-danger)' : 'transparent'}
        style:background-image={overspent ? 'none' : 'var(--grad-primary)'}
      ></div>
    </div>

    <!-- Stat row: Remaining is the number you live by, so it leads visually
         (bigger, bolder).  Daily pace + Days left are secondary glances. -->
    <div class="mt-4 grid grid-cols-3 gap-2 text-center">
      <div class="stat stat-primary">
        <p
          class="num stat-value"
          style:color={overspent ? 'var(--color-danger)' : 'var(--color-text)'}
        >
          {formatMoney(budget.remaining_minor)}
        </p>
        <p class="stat-label">Remaining</p>
      </div>
      <div class="stat">
        <p class="num stat-value-sub">{formatMoney(budget.daily_pace_minor)}</p>
        <p class="stat-label">Daily pace</p>
      </div>
      <div class="stat">
        <p class="num stat-value-sub">
          {isPast ? 'Final' : isFuture ? '—' : budget.days_left}
        </p>
        <p class="stat-label">
          {isPast ? 'Status' : isFuture ? 'Days' : 'Days left in month'}
        </p>
      </div>
    </div>

    {#if isCurrent && budget.over_pace}
      <p class="mt-3 text-xs" style:color="var(--color-danger)">
        You're spending faster than your income for the month — ease off to stay on track.
      </p>
    {/if}
  {:else if isFuture}
    <p class="mt-3 text-sm" style:color="var(--color-muted)">
      Plan ahead — add expected income or expenses for {monthLabel}.
    </p>
  {:else if isPast}
    <p class="mt-3 text-sm" style:color="var(--color-muted)">
      No income recorded for {monthLabel}.
    </p>
  {:else}
    <p class="mt-3 text-sm" style:color="var(--color-muted)">
      Add the income you got this month to see what's left, your safe daily spend, and your pace.
    </p>
  {/if}

  <!-- The "+ Add expense" affordance lives on a floating FAB on the page; we
       deliberately removed the duplicate bottom button from inside the box per
       both personas' round-2 feedback (Bhargav: "now I have the FAB AND the
       old button doing the exact same thing"; Murali: "pick one front door
       per action"). -->
</section>

<style>
  .budget-box {
    /* Slightly more breathing room than the default card. */
    padding: 1.25rem;
  }
  .month-label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease;
    cursor: pointer;
    white-space: nowrap;
  }
  .month-label:hover {
    background: var(--color-surface-hover);
  }
  .month-label:active {
    transform: scale(0.97);
  }
  .headroom-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-success);
    background-color: color-mix(in oklab, var(--color-success) 14%, transparent);
    white-space: nowrap;
  }
  .headroom-pill.over {
    color: var(--color-danger);
    background-color: color-mix(in oklab, var(--color-danger) 14%, transparent);
  }
  .extra-income {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.35rem;
    padding: 0;
    background: none;
    border: 0;
    color: var(--color-success);
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
  }
  .extra-income:disabled {
    cursor: default;
  }
  .extra-income:not(:disabled):hover {
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, var(--color-success) 40%, transparent);
    text-underline-offset: 3px;
  }
  .extra-manage {
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  /* Small affordance arrow so the "other inflows" row reads as tappable on
     mobile (Murali round-5: green text without an obvious arrow looks like a
     stat, not a button). */
  .extra-arrow {
    color: var(--color-muted);
    font-size: 0.85rem;
    margin-left: 0.15rem;
    transition: transform 0.16s ease;
  }
  .extra-income:not(:disabled):hover .extra-arrow {
    transform: translateX(2px);
    color: var(--color-success);
  }
  .carry-line {
    margin-top: 0.3rem;
    font-size: 0.82rem;
    color: var(--color-success);
    /* Block layout so the "(FYI — not added in)" tail wraps onto its own line
       on narrow phones rather than orphaning awkwardly between amount + month
       (Murali round-5). */
    display: block;
    line-height: 1.35;
  }
  .carry-line .num {
    margin-right: 0.35rem;
  }
  .carry-line .extra-manage {
    display: inline-block;
    margin-left: 0.2rem;
  }
  .carry-line.carry-negative {
    color: var(--color-danger);
  }
  /* ── Stat row hierarchy: Remaining leads, the other two play support. ── */
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
  .stat-value {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  .stat-value-sub {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.1;
    color: var(--color-text);
  }
  .stat-label {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat-primary .stat-label {
    color: var(--color-accent);
  }
</style>
