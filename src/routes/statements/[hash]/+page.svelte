<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import ChecksumDiff from '$components/ChecksumDiff.svelte';
  import TransactionTable from '$components/TransactionTable.svelte';
  import { loadImports } from '$lib/app/load-store';
  import { formatMoney } from '$lib/util/money';
  import type { ImportSuccess } from '$lib/app/import';

  // Generic statement viewer.  Route: /statements/[hash]
  //
  // This page is intentionally NOT the drill-through target — that lives at
  // /payments/[bank_hash]/[txn_idx] and shows the FIFO attribution.  This
  // route is reachable from the payment-drill page ("View full statement →")
  // and (eventually) from the unified-view sidebar.

  let hash = $derived($page.params.hash ?? '');

  let imports = $state<ImportSuccess[]>([]);
  let hydrating = $state(true);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    try {
      const loaded = await loadImports();
      imports = loaded.imports;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      hydrating = false;
    }
  });

  let target = $derived(imports.find((i) => i.pdf_source_hash === hash) ?? null);

  const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    credit_card: 'Credit Card',
    loan: 'Loan',
    cash: 'Cash',
    other: 'Account'
  };
</script>

<svelte:head>
  <title>Statement · trackcents</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-8">
  <nav class="mb-4">
    <button
      type="button"
      onclick={() => goto('/')}
      class="inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      ← Back to all statements
    </button>
  </nav>

  {#if hydrating}
    <p class="text-sm text-[var(--color-muted)]">Loading…</p>
  {:else if loadError}
    <div
      class="rounded-xl border p-4"
      style="border-color: var(--color-danger); background-color: color-mix(in oklab, var(--color-danger) 12%, transparent);"
    >
      <p class="font-medium text-[var(--color-danger)]">Could not load saved statements</p>
      <p class="mt-1 text-sm text-[var(--color-text)]">{loadError}</p>
    </div>
  {:else if !target}
    <div
      class="rounded-xl border p-4"
      style="border-color: var(--color-warning); background-color: color-mix(in oklab, var(--color-warning) 12%, transparent);"
    >
      <p class="font-medium text-[var(--color-warning)]">Statement not found</p>
      <p class="mt-1 text-sm text-[var(--color-text)]">
        No imported statement with hash <span class="font-mono">{hash.slice(0, 16)}…</span>. It may
        have been removed.
      </p>
    </div>
  {:else}
    <header class="mb-4">
      <h1 class="text-2xl font-semibold text-[var(--color-text)]">
        {target.bank_name}
        {ACCOUNT_TYPE_LABELS[target.statement.account_type] ?? target.statement.account_type}
        {#if target.statement.account_last_4}
          <span class="ml-2 font-mono text-base text-[var(--color-muted)]"
            >••••{target.statement.account_last_4}</span
          >
        {/if}
      </h1>
      <p class="mt-1 font-mono text-sm text-[var(--color-muted)]">
        {target.statement.period_start} → {target.statement.period_end} · {target.transactions
          .length} transactions
      </p>
    </header>

    <ChecksumDiff result={target.checksum} />

    {#if target.statement.summary_lines.length > 0}
      <div class="mt-4">
        <h2 class="mb-2 text-sm font-medium text-[var(--color-text)]">Account Summary</h2>
        <div
          class="rounded-xl border"
          style="border-color: var(--color-border); background-color: var(--color-surface);"
        >
          <table class="w-full text-sm">
            <tbody>
              {#each target.statement.summary_lines as line, i (line.label)}
                <tr style:border-top={i > 0 ? '1px solid var(--color-border)' : 'none'}>
                  <td class="px-3 py-2 text-[var(--color-text)]">{line.label}</td>
                  <td
                    class="px-3 py-2 text-right font-mono whitespace-nowrap text-[var(--color-text)]"
                  >
                    {formatMoney(line.amount_minor, { currency: target.statement.currency })}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <div class="mt-4">
      <h2 class="mb-2 text-sm font-medium text-[var(--color-text)]">Transactions</h2>
      <TransactionTable transactions={target.transactions} currency={target.statement.currency} />
    </div>

    <p class="mt-4 text-xs text-[var(--color-muted)]">
      Parser: <span class="font-mono">{target.adapter_name} v{target.adapter_version}</span> · PDF
      hash: <span class="font-mono">{target.pdf_source_hash.slice(0, 16)}…</span>
    </p>
  {/if}
</main>
