<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import ReconciliationLinkBadge from '$components/ReconciliationLinkBadge.svelte';
  import { loadImports } from '$lib/app/load-store';
  import { getPaymentDrill, type PaymentDrillResult } from '$lib/app/payment-drill';
  import { formatMoney } from '$lib/util/money';
  import type { ImportSuccess } from '$lib/app/import';

  // Route: /payments/[bank_hash]/[txn_idx]
  //   bank_hash → pdf_source_hash of the bank-side statement holding the
  //               payment row we are drilling into.
  //   txn_idx   → row index of that payment within the bank statement's
  //               transactions array.
  //
  // The page resolves the payment, asks the FIFO engine which purchases the
  // payment paid for, and renders them with full provenance.

  let bankHash = $derived($page.params.bank_hash ?? '');
  let txnIdx = $derived(parseInt($page.params.txn_idx ?? '-1', 10));

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

  // The bank-side statement and the specific bank-tx row the user clicked.
  let bankImport = $derived(imports.find((i) => i.pdf_source_hash === bankHash) ?? null);
  let bankImportIdx = $derived(bankImport ? imports.indexOf(bankImport) : -1);
  let bankTxn = $derived(
    bankImport !== null && txnIdx >= 0 && txnIdx < bankImport.transactions.length
      ? bankImport.transactions[txnIdx]
      : null
  );

  // Run the drill engine.  Returns null if the payment can't be linked to a
  // card (e.g. the user hasn't imported any CC statement for that issuer
  // yet) or the inputs are out of range.
  let drill = $derived.by<PaymentDrillResult | null>(() => {
    if (imports.length === 0 || bankImportIdx < 0 || txnIdx < 0) return null;
    return getPaymentDrill(imports, bankImportIdx, txnIdx);
  });

  // Group the paid-for purchases by source statement so we can render them
  // with statement-level headers (more readable than a long flat list).
  interface GroupedSection {
    import_index: number;
    bank_name: string;
    period_start: string;
    period_end: string;
    pdf_source_hash: string;
    items: Array<{
      txn_idx: number;
      covered_amount_minor: bigint;
      txn: import('$lib/adapters/types').ParsedTransaction;
    }>;
    section_total_minor: bigint;
  }
  let groupedPurchases = $derived.by<GroupedSection[]>(() => {
    if (!drill) return [];
    const map = new Map<number, GroupedSection>();
    for (const pf of drill.paid_for) {
      const imp = imports[pf.import_index];
      if (!imp) continue;
      let section = map.get(pf.import_index);
      if (!section) {
        section = {
          import_index: pf.import_index,
          bank_name: imp.bank_name,
          period_start: imp.statement.period_start,
          period_end: imp.statement.period_end,
          pdf_source_hash: imp.pdf_source_hash,
          items: [],
          section_total_minor: 0n
        };
        map.set(pf.import_index, section);
      }
      section.items.push({
        txn_idx: pf.transaction_index,
        covered_amount_minor: pf.covered_amount_minor,
        txn: pf.txn
      });
      section.section_total_minor += pf.covered_amount_minor;
    }
    // Sort sections by period_end ascending (oldest statement first — the
    // payment paid for the oldest purchases first under FIFO, so this matches
    // the FIFO reading order).
    return [...map.values()].sort((a, b) => (a.period_end < b.period_end ? -1 : 1));
  });

  function backToBank() {
    if (bankImport) {
      goto(`/?focus=${encodeURIComponent(bankImport.pdf_source_hash)}`);
    } else {
      goto('/');
    }
  }

  function viewFullStatement(pdfHash: string) {
    goto(`/statements/${encodeURIComponent(pdfHash)}`);
  }

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
  <title>Payment drill · trackcents</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 sm:px-6 py-8">
  <nav class="mb-4">
    <button
      type="button"
      onclick={backToBank}
      class="inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      ← Back to {bankImport ? bankImport.bank_name + ' statement' : 'all statements'}
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
  {:else if !bankImport || !bankTxn}
    <div
      class="rounded-xl border p-4"
      style="border-color: var(--color-warning); background-color: color-mix(in oklab, var(--color-warning) 12%, transparent);"
    >
      <p class="font-medium text-[var(--color-warning)]">Payment row not found</p>
      <p class="mt-1 text-sm text-[var(--color-text)]">
        Could not locate row {txnIdx} on statement
        <span class="font-mono">{bankHash.slice(0, 16)}…</span>. It may have been removed.
      </p>
    </div>
  {:else}
    <!-- Header: the payment we are drilling into. -->
    <header class="mb-6">
      <p class="text-xs uppercase tracking-wide text-[var(--color-muted)]">Payment drill-through</p>
      <h1 class="mt-1 text-2xl font-semibold text-[var(--color-text)]">
        Your
        <span class="font-mono text-[var(--color-accent)]"
          >{formatMoney(bankTxn.amount_minor < 0n ? -bankTxn.amount_minor : bankTxn.amount_minor, {
            currency: bankImport.statement.currency
          })}</span
        >
        payment{drill ? ` to ${drill.card_bank_name} ••••${drill.card_last_4}` : ''}
        on <span class="font-mono">{bankTxn.posted_date}</span>
      </h1>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        From {bankImport.bank_name}
        {ACCOUNT_TYPE_LABELS[bankImport.statement.account_type] ??
          bankImport.statement.account_type}
        {#if bankImport.statement.account_last_4}
          <span class="font-mono">••••{bankImport.statement.account_last_4}</span>
        {/if}
        · Bank-side description: <span class="font-mono">{bankTxn.description}</span>
        {#if drill}<ReconciliationLinkBadge link={drill.link} />{/if}
      </p>
    </header>

    {#if !drill}
      <!-- No link could be established — likely because the matching CC
           statement hasn't been imported.  Honest message + actionable CTA. -->
      <div
        class="rounded-xl border p-4"
        style="border-color: var(--color-warning); background-color: color-mix(in oklab, var(--color-warning) 12%, transparent);"
      >
        <p class="font-medium text-[var(--color-warning)]">No matching credit-card statement</p>
        <p class="mt-2 text-sm text-[var(--color-text)]">
          We couldn't match this payment to a credit-card statement in your data. Likely reasons:
        </p>
        <ul class="mt-2 list-disc pl-5 text-sm text-[var(--color-text)]">
          <li>You haven't imported the credit-card statement that received this payment.</li>
          <li>
            The card's last-4 isn't in the bank's payment descriptor (we can't tell which card).
          </li>
          <li>The amount differs from the CC-side payment row (rare — bank fee, etc.).</li>
        </ul>
        <p class="mt-3 text-sm text-[var(--color-text)]">
          Once you import the matching credit-card statement, this drill page will work
          automatically.
        </p>
      </div>
    {:else}
      <!-- The good case: we have an FIFO attribution.  Render it. -->

      <!-- Summary card: how the payment is broken down. -->
      <section
        class="mb-6 rounded-xl border p-4"
        style="border-color: var(--color-accent); background-color: color-mix(in oklab, var(--color-accent) 8%, transparent);"
      >
        <h2 class="text-sm font-medium text-[var(--color-text)]">
          How this payment was applied (FIFO — oldest unpaid first)
        </h2>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-[var(--color-muted)]">Total payment</dt>
          <dd class="text-right font-mono text-[var(--color-text)]">
            {formatMoney(drill.payment_amount_minor, { currency: 'USD' })}
          </dd>
          <dt class="text-[var(--color-muted)]">
            Paid for tracked purchases ({drill.paid_for.length})
          </dt>
          <dd class="text-right font-mono text-[var(--color-success)]">
            {formatMoney(drill.payment_amount_minor - drill.uncovered_amount_minor, {
              currency: 'USD'
            })}
          </dd>
          {#if drill.uncovered_amount_minor > 0n}
            <dt class="text-[var(--color-muted)]">Paid pre-tracking balance</dt>
            <dd class="text-right font-mono text-[var(--color-warning)]">
              {formatMoney(drill.uncovered_amount_minor, { currency: 'USD' })}
            </dd>
          {/if}
        </dl>
        {#if drill.uncovered_amount_minor > 0n}
          <p
            class="mt-3 rounded-md border-l-2 p-2 text-xs text-[var(--color-text)]"
            style="border-color: var(--color-warning); background-color: color-mix(in oklab, var(--color-warning) 8%, transparent);"
          >
            <strong>Why "pre-tracking"?</strong> This card had unpaid charges before the earliest
            statement you imported. Part of your payment paid those off — but we can't show you
            which specific purchases, because we don't have the older statement.
            {#if drill.paid_for.length === 0}
              Import the credit-card statement immediately PREVIOUS to
              <span class="font-mono"
                >{drill.stream.transactions[0]?.txn.posted_date ?? 'today'}</span
              >
              to see the actual purchases.
            {/if}
          </p>
        {/if}
      </section>

      <!-- The FIFO list itself, grouped by source statement. -->
      {#if drill.paid_for.length > 0}
        <h2 class="mb-2 text-sm font-medium text-[var(--color-text)]">
          Specific purchases this payment paid for
        </h2>
        <div class="space-y-4">
          {#each groupedPurchases as section (section.import_index)}
            <div
              class="rounded-xl border"
              style="border-color: var(--color-border); background-color: var(--color-surface);"
            >
              <header
                class="flex items-baseline justify-between gap-3 border-b px-3 py-2"
                style="border-color: var(--color-border);"
              >
                <div>
                  <p class="text-sm font-medium text-[var(--color-text)]">
                    {section.bank_name} statement
                    <span class="ml-2 font-mono text-xs text-[var(--color-muted)]">
                      {section.period_start} → {section.period_end}
                    </span>
                  </p>
                  <p class="mt-0.5 text-xs text-[var(--color-muted)]">
                    {section.items.length}
                    purchase{section.items.length === 1 ? '' : 's'} ·
                    <span class="font-mono"
                      >{formatMoney(section.section_total_minor, { currency: 'USD' })}</span
                    >
                    of this payment
                  </p>
                </div>
                <button
                  type="button"
                  onclick={() => viewFullStatement(section.pdf_source_hash)}
                  class="rounded-md border px-2 py-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                  style="border-color: var(--color-border); background-color: var(--color-bg);"
                >
                  View full statement →
                </button>
              </header>
              <table class="w-full text-sm">
                <thead class="text-xs text-[var(--color-muted)]">
                  <tr>
                    <th class="px-3 py-1.5 text-left font-medium">Date</th>
                    <th class="px-3 py-1.5 text-left font-medium">Description</th>
                    <th class="px-3 py-1.5 text-right font-medium">Covered by this payment</th>
                  </tr>
                </thead>
                <tbody>
                  {#each section.items as item, ii (ii)}
                    <tr style:border-top="1px solid var(--color-border)">
                      <td
                        class="px-3 py-1.5 font-mono text-xs whitespace-nowrap text-[var(--color-text)]"
                      >
                        {item.txn.posted_date}
                      </td>
                      <td class="px-3 py-1.5 text-[var(--color-text)]">
                        {item.txn.description}
                        {#if item.covered_amount_minor !== -item.txn.amount_minor && item.txn.amount_minor < 0n}
                          <span
                            class="ml-2 inline-block rounded-md border-dashed border px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--color-muted)]"
                            style:border-color="var(--color-border)"
                            title="This purchase was only PARTIALLY covered by this payment. The remainder is still owed (or was paid by a different payment)."
                          >
                            partial
                          </span>
                        {/if}
                      </td>
                      <td
                        class="px-3 py-1.5 text-right font-mono whitespace-nowrap text-[var(--color-success)]"
                      >
                        {formatMoney(item.covered_amount_minor, { currency: 'USD' })}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        </div>
      {/if}

      <!-- FIFO disclosure for transparency. -->
      <p class="mt-6 text-xs text-[var(--color-muted)]">
        How attribution works: payments are matched to the OLDEST unpaid purchase first
        (first-in-first-out). This matches how most people think about credit-card debt — the money
        you paid off the charges that have been sitting on your card the longest. It's a convention,
        not a bank-side fact (the bank just tracks a running balance).
      </p>
    {/if}
  {/if}
</main>
