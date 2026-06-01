<script lang="ts">
  // Per-pocket "manage" sheet (spec 002-income-pockets §3) — the redesigned
  // income banner. Opened from a pocket card's "manage ›". Lists ONLY this
  // pocket's deposits for the month (roomy cards, not the cramped old popup),
  // shows total + carried-in breakdown, "＋ Add income", and opens the focused
  // IncomeEditSheet when a deposit is tapped.
  import { formatMoney } from '$lib/util/money';
  import type { IncomeRow } from '$lib/app/categorization-glue';
  import type { PocketSummary } from '$lib/app/pockets';
  import type { TransactionAnnotation } from '$lib/app/categorization';
  import type { Pocket } from '$lib/app/pockets';
  import IncomeEditSheet from '$components/IncomeEditSheet.svelte';

  interface Props {
    open: boolean;
    summary: PocketSummary | null;
    monthLabel: string;
    /** Deposits for THIS pocket this month (already filtered by pocketId). */
    rows: IncomeRow[];
    annotations: Record<string, TransactionAnnotation>;
    pockets: Pocket[];
    onUpdate: (key: string, patch: Partial<TransactionAnnotation>) => void;
    onRemove: (key: string) => void;
    onAddIncome: () => void;
    onClose: () => void;
  }
  const {
    open,
    summary,
    monthLabel,
    rows,
    annotations,
    pockets,
    onUpdate,
    onRemove,
    onAddIncome,
    onClose
  }: Props = $props();

  let editKey = $state<string | null>(null);
  const editRow = $derived(editKey === null ? null : (rows.find((r) => r.key === editKey) ?? null));

  function kindOf(r: IncomeRow): string {
    const k = annotations[r.key]?.income_kind;
    if (k !== undefined && k !== '') return k;
    if (r.flow_intent === 'salary') return 'Paycheck';
    if (r.flow_intent === 'interest_earned') return 'Interest';
    if (r.flow_intent === 'cash_in') return 'Cash';
    return 'From a person';
  }
  function prettyDate(iso: string): string {
    const [, m, d] = iso.split('-');
    const months = [
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
    return `${months[Number(m)]} ${Number(d)}`;
  }
</script>

{#if open && summary !== null}
  <button type="button" class="pm-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="pm-sheet" role="dialog" aria-modal="true" aria-label="{summary.pocket.name} income">
    <div class="pm-grab"></div>

    <div class="pm-head">
      <div class="pm-chip">{summary.pocket.logo}</div>
      <div>
        <h2>{summary.pocket.name}</h2>
        <div class="pm-sub">{monthLabel}</div>
      </div>
      <button type="button" class="pm-x" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <p class="pm-big" class:neg={summary.remaining < 0n}>{formatMoney(summary.total)}</p>
    <p class="pm-split">
      {#if summary.carryIn !== 0n}
        {formatMoney(summary.carryIn)} carried in&nbsp;+&nbsp;<b
          >{formatMoney(summary.newIncome)} new this month</b
        >
      {:else}
        <b>{formatMoney(summary.newIncome)} new this month</b>
      {/if}
    </p>

    <p class="pm-seclbl">New this month · tap to edit</p>
    {#if rows.length === 0}
      <p class="pm-empty">No income in this box this month.</p>
    {:else}
      {#each rows as r (r.key)}
        <button type="button" class="pm-row" onclick={() => (editKey = r.key)}>
          <span class="pm-ic">{r.flow_intent === 'salary' ? '💵' : '🧑'}</span>
          <span class="pm-body">
            <span class="pm-nm">{r.description}</span>
            <span class="pm-meta"
              >{prettyDate(r.posted_date)} <span class="pm-pill">{kindOf(r)}</span></span
            >
          </span>
          <span class="pm-amt">
            {formatMoney(r.income_minor)}
            {#if r.income_minor !== r.amount_minor}<span class="pm-capped"
                >of {formatMoney(r.amount_minor)}</span
              >{/if}
            <span class="pm-edit">edit ›</span>
          </span>
        </button>
      {/each}
    {/if}

    <button type="button" class="pm-add" onclick={onAddIncome}>＋ Add income</button>

    {#if summary.carryIn !== 0n}
      <p class="pm-seclbl">Earlier</p>
      <div class="pm-carry">
        <span>Carried from earlier months</span>
        <b>{formatMoney(summary.carryIn)}</b>
      </div>
      <p class="pm-carrynote">Edit those deposits in their own month.</p>
    {/if}
  </div>

  <IncomeEditSheet
    open={editRow !== null}
    row={editRow}
    annotation={editRow !== null ? annotations[editRow.key] : undefined}
    {pockets}
    onUpdate={(key, patch) => {
      onUpdate(key, patch);
      editKey = null;
    }}
    onRemove={(key) => {
      onRemove(key);
      editKey = null;
    }}
    onClose={() => (editKey = null)}
  />
{/if}

<style>
  .pm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.5);
    border: 0;
    cursor: pointer;
  }
  .pm-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 0.5rem 1.1rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: 90dvh;
    overflow-y: auto;
    animation: pm-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pm-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .pm-grab {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.8rem;
  }
  .pm-head {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 0.3rem;
  }
  .pm-chip {
    width: 44px;
    height: 44px;
    border-radius: 13px;
    display: grid;
    place-items: center;
    font-size: 22px;
    background: var(--color-elevated);
    flex: none;
  }
  .pm-head h2 {
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--color-text);
  }
  .pm-sub {
    font-size: 0.78rem;
    color: var(--color-muted);
  }
  .pm-x {
    margin-left: auto;
    background: var(--color-elevated);
    border: 0;
    border-radius: 999px;
    width: 32px;
    height: 32px;
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .pm-big {
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 0.6rem 0 0.1rem;
    color: var(--color-text);
  }
  .pm-big.neg {
    color: var(--color-danger);
  }
  .pm-split {
    font-size: 0.82rem;
    color: var(--color-muted);
    margin-bottom: 1.1rem;
  }
  .pm-split b {
    color: var(--color-success);
  }
  .pm-seclbl {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin: 0.3rem 0.1rem 0.55rem;
  }
  .pm-empty {
    font-size: 0.88rem;
    color: var(--color-muted);
    padding: 0.4rem 0.1rem 0.6rem;
  }
  .pm-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 0.75rem 0.8rem;
    margin-bottom: 0.55rem;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }
  .pm-ic {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-size: 19px;
    background: color-mix(in oklab, var(--color-success) 14%, transparent);
    flex: none;
  }
  .pm-body {
    flex: 1;
    min-width: 0;
  }
  .pm-nm {
    display: block;
    font-weight: 700;
    font-size: 0.96rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pm-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--color-muted);
    margin-top: 0.15rem;
  }
  .pm-pill {
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--color-success);
    background: color-mix(in oklab, var(--color-success) 14%, transparent);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }
  .pm-amt {
    text-align: right;
    font-weight: 800;
    font-size: 1.02rem;
    color: var(--color-text);
    flex: none;
  }
  .pm-capped {
    display: block;
    font-size: 0.66rem;
    font-weight: 600;
    color: var(--color-muted);
  }
  .pm-edit {
    display: block;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-accent);
  }
  .pm-add {
    width: 100%;
    border: 1.5px dashed var(--color-border);
    border-radius: 16px;
    padding: 0.8rem;
    text-align: center;
    color: var(--color-accent);
    font-weight: 700;
    font-size: 0.9rem;
    background: transparent;
    cursor: pointer;
    margin: 0.2rem 0 0.6rem;
    font-family: inherit;
  }
  .pm-carry {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: color-mix(in oklab, var(--color-accent) 7%, transparent);
    border-radius: 14px;
    padding: 0.75rem 0.9rem;
    font-weight: 700;
    font-size: 0.92rem;
  }
  .pm-carrynote {
    font-size: 0.74rem;
    color: var(--color-muted);
    margin: 0.4rem 0.2rem 0;
  }
</style>
