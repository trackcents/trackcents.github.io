<script lang="ts">
  // "Today" home screen (Rocket-Money cue): this month's spend-vs-income at a
  // glance — a progress ring, top categories with colour + icon, and recent
  // transactions. Combines the new visual primitives (rings, icons, colours).
  import { onMount } from 'svelte';
  import { loadState } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import { loadCategorization, type CategorizationState } from '$lib/db/categorization-store';
  import { summaryFromImports, detailedRowsFromImports } from '$lib/app/categorization-glue';
  import { netByMonth, spendingByCategoryByMonth, sortedMonths } from '$lib/app/spending-summary';
  import { monthOverMonthInsight, topMovers } from '$lib/app/spending-insights';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { goalProgress, type SavingsGoal } from '$lib/app/savings-goal';
  import { loadGoals } from '$lib/db/goals-store';
  import { formatMoney } from '$lib/util/money';
  import ProgressRing from '$components/ProgressRing.svelte';
  import CategoryIcon from '$components/CategoryIcon.svelte';

  let loading = $state(true);
  let imports = $state<ImportRecord[]>([]);
  let cat = $state<CategorizationState>({ categories: [], rules: [], annotations: {} });
  let goals = $state<SavingsGoal[]>([]);

  onMount(async () => {
    imports = (await loadState()).imports;
    cat = await loadCategorization();
    goals = await loadGoals();
    loading = false;
  });

  function catName(id: string | null): string {
    if (id === null) return 'Uncategorized';
    return cat.categories.find((c) => c.id === id)?.name ?? id;
  }
  const monthName = (ym: string): string => {
    const names = [
      '',
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ];
    const [y, m] = ym.split('-');
    return `${names[Number(m)] ?? m} ${y}`;
  };

  const txns = $derived(summaryFromImports(imports, cat.annotations));
  const hasData = $derived(txns.length > 0);
  const nbm = $derived(netByMonth(txns));
  const month = $derived(sortedMonths(nbm).at(-1) ?? null);
  const flow = $derived(month ? nbm.get(month) : undefined);

  // Top categories this month, sorted by spend desc.
  const topCats = $derived(
    month
      ? [...(spendingByCategoryByMonth(txns).get(month)?.entries() ?? [])].sort((a, b) =>
          b[1] > a[1] ? 1 : -1
        )
      : []
  );
  const topSpend = $derived(topCats[0]?.[1] ?? 1n);

  // Month-over-month spending insight (US-INSIGHT): where spend moved vs last
  // month. Only shows once there are ≥2 months of data.
  const mom = $derived(monthOverMonthInsight(spendingByCategoryByMonth(txns)));
  const movers = $derived(mom ? topMovers(mom.deltas, 3) : null);
  const absMinor = (m: bigint): bigint => (m < 0n ? -m : m);

  const allDetailed = $derived(detailedRowsFromImports(imports, cat.annotations));
  const recent = $derived(
    allDetailed
      .slice()
      .sort((a, b) => (a.posted_date < b.posted_date ? 1 : -1))
      .slice(0, 6)
  );

  // Needs-categorization queue (T-R4): uncategorized, non-ignored transactions.
  const needsReview = $derived(
    allDetailed.filter((r) => r.category_id === null && !r.ignored).length
  );

  const toN = (m: bigint): number => Number(m) / 100;
</script>

<svelte:head><title>Home · trackcents</title></svelte:head>

<main class="mx-auto max-w-5xl px-6 py-8">
  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else if !hasData || !month || !flow}
    <div class="card rise p-10 text-center">
      <p class="text-sm" style:color="var(--color-muted)">
        Nothing to show yet. <a href="/" style:color="var(--color-accent)">Import a statement</a> or load
        sample data to see your month at a glance.
      </p>
    </div>
  {:else}
    <h1 class="mb-1 text-2xl font-semibold">{monthName(month)}</h1>
    <p class="mb-6 text-sm" style:color="var(--color-muted)">Your month at a glance.</p>

    {#if needsReview > 0}
      <a
        href="/categories/review"
        class="card card-hover rise mb-4 flex items-center justify-between gap-3 p-4"
        style="background-image: linear-gradient(to right, color-mix(in oklab, var(--color-accent) 8%, transparent), transparent);"
      >
        <span class="text-sm">
          <strong>{needsReview}</strong> transaction{needsReview === 1 ? '' : 's'} need a category
        </span>
        <span
          class="rounded-full px-3 py-1 text-sm font-medium"
          style="background-image: var(--grad-primary); color: var(--color-accent-fg);"
        >
          Review →
        </span>
      </a>
    {/if}

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <!-- Ring: spent vs income -->
      <div class="card rise flex flex-col items-center justify-center gap-3 p-6">
        <ProgressRing
          value={toN(flow.outflow_minor)}
          max={toN(flow.inflow_minor)}
          color={flow.net_minor < 0n ? 'var(--color-danger)' : 'var(--color-accent)'}
          label={formatMoney(flow.net_minor)}
          sublabel="left this month"
        />
        <div class="text-center text-xs" style:color="var(--color-muted)">
          spent {formatMoney(flow.outflow_minor)} of {formatMoney(flow.inflow_minor)} in
        </div>
      </div>

      <!-- Top categories -->
      <div class="card rise p-5 md:col-span-2" style="animation-delay: 60ms;">
        <h2 class="mb-3 text-sm font-semibold">Top categories</h2>
        {#if topCats.length === 0}
          <p class="text-sm" style:color="var(--color-muted)">No spending this month.</p>
        {:else}
          <div class="space-y-3">
            {#each topCats.slice(0, 5) as [id, amt] (id)}
              {@const color = categoryColor(id)}
              <div class="flex items-center gap-3">
                <CategoryIcon icon={categoryIconName(catName(id))} {color} tint />
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm font-medium">{catName(id)}</span>
                    <span class="num text-sm" style:color="var(--color-text)"
                      >{formatMoney(amt)}</span
                    >
                  </div>
                  <div
                    class="mt-1 h-1.5 overflow-hidden rounded-full"
                    style="background-color: var(--color-elevated);"
                  >
                    <div
                      class="h-full rounded-full"
                      style="width: {topSpend > 0n
                        ? Number((amt * 100n) / topSpend)
                        : 0}%; background-color: {color};"
                    ></div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Spending vs last month (US-INSIGHT) -->
    {#if mom && movers && (movers.increased.length > 0 || movers.decreased.length > 0)}
      <div class="card rise mt-4 p-5" style="animation-delay: 90ms;">
        <h2 class="mb-1 text-sm font-semibold">Spending vs {monthName(mom.previous)}</h2>
        <p class="mb-3 text-xs" style:color="var(--color-muted)">Where your spending moved.</p>
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <div class="mb-2 text-xs font-medium" style:color="var(--color-danger)">
              Spending more ↑
            </div>
            {#if movers.increased.length === 0}
              <p class="text-xs" style:color="var(--color-muted)">Nothing up.</p>
            {:else}
              <div class="space-y-2">
                {#each movers.increased as d (d.category_id ?? '∅')}
                  <div class="flex items-center justify-between gap-2 text-sm">
                    <span class="truncate">{catName(d.category_id)}</span>
                    <span class="num whitespace-nowrap" style:color="var(--color-danger)">
                      +{formatMoney(absMinor(d.delta_minor))}
                      <span class="ml-1 text-xs" style:color="var(--color-muted)">
                        {d.pct_change === null ? '(new)' : `(+${Math.round(d.pct_change)}%)`}
                      </span>
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          <div>
            <div class="mb-2 text-xs font-medium" style:color="var(--color-success)">
              Spending less ↓
            </div>
            {#if movers.decreased.length === 0}
              <p class="text-xs" style:color="var(--color-muted)">Nothing down.</p>
            {:else}
              <div class="space-y-2">
                {#each movers.decreased as d (d.category_id ?? '∅')}
                  <div class="flex items-center justify-between gap-2 text-sm">
                    <span class="truncate">{catName(d.category_id)}</span>
                    <span class="num whitespace-nowrap" style:color="var(--color-success)">
                      −{formatMoney(absMinor(d.delta_minor))}
                      <span class="ml-1 text-xs" style:color="var(--color-muted)">
                        {d.pct_change === null ? '' : `(${Math.round(d.pct_change)}%)`}
                      </span>
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Recent transactions -->
    <div class="card rise mt-4 p-5" style="animation-delay: 120ms;">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Recent activity</h2>
        <a href="/transactions" class="text-xs" style:color="var(--color-accent)">See all →</a>
      </div>
      <div class="divide-y" style="--tw-divide-opacity: 1;">
        {#each recent as r (r.key)}
          {@const color = categoryColor(r.category_id)}
          <div
            class="flex items-center gap-3 py-2"
            style="border-top: 1px solid var(--color-border);"
          >
            <CategoryIcon icon={categoryIconName(catName(r.category_id))} {color} tint />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{r.description}</div>
              <div class="text-xs" style:color="var(--color-muted)">
                {r.posted_date} · {catName(r.category_id)}
              </div>
            </div>
            <span
              class="num text-sm font-medium"
              style:color={r.amount_minor < 0n ? 'var(--color-danger)' : 'var(--color-success)'}
            >
              {formatMoney(r.amount_minor)}
            </span>
          </div>
        {/each}
      </div>
    </div>

    {#if goals.length > 0}
      <!-- Savings goals at a glance (surfaced from /goals so Home ties it together) -->
      <div class="card rise mt-4 p-5" style="animation-delay: 160ms;">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Savings goals</h2>
          <a href="/goals" class="text-xs" style:color="var(--color-accent)">Manage →</a>
        </div>
        <div class="space-y-3">
          {#each goals.slice(0, 3) as g (g.id)}
            {@const p = goalProgress(g)}
            <div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="truncate text-sm font-medium">{g.name}</span>
                <span class="num text-xs" style:color="var(--color-muted)">
                  {formatMoney(g.saved_minor)} / {formatMoney(g.target_minor)}
                </span>
              </div>
              <div
                class="mt-1 h-1.5 overflow-hidden rounded-full"
                style="background-color: var(--color-elevated);"
              >
                <div
                  class="h-full rounded-full"
                  style:width="{p.pct}%"
                  style:background-color={p.complete
                    ? 'var(--color-success)'
                    : 'var(--color-accent)'}
                ></div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</main>
