<script lang="ts">
  import ChecksumDiff from './ChecksumDiff.svelte';
  import TransactionTable from './TransactionTable.svelte';
  import { formatMoney } from '$lib/util/money';
  import type { ImportSuccess } from '$lib/app/import';
  import type { ReconciliationLink } from '$lib/app/reconciliation';
  import { findLinkForBankTxn } from '$lib/app/reconciliation';

  interface Props {
    import_: ImportSuccess;
    /** This card's position in the parent's imports[] array — used by the
     *  reconciliation lookup so badges can be rendered on bank-side rows. */
    importIndex: number;
    /** All reconciliation links across all imports.  Filtered per-row inside. */
    links: ReconciliationLink[];
    /** Called when the user clicks a "→ View matching CC" badge.  Parent
     *  scrolls to / highlights the matched CC statement. */
    onLinkClick: (link: ReconciliationLink) => void;
    onRemove: () => void;
  }

  let { import_, importIndex, links, onLinkClick, onRemove }: Props = $props();

  // Returns the reconciliation link for a given transaction row index on
  // THIS statement, if one exists.  Bank-side imports use this; CC-side
  // imports never have outgoing links (they're the targets).
  function getLink(rowIdx: number): ReconciliationLink | undefined {
    return findLinkForBankTxn(links, importIndex, rowIdx);
  }
</script>

<section class="card rise p-4">
  <header class="mb-3 flex items-center justify-between gap-4">
    <div>
      <h2 class="text-lg font-medium text-[var(--color-text)]">
        {import_.bank_name}
        <span class="ml-2 font-mono text-sm text-[var(--color-muted)]"
          >•••• {import_.statement.account_last_4 ?? '—'}</span
        >
        <span
          class="ml-2 inline-block rounded-md border px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--color-muted)]"
          style="border-color: var(--color-border);"
        >
          {#if import_.statement.account_type === 'credit_card'}Credit card
          {:else if import_.statement.account_type === 'savings'}Savings
          {:else if import_.statement.account_type === 'loan'}Loan
          {:else if import_.statement.account_type === 'cash'}Cash
          {:else if import_.statement.account_type === 'checking'}Checking
          {:else}Account{/if}
        </span>
      </h2>
      <p class="mt-1 font-mono text-xs text-[var(--color-muted)]">
        {import_.statement.period_start} → {import_.statement.period_end} ·
        {import_.transactions.length} transactions
      </p>
    </div>
    <button
      type="button"
      onclick={onRemove}
      class="rounded-lg border px-3 py-1 text-xs text-[var(--color-muted)] transition-colors"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      Remove
    </button>
  </header>

  {#if import_.statement.payment_due_date || import_.statement.minimum_payment_due_minor !== null}
    <div class="mb-3 grid grid-cols-2 gap-3 text-sm">
      {#if import_.statement.payment_due_date}
        <div
          class="rounded-lg border p-2"
          style="border-color: var(--color-border); background-color: var(--color-surface);"
        >
          <p class="text-xs text-[var(--color-muted)]">Payment due</p>
          <p class="font-mono text-[var(--color-text)]">
            {import_.statement.payment_due_date}
          </p>
        </div>
      {/if}
      {#if import_.statement.minimum_payment_due_minor !== null}
        <div
          class="rounded-lg border p-2"
          style="border-color: var(--color-border); background-color: var(--color-surface);"
        >
          <p class="text-xs text-[var(--color-muted)]">Minimum payment</p>
          <p class="font-mono text-[var(--color-text)]">
            {formatMoney(import_.statement.minimum_payment_due_minor, {
              currency: import_.statement.currency
            })}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <ChecksumDiff result={import_.checksum} />

  {#if import_.statement.summary_lines.length > 0}
    <div class="mt-4">
      <h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Account Summary</h3>
      <div
        class="rounded-xl border"
        style="border-color: var(--color-border); background-color: var(--color-surface);"
      >
        <table class="w-full text-sm">
          <tbody>
            {#each import_.statement.summary_lines as line, i (line.label)}
              <tr
                class={line.label === 'New Balance' || line.label === 'Ending Balance'
                  ? 'font-semibold'
                  : ''}
                style:border-top={i > 0 ? '1px solid var(--color-border)' : 'none'}
              >
                <td class="px-3 py-2 text-[var(--color-text)]">{line.label}</td>
                <td
                  class="px-3 py-2 text-right font-mono whitespace-nowrap text-[var(--color-text)]"
                >
                  {formatMoney(line.amount_minor, { currency: import_.statement.currency })}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <div class="mt-4">
    <h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Transactions</h3>
    <TransactionTable
      transactions={import_.transactions}
      currency={import_.statement.currency}
      {getLink}
      {onLinkClick}
    />
  </div>

  <p class="mt-3 text-xs text-[var(--color-muted)]">
    Parser: <span class="font-mono">{import_.adapter_name} v{import_.adapter_version}</span>
    · PDF hash: <span class="font-mono">{import_.pdf_source_hash.slice(0, 16)}…</span>
  </p>
</section>
