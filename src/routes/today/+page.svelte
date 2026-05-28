<script lang="ts">
  // "Today" / Home — the entry-first home screen.  Centerpiece = a tappable
  // budget hero box wrapped in a MonthSlider, so the user can swipe (or use the
  // mid-edge chevrons / tap the month label) to view any past or planned month.
  // Top categories + recent activity follow the active month so the slider
  // really BROWSES the past, not just the box.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { loadState } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import { loadCategorization, type CategorizationState } from '$lib/db/categorization-store';
  import { summaryFromImports, detailedRowsFromImports } from '$lib/app/categorization-glue';
  import { netByMonth, spendingByCategoryByMonth } from '$lib/app/spending-summary';
  import { today } from '$lib/util/date';
  import { monthOverMonthInsight, topMovers } from '$lib/app/spending-insights';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { goalProgress, type SavingsGoal } from '$lib/app/savings-goal';
  import { loadGoals } from '$lib/db/goals-store';
  import { formatMoney } from '$lib/util/money';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import BudgetBox from '$components/BudgetBox.svelte';
  import MonthSlider from '$components/MonthSlider.svelte';
  import MonthPickerSheet from '$components/MonthPickerSheet.svelte';
  import QuickAddSheet from '$components/QuickAddSheet.svelte';

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

  const todayIso = today(); // device-local date — follows the phone's timezone
  const currentMonth = todayIso.slice(0, 7);

  // The month currently shown by the slider.  Defaults to the current calendar
  // month; the user can swipe / tap the label to navigate.
  let activeMonth = $state(currentMonth);
  let pickerOpen = $state(false);

  // ── Quick-add sheet (smart NL "type-it" entry) ────────────────────────────
  // Replaces the old inline +Income form AND the old "navigate to /transactions"
  // for +Add expense.  One sheet, both flows, with a natural-language parser at
  // the top — Hemanth's entry-first design promise.
  let quickAddOpen = $state(false);
  let quickAddType = $state<'expense' | 'income'>('expense');

  function openQuickAdd(type: 'expense' | 'income'): void {
    quickAddType = type;
    quickAddOpen = true;
  }

  async function refreshAfterSave(): Promise<void> {
    imports = (await loadState()).imports;
    cat = await loadCategorization();
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const MONTH_NAMES = [
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
  ] as const;
  function monthName(ym: string): string {
    const [y, m] = ym.split('-');
    return `${MONTH_NAMES[Number(m)] ?? m} ${y}`;
  }
  function catName(id: string | null): string {
    if (id === null) return 'Uncategorized';
    return cat.categories.find((c) => c.id === id)?.name ?? id;
  }

  const txns = $derived(summaryFromImports(imports, cat.annotations));
  const hasData = $derived(txns.length > 0);
  const nbm = $derived(netByMonth(txns));
  const sbm = $derived(spendingByCategoryByMonth(txns));

  /** Months we can show in the slider — every month with data, plus the
   *  current calendar month, plus the next month (for forward planning).
   *  Chronological, oldest → newest. */
  const monthsAvailable = $derived.by<string[]>(() => {
    const set = new Set<string>(nbm.keys());
    set.add(currentMonth);
    const [yStr, mStr] = currentMonth.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    set.add(`${nextY}-${String(nextM).padStart(2, '0')}`);
    return [...set].sort();
  });

  /** Months we have any transaction data for — drives the data-dot in the picker. */
  const monthsWithDataSet = $derived(new Set<string>(nbm.keys()));

  /** Account-name suggestions for the quick-add sheet — manual nicknames land
   *  in `bank_name` (see manual-entry.ts), so this also surfaces past manuals. */
  const accountSuggestions = $derived.by<string[]>(() => {
    const set = new Set<string>(['Cash']);
    for (const imp of imports) {
      if (imp.bank_name && imp.bank_name.trim().length > 0) set.add(imp.bank_name.trim());
    }
    return ['Cash', ...[...set].filter((a) => a !== 'Cash').sort()];
  });

  // If the user lands on an activeMonth that's no longer in the available set
  // (e.g. data reloaded and the picked month vanished), fall back to current.
  $effect(() => {
    if (!monthsAvailable.includes(activeMonth)) {
      activeMonth = currentMonth;
    }
  });

  const activeFlow = $derived(nbm.get(activeMonth));
  const activeMonthLabel = $derived(monthName(activeMonth));

  // Top categories for the ACTIVE month (so swiping back to April shows
  // April's top categories, not the current month's).
  const topCats = $derived(
    [...(sbm.get(activeMonth)?.entries() ?? [])].sort((a, b) => (b[1] > a[1] ? 1 : -1))
  );
  const topSpend = $derived(topCats[0]?.[1] ?? 1n);

  // Month-over-month delta — informational, compares the latest two months
  // in the data (independent of the slider's active month).
  const mom = $derived(monthOverMonthInsight(sbm));
  const movers = $derived(mom ? topMovers(mom.deltas, 3) : null);
  const absMinor = (m: bigint): bigint => (m < 0n ? -m : m);

  const allDetailed = $derived(detailedRowsFromImports(imports, cat.annotations));

  /**
   * "Extra income" for the ACTIVE month: every inflow transaction in this
   * month MINUS the single largest (the inferred base / recurring income).
   * 0n when there's only 1 inflow.  Drives the green "+$X extra income · tap
   * to manage" line on the BudgetBox (Hemanth's design spec: total income at
   * top, extras broken out below).  Ignored transactions are excluded.
   */
  const activeExtraIncomeMinor = $derived.by<bigint>(() => {
    const inflows: bigint[] = [];
    for (const r of allDetailed) {
      if (r.posted_date.slice(0, 7) === activeMonth && r.amount_minor > 0n && !r.ignored) {
        inflows.push(r.amount_minor);
      }
    }
    if (inflows.length < 2) return 0n;
    inflows.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    let extra = 0n;
    for (let i = 1; i < inflows.length; i++) extra += inflows[i]!;
    return extra;
  });

  // Recent rows within the active month (so the slider browses real history).
  const recent = $derived(
    allDetailed
      .filter((r) => r.posted_date.slice(0, 7) === activeMonth)
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
  {:else if !hasData}
    <!-- Even with zero data we still render the slider so a brand-new user
         can land directly on "+ Add expense" without seeing an empty banner. -->
    <MonthSlider
      months={monthsAvailable}
      currentMonth={activeMonth}
      onChange={(m) => (activeMonth = m)}
    >
      <BudgetBox
        monthKey={activeMonth}
        monthLabel={activeMonthLabel}
        flow={activeFlow}
        {todayIso}
        extraIncomeMinor={activeExtraIncomeMinor}
        onLabelClick={() => (pickerOpen = true)}
        onAddIncome={() => openQuickAdd('income')}
        onAddExpense={() => openQuickAdd('expense')}
        onManageIncome={() => goto('/transactions')}
      />
    </MonthSlider>

    <div class="card rise mt-4 p-8 text-center">
      <p class="text-sm" style:color="var(--color-muted)">
        Nothing here yet. Tap <strong>+ Add expense</strong> above to log your first transaction, or
        <a href="/" style:color="var(--color-accent)">import a statement</a>.
      </p>
    </div>
  {:else}
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

    <!-- Month slider + BudgetBox: the centerpiece. -->
    <MonthSlider
      months={monthsAvailable}
      currentMonth={activeMonth}
      onChange={(m) => (activeMonth = m)}
    >
      <BudgetBox
        monthKey={activeMonth}
        monthLabel={activeMonthLabel}
        flow={activeFlow}
        {todayIso}
        extraIncomeMinor={activeExtraIncomeMinor}
        onLabelClick={() => (pickerOpen = true)}
        onAddIncome={() => openQuickAdd('income')}
        onAddExpense={() => openQuickAdd('expense')}
        onManageIncome={() => goto('/transactions')}
      />
    </MonthSlider>

    <!-- Top categories — for the ACTIVE month. -->
    <div class="card rise mt-4 p-5" style="animation-delay: 60ms;">
      <h2 class="mb-3 text-sm font-semibold">Top categories · {activeMonthLabel}</h2>
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

    <!-- Spending vs last month (US-INSIGHT) — independent of the slider; uses
         the latest two months in the data. -->
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

    <!-- Recent activity — within the ACTIVE month. -->
    <div class="card rise mt-4 p-5" style="animation-delay: 120ms;">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Recent · {activeMonthLabel}</h2>
        <a href="/transactions" class="text-xs" style:color="var(--color-accent)">See all →</a>
      </div>
      {#if recent.length === 0}
        <p class="text-sm" style:color="var(--color-muted)">No transactions in this month.</p>
      {:else}
        <div class="divide-y">
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
      {/if}
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

  <!-- Month picker — rendered once at the page level so it overlays everything. -->
  <MonthPickerSheet
    open={pickerOpen}
    currentMonth={activeMonth}
    monthsWithData={monthsWithDataSet}
    onSelect={(m) => (activeMonth = m)}
    onClose={() => (pickerOpen = false)}
  />

  <!-- Quick-add sheet — opens from the BudgetBox's +Add expense / +Income.  One
       UI for both, with a natural-language "type-it" field at the top. -->
  <QuickAddSheet
    open={quickAddOpen}
    initialType={quickAddType}
    categories={cat.categories}
    rules={cat.rules}
    annotations={cat.annotations}
    {accountSuggestions}
    onClose={() => (quickAddOpen = false)}
    onSaved={refreshAfterSave}
  />
</main>
