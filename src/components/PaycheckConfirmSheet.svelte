<script lang="ts">
  // "Confirm your paychecks" (spec 002-income-pockets §6, §7.11). On upload (or
  // from Home when not yet set up) we ask ONE thing — which budget month your
  // MOST RECENT paycheck funds — and a fixed 14-day grid maps every other
  // paycheck backward automatically. The latest paychecks are shown so the user
  // can sanity-check the rhythm. Never amount-based.
  import { untrack } from 'svelte';
  import { formatMoney } from '$lib/util/money';
  import { groupIntoBudgetWindows, type BudgetAnchor } from '$lib/app/budget-window';
  import { smartDefaultAnchor } from '$lib/app/paycheck-budget';
  import type { Paycheck } from '$lib/app/paycheck-detector';

  interface Props {
    open: boolean;
    /** Detected paychecks, NEWEST first. */
    paychecks: Paycheck[];
    onSave: (anchor: BudgetAnchor) => void;
    onClose: () => void;
  }
  const { open, paychecks, onSave, onClose }: Props = $props();

  const MON = [
    '',
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
  const fmtBM = (ym: string): string => `${MON[Number(ym.slice(5, 7))]} ${ym.slice(0, 4)}`;
  function addMonths(a: BudgetAnchor, delta: number): BudgetAnchor {
    const zero = a.month - 1 + delta;
    return { year: a.year + Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
  }
  const bmStr = (a: BudgetAnchor): string => `${a.year}-${String(a.month).padStart(2, '0')}`;

  // Chronological order (oldest→newest) for the grouper.
  const chrono = $derived(
    [...paychecks].sort((a, b) =>
      a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : 0
    )
  );
  const lastWindowIndex = $derived(Math.floor((chrono.length - 1) / 2));

  // The budget month the user assigns to the MOST RECENT paycheck. From it the
  // anchor (first paycheck's month) is derived: anchor = chosen − lastWindowIndex.
  let chosenMonth = $state<string>(''); // "YYYY-MM"

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen && chrono.length > 0) {
      untrack(() => {
        const smart = smartDefaultAnchor(chrono[0]) ?? { year: 2026, month: 1 };
        const lastBM = addMonths(smart, lastWindowIndex); // most-recent paycheck's month
        chosenMonth = bmStr(lastBM);
      });
    }
    wasOpen = open;
  });

  const anchor = $derived.by<BudgetAnchor | null>(() => {
    if (chosenMonth === '') return null;
    const y = Number(chosenMonth.slice(0, 4));
    const m = Number(chosenMonth.slice(5, 7));
    return addMonths({ year: y, month: m }, -lastWindowIndex);
  });
  const windows = $derived(anchor === null ? [] : groupIntoBudgetWindows(chrono, anchor));

  // Month <select> options: the most-recent paycheck's calendar month −1…+2.
  const monthOptions = $derived.by<string[]>(() => {
    if (chrono.length === 0) return [];
    const newest = paychecks[0]!.posted_date;
    const base: BudgetAnchor = {
      year: Number(newest.slice(0, 4)),
      month: Number(newest.slice(5, 7))
    };
    return [-1, 0, 1, 2].map((d) => bmStr(addMonths(base, d)));
  });

  function fmtDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${MON[Number(m)]} ${Number(d)}`;
  }
  function save(): void {
    if (anchor !== null) onSave(anchor);
  }
</script>

{#if open && chrono.length > 0}
  <button type="button" class="pc-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="pc-sheet" role="dialog" aria-modal="true" aria-label="Confirm your paychecks">
    <div class="pc-grab"></div>

    <div class="pc-head">
      <div class="pc-chip">💵</div>
      <div>
        <h2>Confirm your paychecks</h2>
        <div class="pc-sub">I found {paychecks.length} paychecks, about every 2 weeks.</div>
      </div>
    </div>

    <div class="pc-q">
      <span class="pc-lbl">Your most recent paycheck funds</span>
      <div class="pc-qrow">
        <div class="pc-pay">
          <b>{fmtDate(paychecks[0]!.posted_date)}</b> · {formatMoney(paychecks[0]!.amount_minor)}
        </div>
        <select class="pc-sel" bind:value={chosenMonth} aria-label="Budget month">
          {#each monthOptions as opt (opt)}<option value={opt}>{fmtBM(opt)}</option>{/each}
        </select>
      </div>
    </div>

    <p class="pc-seclbl">So your recent paychecks map like this</p>
    <div class="pc-windows">
      {#each [...windows].reverse().slice(0, 3) as w (w.budget_month)}
        <div class="pc-w">
          <span class="pc-wm">{fmtBM(w.budget_month)}</span>
          <span class="pc-wp">
            {w.paychecks.map((p) => fmtDate(p.posted_date)).join('  +  ')}
            {#if !w.complete}<span class="pc-prog"> (so far)</span>{/if}
          </span>
        </div>
      {/each}
    </div>
    <p class="pc-note">Earlier months fill in automatically. You can change this later.</p>

    <button type="button" class="pc-save" onclick={save}>Looks right 👍</button>
    <button type="button" class="pc-skip" onclick={onClose}>Not now</button>
  </div>
{/if}

<style>
  .pc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.5);
    border: 0;
    cursor: pointer;
  }
  .pc-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 0.5rem 1.25rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: 90dvh;
    overflow-y: auto;
    animation: pc-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pc-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .pc-grab {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.9rem;
  }
  .pc-head {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 1.1rem;
  }
  .pc-chip {
    width: 46px;
    height: 46px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    font-size: 23px;
    background: color-mix(in oklab, var(--color-success) 15%, transparent);
    flex: none;
  }
  .pc-head h2 {
    font-size: 1.18rem;
    font-weight: 800;
    color: var(--color-text);
  }
  .pc-sub {
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .pc-q {
    background: var(--color-elevated);
    border-radius: 16px;
    padding: 0.9rem;
    margin-bottom: 1.1rem;
  }
  .pc-lbl {
    display: block;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin-bottom: 0.5rem;
  }
  .pc-qrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }
  .pc-pay {
    font-size: 0.95rem;
    color: var(--color-text);
  }
  .pc-sel {
    border: 1px solid var(--color-border);
    border-radius: 11px;
    padding: 0.55rem 0.7rem;
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--color-accent);
    background: var(--color-surface);
    font-family: inherit;
  }
  .pc-seclbl {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin: 0.2rem 0.1rem 0.6rem;
  }
  .pc-windows {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .pc-w {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--color-border);
    border-radius: 13px;
  }
  .pc-wm {
    font-weight: 800;
    font-size: 0.92rem;
    color: var(--color-text);
    flex: none;
    min-width: 4.5rem;
  }
  .pc-wp {
    font-size: 0.82rem;
    color: var(--color-muted);
  }
  .pc-prog {
    color: var(--color-accent);
    font-weight: 600;
  }
  .pc-note {
    font-size: 0.76rem;
    color: var(--color-muted);
    margin: 0.7rem 0.1rem 0;
  }
  .pc-save {
    width: 100%;
    padding: 0.95rem;
    border-radius: 15px;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 800;
    font-size: 1.02rem;
    border: 0;
    cursor: pointer;
    margin-top: 1rem;
    font-family: inherit;
  }
  .pc-skip {
    width: 100%;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.88rem;
    margin-top: 0.7rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
</style>
