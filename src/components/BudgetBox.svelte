<script lang="ts">
  // Hero budget card — locked design v1 (2026-05-28).
  // Spec: reports/design/home-budgetbox-v1-LOCKED.md
  // Mockup: reports/mockup-v4.png + reports/mockup-add-placement.png
  //
  // Layout (top → bottom):
  //   1. Centered nav widget  ◀ May 2026 ▾ ▶   (1-tap chevrons + tap-pill = picker)
  //   2. "Spent this month"  label (muted)
  //   3. Big spent number     no decimals
  //   4. "of ₹X income"       subline
  //   5. "+₹X other inflows →" green chip (when extra > 0)
  //   6. Progress meta row    "63% used"  ··  "✓ on track" / "⚠ over budget"
  //   7. Progress bar
  //   8. Stat row             Remaining (primary) · Daily pace · Days left
  //
  // KILLED (do not bring back):
  //   - Side-of-month headroom pill (Q used to compete with month nav)
  //   - Carry-forward "+₹X ended Apr (FYI — not added in)" chip
  //   - Decimal precision on the headline number
  //   - "+ Income" inline button (lives on the tab-bar center "+" now)
  //   - Edge chevrons inside the box
  //   - Bottom "◀ Apr · Jun ▶" row

  import { formatMoney } from '$lib/util/money';
  import { monthBudget } from '$lib/app/month-budget';

  interface Props {
    monthKey: string;
    monthLabel: string;
    flow: { inflow_minor: bigint; outflow_minor: bigint } | undefined;
    todayIso: string;
    extraIncomeMinor?: bigint;

    /** ◀ / ▶ tap handlers — parent navigates ±1 month inside its month list. */
    onPrevMonth?: () => void;
    onNextMonth?: () => void;
    /** Disabled when the boundary month is reached (no earlier / later data). */
    canPrev?: boolean;
    canNext?: boolean;

    /** Tap on the pill center — opens the month picker sheet. */
    onLabelClick: () => void;
    /** Tap the "+₹X other inflows" green chip — opens income filter. */
    onManageIncome?: () => void;
  }

  const {
    monthKey,
    monthLabel,
    flow,
    todayIso,
    extraIncomeMinor = 0n,
    onPrevMonth,
    onNextMonth,
    canPrev = true,
    canNext = true,
    onLabelClick,
    onManageIncome
  }: Props = $props();

  const todayMonth = $derived(todayIso.slice(0, 7));
  const isPast = $derived(monthKey < todayMonth);
  const isFuture = $derived(monthKey > todayMonth);
  const isCurrent = $derived(monthKey === todayMonth);

  const budget = $derived(monthBudget(flow, monthKey, todayIso));
  const hasIncome = $derived(budget.income_minor > 0n);
  const overspent = $derived(budget.remaining_minor < 0n);

  // Progress bar: visually clamp 0–100; overspend communicated via color, not width.
  const barFill = $derived(Math.min(100, Math.max(0, budget.pct_spent)));
  const pctUsed = $derived(Math.max(0, budget.pct_spent));

  // No-decimal format for the big headline number.  Falls back to the
  // currency-aware formatMoney for the rest (subline, stats) so locale stays
  // consistent.
  const headlineSpend = $derived(formatMoneyNoDecimal(budget.spent_minor));
  function formatMoneyNoDecimal(minor: bigint): string {
    // Drop the fractional part (round half-away-from-zero) before formatting,
    // then strip the ".00" that formatMoney prints.  Bigint safe.
    const sign = minor < 0n ? -1n : 1n;
    const abs = minor < 0n ? -minor : minor;
    const rounded = ((abs + 50n) / 100n) * 100n; // round to nearest rupee
    const signed = sign * rounded;
    const full = formatMoney(signed);
    // Strip trailing .00 / .NN.  Works for $, ₹, €, £, ¥ since formatMoney's
    // decimal is always "." for our supported locales.
    return full.replace(/\.\d+$/, '');
  }
</script>

<section class="card rise budget-box" aria-label="Budget for {monthLabel}">
  <!-- ── 1 · Centered nav widget ◀ pill ▶ ───────────────────────────── -->
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

  <!-- ── 2 · "Spent this month" label ─────────────────────────────────── -->
  <p class="spent-label">
    {isPast ? 'Spent' : isFuture ? 'Planned spend' : 'Spent this month'}
  </p>

  <!-- ── 3 · Big spent number (no decimals) ──────────────────────────── -->
  <p class="num spent-amount" aria-live="polite">
    {headlineSpend}
  </p>

  {#if hasIncome}
    <!-- ── 4 · "of ₹X income" subline ─────────────────────────────────── -->
    <p class="of-income">of {formatMoneyNoDecimal(budget.income_minor)} income</p>

    {#if extraIncomeMinor > 0n}
      <!-- ── 5 · "+₹X other inflows →" green chip ────────────────────── -->
      <button
        type="button"
        class="extra-chip"
        onclick={onManageIncome}
        disabled={onManageIncome === undefined}
        aria-label="Review other inflow transactions for this month"
      >
        <span class="num">+{formatMoneyNoDecimal(extraIncomeMinor)}</span>
        <span>other inflows</span>
        {#if onManageIncome !== undefined}
          <span class="extra-arrow" aria-hidden="true">→</span>
        {/if}
      </button>
    {/if}

    <!-- ── 6 · Progress meta + ── 7 · Bar ──────────────────────────────── -->
    <div class="progress-block">
      <div class="progress-meta">
        <span class="meta-left">{pctUsed}% used</span>
        <span class="meta-right" class:over={overspent}>
          {overspent ? '⚠ over budget' : '✓ on track'}
        </span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style:width="{barFill}%" class:over={overspent}></div>
      </div>
    </div>

    <!-- ── 8 · Stat row ─────────────────────────────────────────────────── -->
    <div class="stats">
      <div class="stat stat-primary">
        <p
          class="num stat-value-primary"
          style:color={overspent ? 'var(--color-danger)' : 'var(--color-accent)'}
        >
          {formatMoneyNoDecimal(budget.remaining_minor)}
        </p>
        <p class="stat-label">Remaining</p>
      </div>
      <div class="stat">
        <p class="num stat-value">{formatMoneyNoDecimal(budget.daily_pace_minor)}</p>
        <p class="stat-label">Daily pace</p>
      </div>
      <div class="stat">
        <p class="num stat-value">
          {isPast ? 'Final' : isFuture ? '—' : budget.days_left}
        </p>
        <p class="stat-label">
          {isPast ? 'Status' : isFuture ? 'Days' : 'Days left'}
        </p>
      </div>
    </div>

    {#if isCurrent && budget.over_pace}
      <p class="pace-warning">
        You're spending faster than your income for the month — ease off to stay on track.
      </p>
    {/if}
  {:else if isFuture}
    <p class="empty-note">Plan ahead — add expected income or expenses for {monthLabel}.</p>
  {:else if isPast}
    <p class="empty-note">No income recorded for {monthLabel}.</p>
  {:else}
    <p class="empty-note">
      Add the income you got this month to see what's left, your safe daily spend, and your pace.
    </p>
  {/if}
</section>

<style>
  .budget-box {
    padding: 1.4rem 1.4rem 1.25rem;
  }

  /* ── Nav widget (centered, tap-only) ─────────────────────────────── */
  .nav-wrap {
    display: flex;
    justify-content: center;
    margin-bottom: 1.4rem;
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
  }
  .month-pill:hover {
    background: var(--color-surface-hover);
  }
  .month-pill:active {
    transform: scale(0.98);
  }
  .month-pill svg {
    color: var(--color-muted);
  }

  /* ── Spent number block ──────────────────────────────────────────── */
  .spent-label {
    color: var(--color-muted);
    font-size: 0.9rem;
    margin-bottom: 0.25rem;
  }
  .spent-amount {
    font-size: 2.7rem;
    font-weight: 700;
    color: var(--color-text);
    letter-spacing: -0.025em;
    line-height: 1;
    margin-bottom: 0.5rem;
  }
  .of-income {
    color: var(--color-muted);
    font-size: 0.9rem;
    margin-bottom: 0.85rem;
  }

  /* ── Extra-inflows chip ──────────────────────────────────────────── */
  .extra-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 1.1rem;
    padding: 0.3rem 0.7rem;
    background: color-mix(in oklab, var(--color-success) 14%, transparent);
    color: var(--color-success);
    border: 0;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease;
  }
  .extra-chip:disabled {
    cursor: default;
  }
  .extra-chip:not(:disabled):hover {
    background: color-mix(in oklab, var(--color-success) 22%, transparent);
  }
  .extra-chip .extra-arrow {
    transition: transform 0.16s ease;
  }
  .extra-chip:not(:disabled):hover .extra-arrow {
    transform: translateX(2px);
  }

  /* ── Progress meta + bar ─────────────────────────────────────────── */
  .progress-block {
    margin-bottom: 1.4rem;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
    font-size: 0.75rem;
  }
  .meta-left {
    color: var(--color-muted);
    font-weight: 500;
  }
  .meta-right {
    color: var(--color-success);
    font-weight: 700;
  }
  .meta-right.over {
    color: var(--color-danger);
  }
  .progress-track {
    height: 6px;
    background: var(--color-elevated);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 999px;
    background-image: var(--grad-primary);
    transition: width 0.3s ease;
  }
  .progress-fill.over {
    background-image: none;
    background-color: var(--color-danger);
  }

  /* ── Stats row ───────────────────────────────────────────────────── */
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.6rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
  }
  .stat-value-primary {
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.01em;
    color: var(--color-accent);
  }
  .stat-value {
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.1;
    color: var(--color-text);
  }
  .stat-label {
    font-size: 0.66rem;
    font-weight: 500;
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat-primary .stat-label {
    color: var(--color-accent);
  }

  /* ── Empty / warning notes ───────────────────────────────────────── */
  .pace-warning {
    margin-top: 0.85rem;
    font-size: 0.78rem;
    color: var(--color-danger);
  }
  .empty-note {
    margin-top: 0.85rem;
    font-size: 0.88rem;
    color: var(--color-muted);
  }
</style>
