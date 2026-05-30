<script lang="ts">
  // Trends (US-PW-A/B) — inspired by the cousin's "pricewatch" app, adapted to
  // bank-level data: how spend at each merchant trends over time, the biggest
  // recurring-charge price jumps, most-frequent merchants, and largest purchases.
  // Each merchant is only ever compared to ITS OWN past charges (no amount-based
  // classification, per the project rule).
  import { onMount } from 'svelte';
  import { loadState } from '$lib/db/store';
  import { loadCategorization, type CategorizationState } from '$lib/db/categorization-store';
  import { transactionCategoryKey } from '$lib/app/categorization';
  import {
    merchantTrends,
    priceJumps,
    frequentMerchants,
    largestPurchases,
    type MerchantTxn
  } from '$lib/app/merchant-trends';
  import { formatMoney } from '$lib/util/money';

  let loading = $state(true);
  let txns = $state<MerchantTxn[]>([]);
  // Fee/interest charges (the Rocket-Money "noteworthy" cut) — date + magnitude.
  let feeRows = $state<Array<{ posted_date: string; amount_minor: bigint }>>([]);
  let anchor = $state<string | null>(null); // most-recent date in the data
  let windowDays = $state<number | null>(90); // 30 / 90 / 365 / null = all

  onMount(async () => {
    const imports = (await loadState()).imports;
    const cat: CategorizationState = await loadCategorization();
    const rows: MerchantTxn[] = [];
    const fees: Array<{ posted_date: string; amount_minor: bigint }> = [];
    let maxDate: string | null = null;
    for (const imp of imports) {
      imp.transactions.forEach((t, i) => {
        const key = transactionCategoryKey(imp.pdf_source_hash, i);
        if (cat.annotations[key]?.ignored) return; // honour "exclude from spending"
        rows.push({
          posted_date: t.posted_date,
          amount_minor: t.amount_minor,
          description: t.description
        });
        if (t.transaction_type === 'fee' || t.transaction_type === 'interest') {
          const mag = t.amount_minor < 0n ? -t.amount_minor : t.amount_minor;
          fees.push({ posted_date: t.posted_date, amount_minor: mag });
        }
        if (maxDate === null || t.posted_date > maxDate) maxDate = t.posted_date;
      });
    }
    txns = rows;
    feeRows = fees;
    anchor = maxDate;
    loading = false;
  });

  // Window `since` is anchored to the most-recent transaction (statement data
  // lags "today"), so "last 90 days" means the last 90 days of actual data.
  const since = $derived.by(() => {
    if (windowDays === null || anchor === null) return undefined;
    const d = new Date(anchor + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - windowDays);
    return d.toISOString().slice(0, 10);
  });

  const opts = $derived(since === undefined ? {} : { since });
  const jumps = $derived(priceJumps(txns, opts));
  const frequent = $derived(frequentMerchants(txns, opts).slice(0, 12));
  const largest = $derived(largestPurchases(txns, { ...opts, limit: 10 }));
  const trended = $derived(merchantTrends(txns, opts));
  const hasData = $derived(txns.length > 0);

  // Fees & interest in the current window (a "noteworthy" total).
  const feesTotal = $derived(
    feeRows
      .filter((f) => since === undefined || f.posted_date >= since)
      .reduce((s, f) => s + f.amount_minor, 0n)
  );
  const feesCount = $derived(
    feeRows.filter((f) => since === undefined || f.posted_date >= since).length
  );

  const windows: Array<{ label: string; days: number | null }> = [
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1y', days: 365 },
    { label: 'All', days: null }
  ];

  function pct(n: number | null): string {
    if (n === null) return '';
    const s = n > 0 ? '+' : '';
    return `${s}${n.toFixed(1)}%`;
  }
</script>

<svelte:head><title>Trends · trackcents</title></svelte:head>

<main class="mx-auto max-w-5xl px-4 sm:px-6 py-8">
  <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold text-[var(--color-text)]">Spending trends</h1>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        How your costs change over time — biggest price jumps, frequent merchants, largest buys.
        Each merchant is compared to its own past charges.
      </p>
    </div>
    <div
      class="flex items-center gap-0.5 rounded-full border p-1"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      {#each windows as w (w.label)}
        {@const active = windowDays === w.days}
        <button
          type="button"
          class="rounded-full px-3 py-1 text-sm font-medium transition-colors"
          style:color={active ? 'var(--color-accent-fg)' : 'var(--color-muted)'}
          style:background-image={active ? 'var(--grad-primary)' : 'none'}
          onclick={() => (windowDays = w.days)}
        >
          {w.label}
        </button>
      {/each}
    </div>
  </header>

  {#if loading}
    <p class="text-sm text-[var(--color-muted)]">Loading…</p>
  {:else if !hasData}
    <div class="card p-8 text-center">
      <p class="text-sm text-[var(--color-muted)]">
        No spending yet. <a href="/" class="text-[var(--color-accent)] hover:underline"
          >Import a statement</a
        >
        or add a transaction to see trends.
      </p>
    </div>
  {:else}
    {#if feesCount > 0}
      <div
        class="card rise mb-5 flex items-center justify-between gap-3 p-4"
        style="background-image: linear-gradient(to right, color-mix(in oklab, var(--color-danger) 8%, transparent), transparent);"
      >
        <div>
          <p class="text-sm font-semibold">Fees &amp; interest</p>
          <p class="text-xs text-[var(--color-muted)]">
            {feesCount} charge{feesCount === 1 ? '' : 's'} in this window — money worth questioning.
          </p>
        </div>
        <span class="num text-xl font-bold" style:color="var(--color-danger)"
          >{formatMoney(feesTotal)}</span
        >
      </div>
    {/if}

    <div class="stagger grid gap-5 md:grid-cols-2">
      <!-- Biggest price jumps -->
      <section class="card rise p-5">
        <h2 class="mb-1 text-base font-semibold">Biggest price changes</h2>
        <p class="mb-3 text-xs text-[var(--color-muted)]">
          Recurring charges whose latest amount differs from the previous one.
        </p>
        {#if jumps.length === 0}
          <p class="text-sm text-[var(--color-muted)]">
            No recurring charge changed in this window.
          </p>
        {:else}
          <ul class="space-y-2">
            {#each jumps.slice(0, 8) as m (m.merchant_key)}
              <li class="flex items-center justify-between gap-3">
                <span class="min-w-0 flex-1 truncate text-sm">{m.display_name}</span>
                <span class="flex flex-none items-center gap-2 whitespace-nowrap">
                  <span class="num text-xs text-[var(--color-muted)]">
                    {formatMoney(m.previous_amount_minor ?? 0n)} → {formatMoney(
                      m.last_amount_minor
                    )}
                  </span>
                  <span
                    class="num rounded-full px-2 py-0.5 text-xs font-semibold"
                    style:color={m.jump_minor > 0n ? 'var(--color-danger)' : 'var(--color-accent)'}
                    style:background-color={m.jump_minor > 0n
                      ? 'color-mix(in oklab, var(--color-danger) 12%, transparent)'
                      : 'color-mix(in oklab, var(--color-accent) 14%, transparent)'}
                  >
                    {pct(m.jump_pct)}
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- Largest purchases -->
      <section class="card rise p-5">
        <h2 class="mb-1 text-base font-semibold">Largest purchases</h2>
        <p class="mb-3 text-xs text-[var(--color-muted)]">
          Your biggest single outflows this window.
        </p>
        <ul class="space-y-2">
          {#each largest as p, i (i)}
            <li class="flex items-center justify-between gap-3">
              <span class="min-w-0">
                <span class="block truncate text-sm">{p.description}</span>
                <span class="text-xs text-[var(--color-muted)]">{p.posted_date}</span>
              </span>
              <span class="num whitespace-nowrap text-sm font-semibold"
                >{formatMoney(p.amount_minor)}</span
              >
            </li>
          {/each}
        </ul>
      </section>

      <!-- Frequent merchants -->
      <section class="card rise p-5 md:col-span-2">
        <h2 class="mb-3 text-base font-semibold">Most-frequent merchants</h2>
        <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {#each frequent as m (m.merchant_key)}
            <div
              class="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-1.5"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm">{m.display_name}</span>
                <span class="text-xs text-[var(--color-muted)]">
                  {m.occurrences}× · avg {formatMoney(m.average_amount_minor)}
                </span>
              </span>
              <span class="num whitespace-nowrap text-sm font-semibold"
                >{formatMoney(m.total_spent_minor)}</span
              >
            </div>
          {/each}
        </div>
      </section>
    </div>

    <p class="mt-4 text-center text-xs text-[var(--color-muted)]">
      Tracking {trended.length} recurring merchants over {windowDays === null
        ? 'all time'
        : `the last ${windowDays} days`}.
    </p>
  {/if}
</main>
