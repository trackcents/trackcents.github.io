<script lang="ts">
  // "Mark paid" sheet for ONE budget month of a recurring bill/subscription
  // (spec §7.9). Deliberate, never a one-tap toggle. This sheet ONLY pays — it
  // does not edit the bill's standard amount/name/cadence (that's the "Edit"
  // sheet, reached by tapping the row body). So there is no "total amount" field
  // to confuse the user: "Paying now" defaults to what's still owed for the
  // month; pay less for a partial/installment. A fully-paid month instead offers
  // "Mark unpaid". All amounts are bigint cents. Keyboard-safe: the sheet scrolls
  // and the focused field is brought above the on-screen keyboard.
  import { untrack } from 'svelte';
  import { formatMoney, parseMoney } from '$lib/util/money';
  import { centsToDecimal } from '$lib/app/export-csv';
  import {
    statusInMonth,
    remainingInMonth,
    paidInMonth,
    latestPaymentInMonth,
    dueDateInMonth,
    type RecurringItem,
    type PaymentInput
  } from '$lib/app/recurring-items';
  import type { Pocket } from '$lib/app/pockets';

  interface Props {
    open: boolean;
    item: RecurringItem | null;
    /** Budget month being paid, 'YYYY-MM'. */
    month: string;
    pockets: Pocket[];
    todayIso: string;
    onPay: (input: PaymentInput) => void;
    onMarkUnpaid: () => void;
    onClose: () => void;
  }
  const { open, item, month, pockets, todayIso, onPay, onMarkUnpaid, onClose }: Props = $props();

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
        const rem = remainingInMonth(it, month);
        // Default to what's still owed for the month; if already fully covered,
        // offer the full amount (an extra/duplicate payment is possible but rare).
        payingStr = centsToDecimal(rem > 0n ? rem : it.amount_minor);
        paidFrom = it.paid_from;
        // Default the paid-on date to a sensible day INSIDE the budget month being
        // paid (the due date if that month isn't the current one), so a back-dated
        // payment lands in the right month without extra taps.
        paidOn = month === todayIso.slice(0, 7) ? todayIso : dueDateInMonth(it, month);
        err = '';
      });
    }
    wasOpen = isOpen;
  });

  const ordered = $derived([...pockets].sort((a, b) => a.order - b.order));
  const status = $derived(item !== null ? statusInMonth(item, month, todayIso) : 'due');
  const isPaid = $derived(status === 'paid');
  const alreadyPaid = $derived(item !== null ? paidInMonth(item, month) : 0n);
  const lastPay = $derived(item !== null ? latestPaymentInMonth(item, month) : null);

  function tryParse(s: string): bigint | null {
    try {
      return parseMoney(s);
    } catch {
      return null;
    }
  }
  const payingMinor = $derived(tryParse(payingStr));
  // What remains for the month AFTER this payment (amount − already paid − paying).
  const leavesMinor = $derived(
    item !== null && payingMinor !== null ? item.amount_minor - alreadyPaid - payingMinor : null
  );

  function submit(): void {
    if (item === null) return;
    const p = tryParse(payingStr);
    if (p === null) {
      err = 'Enter a valid amount';
      return;
    }
    if (p <= 0n) {
      err = 'Paying now must be more than 0 — to just change the bill, tap “Edit”';
      return;
    }
    onPay({ month, payingNowMinor: p, paidFrom, paidOn });
  }

  const MONTHS = [
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
  function prettyDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${MONTHS[Number(m)]} ${Number(d)}`;
  }
  function monthName(ym: string): string {
    const [y, m] = ym.split('-');
    return `${MONTHS[Number(m)]} ${y}`;
  }
  // Bring a just-focused field above the on-screen keyboard.
  function scrollIntoView(e: FocusEvent): void {
    const el = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
</script>

{#if open && item !== null}
  <button type="button" class="pr-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="pr-sheet" role="dialog" aria-modal="true" aria-label="Pay {item.name}">
    <div class="pr-grab"></div>

    <p class="pr-kicker">
      {isPaid
        ? `✓ Paid · ${monthName(month)}`
        : item.kind === 'subscription'
          ? `Pay this subscription 💳 · ${monthName(month)}`
          : `Pay this bill 💸 · ${monthName(month)}`}
    </p>
    <h2 class="pr-name">{item.name}</h2>
    <p class="pr-amtline">{formatMoney(item.amount_minor)} due this month</p>

    {#if isPaid}
      <p class="pr-paidline">
        Paid {lastPay ? prettyDate(lastPay.paid_date) : ''} · {formatMoney(alreadyPaid)}
      </p>
      <div class="pr-actions">
        <button type="button" class="pr-btn ghost" onclick={onMarkUnpaid}>Mark unpaid</button>
      </div>
    {:else}
      {#if alreadyPaid > 0n}
        <p class="pr-paidline partial">
          {formatMoney(alreadyPaid)} paid so far · {formatMoney(remainingInMonth(item, month))} left
        </p>
      {/if}

      <div class="pr-field">
        <span class="pr-lbl">Paying now</span>
        <div class="pr-input focus">
          <input
            inputmode="decimal"
            bind:value={payingStr}
            aria-label="Paying now"
            onfocus={(e) => {
              (e.currentTarget as HTMLInputElement).select();
              scrollIntoView(e);
            }}
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
          <input
            class="pr-date"
            type="date"
            bind:value={paidOn}
            aria-label="Paid on"
            onfocus={scrollIntoView}
          />
        </div>
      </div>

      {#if err}<p class="pr-err">{err}</p>{/if}

      <button type="button" class="pr-btn primary" onclick={submit}>
        ✓ Mark {payingMinor !== null && payingMinor > 0n ? formatMoney(payingMinor) : ''} paid
      </button>
      <p class="pr-editnote">Need to change the amount or name? Tap the bill to edit it.</p>
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
    /* Keyboard-safe: never taller than the space above the keyboard; scroll within. */
    max-height: calc(92dvh - var(--kb-inset-bottom, 0px));
    overflow-y: auto;
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
    margin: 0.1rem 0 0.15rem;
    color: var(--color-text);
  }
  .pr-amtline {
    font-size: 0.86rem;
    color: var(--color-muted);
    font-weight: 600;
    margin-bottom: 1rem;
  }
  .pr-paidline {
    font-size: 0.95rem;
    color: var(--color-success);
    font-weight: 600;
    margin-bottom: 1rem;
  }
  .pr-paidline.partial {
    color: var(--color-accent);
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
  .pr-editnote {
    text-align: center;
    font-size: 0.74rem;
    color: var(--color-muted);
    margin-top: 0.55rem;
  }
  .pr-cancel {
    width: 100%;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.88rem;
    margin-top: 0.6rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
</style>
