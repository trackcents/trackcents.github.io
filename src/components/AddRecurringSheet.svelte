<script lang="ts">
  // "Add bill / add subscription" sheet (spec §7.10). Collects name · amount ·
  // paid-from pocket · Repeats? (one-time vs recurring) · cadence (Month / 3mo /
  // 6mo / Year / Custom "every N units") · first due date. Emits a draft item;
  // the page assigns the id/order and zeroes the paid figures.
  import { untrack } from 'svelte';
  import { parseMoney } from '$lib/util/money';
  import type { Pocket } from '$lib/app/pockets';
  import {
    advanceDueDate,
    type Cadence,
    type CadenceUnit,
    type RecurringKind
  } from '$lib/app/recurring-items';

  interface DraftItem {
    kind: RecurringKind;
    name: string;
    amount_minor: bigint;
    paid_from: string;
    cadence: Cadence;
    due_date: string;
  }
  interface Props {
    open: boolean;
    kind: RecurringKind;
    pockets: Pocket[];
    todayIso: string;
    onAdd: (draft: DraftItem) => void;
    onClose: () => void;
  }
  const { open, kind, pockets, todayIso, onAdd, onClose }: Props = $props();

  let name = $state('');
  let amountStr = $state('');
  let repeats = $state<'once' | 'recurring'>('recurring');
  let preset = $state<'monthly' | 'every_3_months' | 'every_6_months' | 'yearly' | 'custom'>(
    'monthly'
  );
  let customN = $state(2);
  let customUnit = $state<CadenceUnit>('weeks');
  let dueDate = $state('');
  let paidFrom = $state('paychecks');
  let err = $state('');

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      untrack(() => {
        name = '';
        amountStr = '';
        repeats = 'recurring';
        preset = 'monthly';
        customN = 2;
        customUnit = 'weeks';
        dueDate = todayIso;
        paidFrom = 'paychecks';
        err = '';
      });
    }
    wasOpen = open;
  });

  const ordered = $derived([...pockets].sort((a, b) => a.order - b.order));

  function cadence(): Cadence {
    if (repeats === 'once') return 'once';
    if (preset === 'custom') return { every: Math.max(1, customN), unit: customUnit };
    return preset;
  }
  const nextPreview = $derived.by<string | null>(() => {
    if (repeats === 'once' || dueDate === '') return null;
    try {
      return advanceDueDate(dueDate, cadence());
    } catch {
      return null;
    }
  });

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

  function submit(): void {
    if (name.trim() === '') {
      err = 'Give it a name';
      return;
    }
    let amount: bigint;
    try {
      amount = parseMoney(amountStr);
    } catch {
      err = 'Enter a valid amount';
      return;
    }
    if (dueDate === '') {
      err = 'Pick a due date';
      return;
    }
    onAdd({
      kind,
      name: name.trim(),
      amount_minor: amount,
      paid_from: paidFrom,
      cadence: cadence(),
      due_date: dueDate
    });
  }

  const presetLabels: Array<[typeof preset, string]> = [
    ['monthly', 'Month'],
    ['every_3_months', '3 months'],
    ['every_6_months', '6 months'],
    ['yearly', 'Year'],
    ['custom', 'Custom']
  ];
  const units: CadenceUnit[] = ['days', 'weeks', 'months', 'years'];
</script>

{#if open}
  <button type="button" class="ar-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="ar-sheet" role="dialog" aria-modal="true" aria-label="Add {kind}">
    <div class="ar-grab"></div>
    <h2 class="ar-name">New {kind === 'subscription' ? 'subscription 🔁' : 'bill 📋'}</h2>

    <div class="ar-two">
      <div class="ar-field">
        <span class="ar-lbl">Name</span>
        <input
          class="ar-in"
          bind:value={name}
          placeholder={kind === 'subscription' ? 'Netflix' : 'Car EMI'}
        />
      </div>
      <div class="ar-field">
        <span class="ar-lbl">Amount</span>
        <input class="ar-in" inputmode="decimal" bind:value={amountStr} placeholder="0.00" />
      </div>
    </div>

    <div class="ar-field">
      <span class="ar-lbl">Repeats?</span>
      <div class="ar-seg">
        <button type="button" class:on={repeats === 'once'} onclick={() => (repeats = 'once')}
          >One-time</button
        >
        <button
          type="button"
          class:on={repeats === 'recurring'}
          onclick={() => (repeats = 'recurring')}>Recurring 🔁</button
        >
      </div>
    </div>

    {#if repeats === 'recurring'}
      <div class="ar-field">
        <span class="ar-lbl">Every</span>
        <div class="ar-chips">
          {#each presetLabels as [val, label] (val)}
            <button
              type="button"
              class="ar-chip"
              class:on={preset === val}
              onclick={() => (preset = val)}
            >
              {label}
            </button>
          {/each}
        </div>
        {#if preset === 'custom'}
          <div class="ar-custom">
            <span>Every</span>
            <div class="ar-stepper">
              <button
                type="button"
                onclick={() => (customN = Math.max(1, customN - 1))}
                aria-label="Decrease">−</button
              >
              <span class="ar-val">{customN}</span>
              <button type="button" onclick={() => (customN = customN + 1)} aria-label="Increase"
                >＋</button
              >
            </div>
            <select class="ar-unit" bind:value={customUnit} aria-label="Unit">
              {#each units as u (u)}<option value={u}>{u}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ar-two">
      <div class="ar-field">
        <span class="ar-lbl">{repeats === 'once' ? 'Due date' : 'First due date'}</span>
        <input class="ar-date" type="date" bind:value={dueDate} />
      </div>
      <div class="ar-field">
        <span class="ar-lbl">Paid from</span>
        <div class="ar-pockets">
          {#each ordered as p (p.id)}
            <button
              type="button"
              class="ar-chip"
              class:on={paidFrom === p.id}
              onclick={() => (paidFrom = p.id)}
            >
              {p.logo}
              {p.name}
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if nextPreview}
      <p class="ar-note">
        🔁 After each payment the next due auto-advances · next {prettyDate(nextPreview)}.
      </p>
    {:else if repeats === 'once'}
      <p class="ar-note">Just this once — it won't come back.</p>
    {/if}

    {#if err}<p class="ar-err">{err}</p>{/if}

    <button type="button" class="ar-btn" onclick={submit}>Add {kind}</button>
    <button type="button" class="ar-cancel" onclick={onClose}>Cancel</button>
  </div>
{/if}

<style>
  .ar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .ar-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 1.25rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: calc(88dvh - var(--kb-inset-bottom, 0px));
    overflow-y: auto;
    animation: ar-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes ar-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .ar-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.7rem;
  }
  .ar-name {
    font-size: 1.25rem;
    font-weight: 800;
    margin-bottom: 1rem;
    color: var(--color-text);
  }
  .ar-two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  .ar-field {
    margin-bottom: 0.8rem;
  }
  .ar-lbl {
    display: block;
    font-size: 0.66rem;
    color: var(--color-muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.3rem;
  }
  .ar-in,
  .ar-date {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.7rem 0.9rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-surface);
    font-family: inherit;
  }
  .ar-in:focus,
  .ar-date:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .ar-seg {
    display: flex;
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 3px;
  }
  .ar-seg button {
    flex: 1;
    text-align: center;
    padding: 0.55rem;
    border-radius: 9px;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-muted);
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-seg button.on {
    background: var(--color-surface);
    color: var(--color-accent);
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.08));
  }
  .ar-chips,
  .ar-pockets {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .ar-chip {
    padding: 0.5rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-muted);
    background: var(--color-surface);
    cursor: pointer;
    font-family: inherit;
  }
  .ar-chip.on {
    background: color-mix(in oklab, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .ar-custom {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.7rem;
    border: 1.5px solid var(--color-accent);
    background: color-mix(in oklab, var(--color-accent) 8%, transparent);
    border-radius: 14px;
    padding: 0.7rem;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .ar-stepper {
    display: flex;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: 11px;
    background: var(--color-surface);
    overflow: hidden;
  }
  .ar-stepper button {
    width: 36px;
    height: 38px;
    border: 0;
    background: transparent;
    font-size: 18px;
    color: var(--color-accent);
    font-weight: 700;
    cursor: pointer;
  }
  .ar-val {
    width: 40px;
    text-align: center;
    font-size: 1.1rem;
    font-weight: 800;
  }
  .ar-unit {
    flex: 1;
    border: 1px solid var(--color-border);
    border-radius: 11px;
    background: var(--color-surface);
    padding: 0.6rem 0.7rem;
    font-weight: 700;
    color: var(--color-text);
    font-family: inherit;
  }
  .ar-note {
    font-size: 0.76rem;
    color: var(--color-muted);
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 0.6rem 0.8rem;
    line-height: 1.45;
    margin: 0.3rem 0 0.9rem;
  }
  .ar-err {
    color: var(--color-danger);
    font-size: 0.82rem;
    margin: 0.2rem 0 0.6rem;
  }
  .ar-btn {
    width: 100%;
    padding: 0.9rem;
    border-radius: 14px;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 700;
    font-size: 1rem;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-cancel {
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
