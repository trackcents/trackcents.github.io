<script lang="ts">
  // "Mark paid" sheet for a recurring bill/subscription (spec §7.9). Deliberate,
  // never a one-tap toggle. Two editable amounts: the cycle TOTAL (the EMI may
  // have changed) and PAYING NOW (defaults to the remaining amount; set it lower
  // for a partial/installment payment). Plus a paid-from pocket + paid-on date.
  // A fully-paid item instead offers "Mark unpaid" and (for recurring) "Start
  // next cycle". All amounts are bigint cents.
  import { untrack } from 'svelte';
  import { formatMoney, parseMoney } from '$lib/util/money';
  import { centsToDecimal } from '$lib/app/export-csv';
  import {
    deriveStatus,
    remainingMinor,
    nextDueDate,
    cadenceLabel,
    type RecurringItem,
    type PaymentInput
  } from '$lib/app/recurring-items';
  import type { Pocket } from '$lib/app/pockets';

  interface Props {
    open: boolean;
    item: RecurringItem | null;
    pockets: Pocket[];
    todayIso: string;
    onPay: (input: PaymentInput) => void;
    onMarkUnpaid: () => void;
    onStartNextCycle: () => void;
    onClose: () => void;
  }
  const { open, item, pockets, todayIso, onPay, onMarkUnpaid, onStartNextCycle, onClose }: Props =
    $props();

  let totalStr = $state('');
  let payingStr = $state('');
  let paidFrom = $state('paychecks');
  let paidOn = $state('');
  let err = $state('');

  // Rising-edge init: only (re)seed the drafts the moment the sheet opens for an
  // item — NOT on every reactive tick (that would clobber the user's typing).
  let wasOpen = false;
  $effect(() => {
    const isOpen = open && item !== null;
    if (isOpen && !wasOpen) {
      untrack(() => {
        const it = item as RecurringItem;
        const rem = remainingMinor(it);
        totalStr = centsToDecimal(it.amount_minor);
        payingStr = centsToDecimal(rem > 0n ? rem : it.amount_minor);
        paidFrom = it.paid_from;
        paidOn = todayIso;
        err = '';
      });
    }
    wasOpen = isOpen;
  });

  const ordered = $derived([...pockets].sort((a, b) => a.order - b.order));
  const status = $derived(item !== null ? deriveStatus(item, todayIso) : 'due');
  const isPaid = $derived(status === 'paid');

  function tryParse(s: string): bigint | null {
    try {
      return parseMoney(s);
    } catch {
      return null;
    }
  }
  const totalMinor = $derived(tryParse(totalStr));
  const payingMinor = $derived(tryParse(payingStr));
  // What remains AFTER this payment (cycle total − already paid − paying now).
  const leavesMinor = $derived(
    item !== null && totalMinor !== null && payingMinor !== null
      ? totalMinor - item.paid_minor - payingMinor
      : null
  );

  function submit(): void {
    if (item === null) return;
    const t = tryParse(totalStr);
    const p = tryParse(payingStr);
    if (t === null || p === null) {
      err = 'Enter a valid amount';
      return;
    }
    onPay({ totalMinor: t, payingNowMinor: p, paidFrom, paidOn });
  }

  const next = $derived(item !== null ? nextDueDate(item) : null);
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

{#if open && item !== null}
  <button type="button" class="pr-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="pr-sheet" role="dialog" aria-modal="true" aria-label="Pay {item.name}">
    <div class="pr-grab"></div>

    <p class="pr-kicker">
      {isPaid
        ? '✓ Paid'
        : item.kind === 'subscription'
          ? 'Pay this subscription 💳'
          : 'Pay this bill 💸'}
    </p>
    <h2 class="pr-name">{item.name}</h2>

    {#if isPaid}
      <p class="pr-paidline">
        Paid {item.paid_date ? prettyDate(item.paid_date) : ''} · {formatMoney(item.paid_minor)}
        {#if next}<br /><span class="pr-muted"
            >Next due {prettyDate(next)} · {cadenceLabel(item.cadence)}</span
          >{/if}
      </p>
      <div class="pr-actions">
        {#if item.cadence !== 'once'}
          <button type="button" class="pr-btn" onclick={onStartNextCycle}>Start next cycle →</button
          >
        {/if}
        <button type="button" class="pr-btn ghost" onclick={onMarkUnpaid}>Mark unpaid</button>
      </div>
    {:else}
      <div class="pr-field">
        <span class="pr-lbl">Total amount</span>
        <div class="pr-input">
          <input
            inputmode="decimal"
            bind:value={totalStr}
            aria-label="Total amount"
            onfocus={(e) => e.currentTarget.select()}
          />
        </div>
      </div>

      <div class="pr-field">
        <span class="pr-lbl">Paying now</span>
        <div class="pr-input focus">
          <input
            inputmode="decimal"
            bind:value={payingStr}
            aria-label="Paying now"
            onfocus={(e) => e.currentTarget.select()}
          />
        </div>
      </div>

      {#if leavesMinor !== null && leavesMinor > 0n}
        <p class="pr-hint">→ Leaves {formatMoney(leavesMinor)} · stays partially paid</p>
      {:else if leavesMinor !== null && leavesMinor < 0n}
        <p class="pr-hint">→ Overpaying by {formatMoney(-leavesMinor)}</p>
      {/if}

      <div class="pr-two">
        <div class="pr-field">
          <span class="pr-lbl">Paid from</span>
          <div class="pr-pockets">
            {#each ordered as p (p.id)}
              <button
                type="button"
                class="pr-chip"
                class:on={paidFrom === p.id}
                onclick={() => (paidFrom = p.id)}
              >
                {p.logo}
                {p.name}
              </button>
            {/each}
          </div>
        </div>
        <div class="pr-field">
          <span class="pr-lbl">Paid on</span>
          <input class="pr-date" type="date" bind:value={paidOn} aria-label="Paid on" />
        </div>
      </div>

      {#if err}<p class="pr-err">{err}</p>{/if}

      <button type="button" class="pr-btn primary" onclick={submit}>
        ✓ Mark {payingMinor !== null ? formatMoney(payingMinor) : ''} paid
      </button>
    {/if}
    <button type="button" class="pr-cancel" onclick={onClose}>Cancel</button>
  </div>
{/if}

<style>
  .pr-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .pr-sheet {
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
    animation: pr-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pr-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .pr-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.8rem;
  }
  .pr-kicker {
    font-size: 0.78rem;
    color: var(--color-muted);
    font-weight: 600;
  }
  .pr-name {
    font-size: 1.4rem;
    font-weight: 800;
    margin: 0.1rem 0 1rem;
    color: var(--color-text);
  }
  .pr-paidline {
    font-size: 0.95rem;
    color: var(--color-success);
    font-weight: 600;
    margin-bottom: 1rem;
  }
  .pr-muted {
    color: var(--color-muted);
    font-weight: 500;
  }
  .pr-field {
    margin-bottom: 0.8rem;
  }
  .pr-lbl {
    display: block;
    font-size: 0.66rem;
    color: var(--color-muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.3rem;
  }
  .pr-input {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.7rem 0.9rem;
  }
  .pr-input.focus {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-accent) 18%, transparent);
  }
  .pr-input input {
    width: 100%;
    border: 0;
    background: none;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--color-text);
    font-family: inherit;
  }
  .pr-input input:focus {
    outline: none;
  }
  .pr-hint {
    background: color-mix(in oklab, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
    border-radius: 12px;
    padding: 0.6rem 0.8rem;
    font-size: 0.82rem;
    font-weight: 600;
    margin-bottom: 0.8rem;
  }
  .pr-two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  .pr-pockets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .pr-chip {
    padding: 0.5rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-muted);
    background: var(--color-surface);
    cursor: pointer;
  }
  .pr-chip.on {
    background: color-mix(in oklab, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .pr-date {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.65rem 0.8rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-surface);
    font-family: inherit;
  }
  .pr-err {
    color: var(--color-danger);
    font-size: 0.82rem;
    margin: 0.2rem 0 0.6rem;
  }
  .pr-actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .pr-btn {
    width: 100%;
    padding: 0.9rem;
    border-radius: 14px;
    font-weight: 700;
    font-size: 1rem;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    margin-top: 0.4rem;
    font-family: inherit;
  }
  .pr-btn.primary {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    border: 0;
  }
  .pr-btn.ghost {
    color: var(--color-muted);
  }
  .pr-cancel {
    width: 100%;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.88rem;
    margin-top: 0.8rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
</style>
