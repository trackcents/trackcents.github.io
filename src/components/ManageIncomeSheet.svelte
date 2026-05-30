<script lang="ts">
  // "Manage income" drill-down — opened from the Home BudgetBox income line.
  // Shows ONLY the income deposits that make up this month's income number
  // (Hemanth: tapping "other inflows" must NOT dump me into all transactions —
  // show only the income ones, and let me edit them here). Per deposit: rename,
  // remove-from-income, exclude, and CAP how much counts as income ("$5000
  // deposit but only $4000 is income"), routing the leftover to savings or
  // exclude. Carry-to-next-month is the next step.
  import { formatMoney, parseMoney } from '$lib/util/money';
  import { centsToDecimal } from '$lib/app/export-csv';
  import type { IncomeRow } from '$lib/app/categorization-glue';
  import type { TransactionAnnotation } from '$lib/app/categorization';
  import type { FlowIntent } from '$lib/app/flow-intent';

  let {
    open,
    monthLabel,
    rows,
    totalMinor,
    onUpdate,
    onClose
  }: {
    open: boolean;
    monthLabel: string;
    rows: IncomeRow[];
    totalMinor: bigint;
    onUpdate: (key: string, patch: Partial<TransactionAnnotation>) => void;
    onClose: () => void;
  } = $props();

  let expandedKey = $state<string | null>(null);
  let draftName = $state('');
  // Cap editor state (per the currently-expanded row).
  let capDraft = $state(''); // decimal string of "counts as income"
  let capDest = $state<'investment_out' | 'transfer_self'>('investment_out');
  let capError = $state('');

  const INTENT_LABEL: Record<string, string> = {
    salary: 'Paycheck',
    gift_in: 'Other income',
    interest_earned: 'Interest',
    cash_in: 'Cash / check'
  };
  function intentLabel(i: FlowIntent): string {
    return INTENT_LABEL[i] ?? 'Income';
  }
  function prettyDate(iso: string): string {
    // iso = YYYY-MM-DD → "12 May"
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
    return `${Number(d)} ${months[Number(m)] ?? ''}`.trim();
  }

  function toggle(row: IncomeRow): void {
    if (expandedKey === row.key) {
      expandedKey = null;
    } else {
      expandedKey = row.key;
      draftName = row.description;
      capDraft = centsToDecimal(row.income_minor);
      capError = '';
      // Pre-select the destination from the existing leftover part, if capped.
      const leftover = row.split?.find((p) => p.flow_intent !== undefined);
      capDest = leftover?.flow_intent === 'transfer_self' ? 'transfer_self' : 'investment_out';
    }
  }
  function saveName(key: string): void {
    onUpdate(key, { custom_name: draftName.trim() });
    expandedKey = null;
  }
  function removeFromIncome(key: string): void {
    // Keep the transaction, but stop it counting as income (money movement).
    onUpdate(key, { flow_intent: 'transfer_self' });
    expandedKey = null;
  }
  /** Cap how much of a deposit counts as income; route the leftover to the
   *  chosen bucket (savings = investment_out, exclude = transfer_self) as a
   *  split. Conserved: the two parts sum to the full deposit. */
  function applyCap(row: IncomeRow): void {
    let cap: bigint;
    try {
      cap = parseMoney(capDraft);
    } catch {
      capError = 'Enter a valid amount.';
      return;
    }
    if (cap < 0n) cap = 0n;
    if (cap >= row.amount_minor) {
      // Counting the whole deposit → no cap; clear any existing split ([] is
      // dropped by pruneAnnotation).
      onUpdate(row.key, { split: [] });
      expandedKey = null;
      return;
    }
    const leftover = row.amount_minor - cap;
    const parts =
      cap === 0n
        ? [{ category_id: null, amount_minor: leftover, flow_intent: capDest }]
        : [
            { category_id: null, amount_minor: cap },
            { category_id: null, amount_minor: leftover, flow_intent: capDest }
          ];
    onUpdate(row.key, { split: parts });
    expandedKey = null;
  }
  function removeCap(key: string): void {
    onUpdate(key, { split: [] });
    expandedKey = null;
  }
  function exclude(key: string): void {
    onUpdate(key, { ignored: true });
    expandedKey = null;
  }
</script>

{#if open}
  <button type="button" class="mi-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="mi-sheet" role="dialog" aria-modal="true" aria-label="Manage income">
    <div class="mi-grab"></div>
    <div class="mi-head">
      <div>
        <h2>Income · {monthLabel}</h2>
        <p class="mi-total">
          {formatMoney(totalMinor)} from {rows.length}
          {rows.length === 1 ? 'deposit' : 'deposits'}
        </p>
      </div>
      <button type="button" class="mi-close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="mi-body">
      {#if rows.length === 0}
        <p class="mi-empty">No income deposits counted for this month yet.</p>
      {/if}

      {#each rows as row (row.key)}
        <div class="mi-row" class:open={expandedKey === row.key}>
          <button type="button" class="mi-row-main" onclick={() => toggle(row)}>
            <span class="mi-row-info">
              <span class="mi-name">{row.description}</span>
              <span class="mi-sub"
                >{prettyDate(row.posted_date)} · {intentLabel(row.flow_intent)}</span
              >
            </span>
            <span class="mi-amount-wrap">
              <span class="mi-amount">+{formatMoney(row.income_minor)}</span>
              {#if row.income_minor !== row.amount_minor}
                <span class="mi-amount-of">of {formatMoney(row.amount_minor)}</span>
              {/if}
            </span>
          </button>

          {#if expandedKey === row.key}
            <div class="mi-edit">
              <div class="mi-cap">
                <span class="mi-lbl">Counts as income</span>
                <div class="mi-cap-row">
                  <input
                    type="text"
                    bind:value={capDraft}
                    class="mi-input mi-cap-input"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label="Amount of this deposit that counts as income"
                  />
                  <span class="mi-cap-of">of {formatMoney(row.amount_minor)} deposit</span>
                </div>
                {#if capError !== ''}<span class="mi-cap-err">{capError}</span>{/if}
                <div class="mi-leftover">
                  <span class="mi-leftover-lbl">Leftover →</span>
                  <div class="mi-seg">
                    <button
                      type="button"
                      class:active={capDest === 'investment_out'}
                      onclick={() => (capDest = 'investment_out')}>Savings</button
                    >
                    <button
                      type="button"
                      class:active={capDest === 'transfer_self'}
                      onclick={() => (capDest = 'transfer_self')}>Exclude</button
                    >
                  </div>
                </div>
                <div class="mi-actions">
                  <button type="button" class="mi-save" onclick={() => applyCap(row)}>
                    {row.split ? 'Update cap' : 'Cap income'}
                  </button>
                  {#if row.split}
                    <button type="button" class="mi-secondary" onclick={() => removeCap(row.key)}>
                      Remove cap
                    </button>
                  {/if}
                </div>
              </div>

              <label class="mi-field">
                <span class="mi-lbl">Rename this income</span>
                <input
                  type="text"
                  bind:value={draftName}
                  class="mi-input"
                  autocomplete="off"
                  placeholder="e.g. Salary, Dad, IRS refund"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveName(row.key);
                    }
                  }}
                />
              </label>
              <div class="mi-actions">
                <button type="button" class="mi-save" onclick={() => saveName(row.key)}
                  >Save name</button
                >
                <button
                  type="button"
                  class="mi-secondary"
                  onclick={() => removeFromIncome(row.key)}
                >
                  Not income
                </button>
                <button type="button" class="mi-danger" onclick={() => exclude(row.key)}
                  >Exclude</button
                >
              </div>
              <p class="mi-hint">
                <strong>Not income</strong> keeps the transaction but stops it counting as income
                (e.g. a transfer).
                <strong>Exclude</strong> hides it from everything.
              </p>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .mi-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .mi-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 0 calc(0.8rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-height: calc(82dvh - var(--kb-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    max-width: 640px;
    margin: 0 auto;
    animation: mi-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes mi-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .mi-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.6rem;
  }
  .mi-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 0 1.1rem 0.6rem;
  }
  .mi-head h2 {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .mi-total {
    font-size: 0.82rem;
    color: var(--color-muted);
    margin-top: 0.1rem;
  }
  .mi-close {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .mi-body {
    overflow-y: auto;
    padding: 0 0.8rem 0.4rem;
    flex: 1;
  }
  .mi-empty {
    text-align: center;
    color: var(--color-muted);
    font-size: 0.9rem;
    padding: 1.6rem 0.8rem;
  }
  .mi-row {
    border-radius: 14px;
    margin-bottom: 0.35rem;
    background: var(--color-elevated);
  }
  .mi-row.open {
    background: var(--color-accent-soft);
  }
  .mi-row-main {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--color-text);
    padding: 0.7rem 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .mi-row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .mi-name {
    font-size: 0.95rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mi-sub {
    font-size: 0.72rem;
    color: var(--color-muted);
  }
  .mi-amount-wrap {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.1;
  }
  .mi-amount {
    font-size: 0.98rem;
    font-weight: 700;
    color: var(--color-success);
    font-variant-numeric: tabular-nums;
  }
  .mi-amount-of {
    font-size: 0.68rem;
    color: var(--color-muted);
    text-decoration: line-through;
  }
  /* ── Cap editor ──────────────────────────────────────────────── */
  .mi-cap {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.65rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
  }
  .mi-cap-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .mi-cap-input {
    width: 7.5rem;
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .mi-cap-of {
    font-size: 0.78rem;
    color: var(--color-muted);
  }
  .mi-cap-err {
    font-size: 0.72rem;
    color: var(--color-danger);
  }
  .mi-leftover {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .mi-leftover-lbl {
    font-size: 0.78rem;
    color: var(--color-muted);
  }
  .mi-seg {
    display: inline-flex;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    overflow: hidden;
  }
  .mi-seg button {
    border: 0;
    background: transparent;
    color: var(--color-muted);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.35rem 0.8rem;
    cursor: pointer;
  }
  .mi-seg button.active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
  }
  .mi-edit {
    padding: 0 0.85rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .mi-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .mi-lbl {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted);
  }
  .mi-input {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    font-size: 0.95rem;
    color: var(--color-text);
  }
  .mi-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .mi-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .mi-save,
  .mi-secondary,
  .mi-danger {
    border-radius: 10px;
    padding: 0.5rem 0.8rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--color-border);
  }
  .mi-save {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    border-color: transparent;
  }
  .mi-secondary {
    background: var(--color-surface);
    color: var(--color-text);
  }
  .mi-danger {
    background: var(--color-surface);
    color: var(--color-danger);
    border-color: color-mix(in oklab, var(--color-danger) 35%, var(--color-border));
  }
  .mi-hint {
    font-size: 0.72rem;
    color: var(--color-muted);
    line-height: 1.4;
  }
  .mi-hint strong {
    color: var(--color-text);
  }
</style>
