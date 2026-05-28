<script lang="ts">
  import type { ParsedTransaction, TransactionType } from '$lib/adapters/types';
  import { formatMoney } from '$lib/util/money';
  import { cleanDescription } from '$lib/util/description-clean';
  import type { ReconciliationLink } from '$lib/app/reconciliation';
  import ReconciliationLinkBadge from './ReconciliationLinkBadge.svelte';

  interface Props {
    transactions: ParsedTransaction[];
    currency?: string;
    /** Optional: returns the reconciliation link for a row index, if any.
     *  Bank-side StatementCards pass this; CC-side cards don't (CC rows are
     *  the targets, not the source, of links). */
    getLink?: (rowIndex: number) => ReconciliationLink | undefined;
    /** Optional: called when the user clicks a "→ View matching CC" badge.
     *  Parent navigates / scrolls to the matched CC statement. */
    onLinkClick?: (link: ReconciliationLink) => void;
  }
  let { transactions, currency = 'USD', getLink, onLinkClick }: Props = $props();

  // Map the technical TransactionType to a label a non-developer can read.
  // Tooltip carries the one-line explanation of what it means for your money.
  const TYPE_LABELS: Record<TransactionType, { label: string; tooltip: string }> = {
    purchase: { label: 'Purchase', tooltip: 'You spent this. Charged to the card.' },
    refund: {
      label: 'Refund',
      tooltip: 'A merchant gave money back to your card (return, cancellation, reversed hold).'
    },
    payment_to_card: {
      label: 'Card payment',
      tooltip: 'You paid down the card from your bank account. Money left your bank.'
    },
    transfer: {
      label: 'Transfer',
      tooltip: 'Money moved between your own accounts.'
    },
    fee: { label: 'Fee', tooltip: 'Bank charged you a fee (annual, late, foreign transaction…).' },
    interest: {
      label: 'Interest',
      tooltip: 'Bank charged you interest on a carried balance or cash advance.'
    },
    deposit: { label: 'Deposit', tooltip: 'Money received into the account.' },
    withdrawal: { label: 'Withdrawal', tooltip: 'Cash or ACH withdrawal from the account.' },
    other: { label: 'Other', tooltip: 'Type not yet classified.' }
  };

  function typeInfo(t: TransactionType) {
    return TYPE_LABELS[t] ?? TYPE_LABELS.other;
  }
</script>

<div class="overflow-x-auto rounded-xl border" style="border-color: var(--color-border);">
  <table class="w-full text-sm">
    <thead class="text-[var(--color-muted)]" style="background-color: var(--color-surface);">
      <tr>
        <th class="px-3 py-2 text-left font-medium">Date</th>
        <th class="px-3 py-2 text-left font-medium">Description</th>
        <th class="px-3 py-2 text-left font-medium">Type</th>
        <th class="px-3 py-2 text-right font-medium">Amount</th>
      </tr>
    </thead>
    <tbody>
      {#each transactions as txn, i (i)}
        {@const info = typeInfo(txn.transaction_type)}
        {@const link = getLink?.(i)}
        <tr style:background-color={i % 2 === 0 ? 'transparent' : 'var(--color-surface)'}>
          <td class="px-3 py-2 font-mono text-xs whitespace-nowrap text-[var(--color-text)]">
            {txn.posted_date}
          </td>
          <td class="px-3 py-2 text-[var(--color-text)] desc-cell" title={txn.description}>
            <span class="desc-text">{cleanDescription(txn.description)}</span>
            {#if link}
              <button
                type="button"
                onclick={() => onLinkClick?.(link)}
                class="ml-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap transition-colors hover:underline"
                style="border-color: var(--color-accent); color: var(--color-accent); background-color: color-mix(in oklab, var(--color-accent) 12%, transparent);"
                title="Click to drill into the matching credit-card statement"
              >
                → See what this paid for
              </button>
              <ReconciliationLinkBadge {link} />
            {:else if getLink && txn.transaction_type === 'payment_to_card'}
              <!-- We are on a bank-side statement, this row IS a card payment,
                   but the matcher found no matching CC statement.  Surface a
                   small CTA so the user knows what to do next. -->
              <span
                class="ml-2 inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-xs whitespace-nowrap text-[var(--color-muted)]"
                style:border-color="var(--color-border)"
                title="No matching credit-card statement found yet. Import the CC statement covering this payment."
              >
                ⤴ Import the matching CC statement to drill in
              </span>
            {/if}
          </td>
          <td class="px-3 py-2 text-xs text-[var(--color-muted)]" title={info.tooltip}>
            {info.label}
          </td>
          <td
            class="px-3 py-2 text-right font-mono whitespace-nowrap"
            style:color={txn.amount_minor < 0n
              ? 'var(--color-danger)'
              : txn.amount_minor > 0n
                ? 'var(--color-success)'
                : 'var(--color-muted)'}
          >
            {formatMoney(txn.amount_minor, { currency })}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if transactions.length === 0}
    <p class="p-6 text-center text-sm text-[var(--color-muted)]">No transactions parsed.</p>
  {/if}
</div>

<!--
  Legend explaining the sign convention.  For a credit-card statement:
  purchases increase what you owe (negative, red); card payments and refunds
  reduce what you owe (positive, green).  Hover any Type label for a precise
  one-line definition.
-->
<p class="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
  <span class="text-[var(--color-danger)]">Red</span> = money you spent (charges to the card).
  <span class="text-[var(--color-success)]">Green</span> = money credited back to the card — either
  <em>Card payment</em>
  (you paid from your bank) or <em>Refund</em> (a merchant returned money to your card). Hover the Type
  column for details.
</p>

<style>
  /* REQ-B1.1 — clamp the Description cell to 2 lines max with right-truncation.
     The full description survives in the title= tooltip; tap-to-expand is a
     future affordance. */
  :global(.desc-cell) {
    max-width: 240px;
  }
  :global(.desc-text) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
  }
</style>
