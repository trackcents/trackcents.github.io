<script lang="ts">
  // "Today" home screen (Rocket-Money cue): this month's spend-vs-income at a
  // glance — a progress ring, top categories with colour + icon, and recent
  // transactions. Combines the new visual primitives (rings, icons, colours).
  import { onMount } from 'svelte';
  import { loadState, addImport } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import { loadCategorization, type CategorizationState } from '$lib/db/categorization-store';
  import { summaryFromImports, detailedRowsFromImports } from '$lib/app/categorization-glue';
  import { netByMonth, spendingByCategoryByMonth, sortedMonths } from '$lib/app/spending-summary';
  import { monthOverMonthInsight, topMovers } from '$lib/app/spending-insights';
  import { monthBudget } from '$lib/app/month-budget';
  import { makeManualImport, newManualId, ManualEntryError } from '$lib/app/manual-entry';
  import { parseAmountToCents, CsvImportError } from '$lib/app/csv-import';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { goalProgress, type SavingsGoal } from '$lib/app/savings-goal';
  import { loadGoals } from '$lib/db/goals-store';
  import { formatMoney, getDisplayCurrency } from '$lib/util/money';
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

  const todayIso = new Date().toISOString().slice(0, 10);

  // Quick "add income" from the budget hero — logs a manual income entry dated
  // today, so a manual-first user can record salary/bonus and see their budget.
  let showIncome = $state(false);
  let incomeAmount = $state('');
  let incomeLabel = $state('');
  let incomeError = $state<string | null>(null);

  async function submitIncome(): Promise<void> {
    incomeError = null;
    try {
      const mag = parseAmountToCents(incomeAmount, 1);
      const abs = mag < 0n ? -mag : mag;
      if (abs === 0n) {
        incomeError = 'Enter an amount.';
        return;
      }
      const rec = makeManualImport(
        {
          posted_date: todayIso,
          description: incomeLabel.trim() || 'Income',
          amount_minor: abs,
          account_nickname: 'Income',
          currency: getDisplayCurrency()
        },
        newManualId(),
        new Date().toISOString()
      );
      await addImport(rec);
      imports = (await loadState()).imports;
      showIncome = false;
      incomeAmount = '';
      incomeLabel = '';
    } catch (e) {
      incomeError =
        e instanceof ManualEntryError || e instanceof CsvImportError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
    }
  }

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
  const budget = $derived(monthBudget(flow, month ?? todayIso.slice(0, 7), todayIso));

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

    <!-- This month — spent vs income, what's left, and a safe daily spend. -->
    <section class="card rise p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm" style:color="var(--color-muted)">Spent this month</p>
          <p class="num mt-1 text-4xl font-semibold tracking-tight">
            {formatMoney(budget.spent_minor)}
          </p>
          {#if budget.income_minor > 0n}
            <p class="mt-1 text-sm" style:color="var(--color-muted)">
              of {formatMoney(budget.income_minor)} income
            </p>
          {/if}
        </div>
        <div class="flex flex-none flex-col items-end gap-2">
          {#if budget.income_minor > 0n}
            <span
              class="num rounded-full px-2.5 py-0.5 text-sm font-semibold"
              style:color={budget.over_pace ? 'var(--color-danger)' : 'var(--color-success)'}
              style:background-color={budget.over_pace
                ? 'color-mix(in oklab, var(--color-danger) 12%, transparent)'
                : 'color-mix(in oklab, var(--color-success) 14%, transparent)'}
            >
              {budget.pct_spent}%
            </span>
          {/if}
          <button
            type="button"
            class="btn btn-ghost"
            style="padding: 0.4rem 0.8rem; font-size: 0.8rem;"
            onclick={() => {
              showIncome = !showIncome;
              incomeError = null;
            }}
          >
            + Income
          </button>
        </div>
      </div>

      {#if budget.income_minor > 0n}
        <div
          class="mt-4 h-2 overflow-hidden rounded-full"
          style="background-color: var(--color-elevated);"
        >
          <div
            class="h-full rounded-full"
            style:width="{Math.min(100, budget.pct_spent)}%"
            style:background-color={budget.remaining_minor < 0n
              ? 'var(--color-danger)'
              : 'transparent'}
            style:background-image={budget.remaining_minor < 0n ? 'none' : 'var(--grad-primary)'}
          ></div>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p
              class="num text-base font-semibold"
              style:color={budget.remaining_minor < 0n
                ? 'var(--color-danger)'
                : 'var(--color-text)'}
            >
              {formatMoney(budget.remaining_minor)}
            </p>
            <p class="text-xs" style:color="var(--color-muted)">Remaining</p>
          </div>
          <div>
            <p class="num text-base font-semibold">{formatMoney(budget.daily_pace_minor)}</p>
            <p class="text-xs" style:color="var(--color-muted)">Safe / day</p>
          </div>
          <div>
            <p class="num text-base font-semibold">{budget.days_left}</p>
            <p class="text-xs" style:color="var(--color-muted)">Days left</p>
          </div>
        </div>
        {#if budget.over_pace}
          <p class="mt-3 text-xs" style:color="var(--color-danger)">
            You're spending faster than your income for the month — ease off to stay on track.
          </p>
        {/if}
      {:else}
        <p class="mt-3 text-sm" style:color="var(--color-muted)">
          Add the income you got this month to see what's left, your safe daily spend, and your
          pace.
        </p>
      {/if}

      {#if showIncome}
        <div class="mt-4 border-t pt-4" style="border-color: var(--color-border);">
          <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label class="block text-sm">
              <span class="mb-1 block text-xs" style:color="var(--color-muted)">Amount</span>
              <input
                type="text"
                inputmode="decimal"
                bind:value={incomeAmount}
                placeholder="50000"
                class="num w-full rounded-lg border px-3 py-2"
                style="border-color: var(--color-border); background-color: var(--color-bg);"
              />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block text-xs" style:color="var(--color-muted)">
                Source (optional)
              </span>
              <input
                type="text"
                bind:value={incomeLabel}
                placeholder="Salary"
                class="w-full rounded-lg border px-3 py-2"
                style="border-color: var(--color-border); background-color: var(--color-bg);"
              />
            </label>
            <div class="flex items-end">
              <button type="button" class="btn btn-primary w-full sm:w-auto" onclick={submitIncome}>
                Add
              </button>
            </div>
          </div>
          {#if incomeError}
            <p class="mt-2 text-xs" style:color="var(--color-danger)">{incomeError}</p>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Top categories -->
    <div class="card rise mt-4 p-5" style="animation-delay: 60ms;">
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
                  <span class="num text-sm" style:color="var(--color-text)">{formatMoney(amt)}</span
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
