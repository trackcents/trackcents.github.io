<script lang="ts">
  // Spending dashboard (US-P2-B). Rebuilt against docs/design-system.md:
  // calm cards, tabular numerals, semantic colours (green=in, red=out, blue=net),
  // a distinct-hue palette for categories (never the semantic green/red), legends
  // and grids spaced so nothing collides, and a one-line takeaway per chart
  // (data storytelling, not just plotting).
  import { onMount } from 'svelte';
  import type { EChartsCoreOption } from 'echarts';
  import { loadState } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import { loadCategorization, type CategorizationState } from '$lib/db/categorization-store';
  import {
    summaryFromImports,
    detailedRowsFromImports,
    flowIntentRowsFromImports,
    summaryByFlowIntent,
    spendableFlowByMonth
  } from '$lib/app/categorization-glue';
  import { inferAllFlowIntents } from '$lib/app/flow-intent';
  import {
    summarize,
    spendingByCategory,
    spendingByCategoryByMonth,
    sortedMonths
  } from '$lib/app/spending-summary';
  import { formatMoney } from '$lib/util/money';
  import { categoryColor } from '$lib/app/category-visuals';
  import { themeMode } from '$lib/app/theme.svelte';
  import EChart from '$components/EChart.svelte';

  // Concrete colours (ECharts renders to canvas — CSS vars don't resolve there).
  // Axis/grid flip with the theme so text stays readable in light AND dark.
  const dark = $derived(themeMode() === 'dark');
  const TEXT = $derived(dark ? '#cbd5e1' : '#475569');
  const GRID = $derived(dark ? 'rgba(255,255,255,0.09)' : 'rgba(20,30,40,0.07)');
  const GREEN = '#10b981'; // money in
  const RED = '#ef4d63'; // money out
  const BLUE = '#6366f1'; // net line — indigo, distinct from in/out
  const CAT_PALETTE = [
    '#6366f1',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#14b8a6'
  ];

  let loading = $state(true);
  let imports = $state<ImportRecord[]>([]);
  let cat = $state<CategorizationState>({ categories: [], rules: [], annotations: {} });

  onMount(async () => {
    imports = (await loadState()).imports;
    cat = await loadCategorization();
    loading = false;
  });

  function catName(id: string | null): string {
    if (id === null) return 'Uncategorized';
    return cat.categories.find((c) => c.id === id)?.name ?? id;
  }
  const toDollars = (minor: bigint): number => Number(minor) / 100;
  const money = (v: unknown): string => formatMoney(BigInt(Math.round(Number(v) * 100)));

  // Flow-intent-aware projections (REQ-B0.1) — Money In / Money Out on the
  // dashboard hero MUST be the truthful spend/income, not gross outflow that
  // double-counts CC payments + investments + transfers.
  const allTxns = $derived(summaryFromImports(imports, cat.annotations));
  const flowIntents = $derived(
    inferAllFlowIntents(flowIntentRowsFromImports(imports, cat.annotations))
  );
  const projections = $derived(summaryByFlowIntent(imports, cat.annotations, flowIntents));
  const spendTxns = $derived(projections.spend);
  const incomeTxns = $derived(projections.income);
  // Totals computed from the honest projections.
  const totals = $derived.by(() => {
    const sIn = summarize(spendTxns); // refunds appear as inflow here
    const iIn = summarize(incomeTxns); // real income only
    const outflow = sIn.outflow_minor - sIn.inflow_minor; // net spend (positive)
    const cleanOutflow = outflow < 0n ? 0n : outflow;
    return {
      inflow_minor: iIn.inflow_minor,
      outflow_minor: cleanOutflow,
      net_minor: iIn.inflow_minor - cleanOutflow
    };
  });
  const hasData = $derived(allTxns.length > 0);

  // Drill-down: clicking a pie slice lists that category's spending below.
  let drillCategory = $state<string | null>(null);
  const detailed = $derived(detailedRowsFromImports(imports, cat.annotations));
  const drillRows = $derived(
    drillCategory === null
      ? []
      : detailed.filter((r) => r.amount_minor < 0n && catName(r.category_id) === drillCategory)
  );

  // Spending-by-category uses ONLY the spend projection so CC payments + transfers
  // don't pollute the pie slices.
  const byCat = $derived(spendingByCategory(spendTxns));
  const topCat = $derived([...byCat.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))[0] ?? null);
  const nbm = $derived(spendableFlowByMonth(imports, cat.annotations));
  const months = $derived(sortedMonths(nbm));
  const monthLabel = (ym: string): string => ym;

  const axis = $derived({
    axisLine: { lineStyle: { color: GRID } },
    axisTick: { show: false },
    axisLabel: { color: TEXT },
    splitLine: { lineStyle: { color: GRID } }
  });

  const pieOption = $derived<EChartsCoreOption>({
    color: CAT_PALETTE,
    textStyle: { color: TEXT },
    tooltip: { trigger: 'item', valueFormatter: money },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: TEXT } },
    series: [
      {
        name: 'Spending by category',
        type: 'pie',
        radius: ['45%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: 'transparent', borderWidth: 2 },
        label: { show: false },
        data: [...byCat].map(([id, v]) => ({
          name: catName(id),
          value: toDollars(v),
          itemStyle: { color: categoryColor(id) }
        }))
      }
    ]
  });

  const cashFlowOption = $derived<EChartsCoreOption>({
    textStyle: { color: TEXT },
    tooltip: { trigger: 'axis', valueFormatter: money },
    legend: { top: 0, textStyle: { color: TEXT }, data: ['Money in', 'Money out', 'Net'] },
    grid: { left: 68, right: 18, top: 40, bottom: 32 },
    xAxis: { type: 'category', data: months.map(monthLabel), ...axis },
    yAxis: { type: 'value', ...axis },
    series: [
      {
        name: 'Money in',
        type: 'bar',
        itemStyle: { color: GREEN, borderRadius: [3, 3, 0, 0] },
        data: months.map((m) => toDollars(nbm.get(m)?.inflow_minor ?? 0n))
      },
      {
        name: 'Money out',
        type: 'bar',
        itemStyle: { color: RED, borderRadius: [3, 3, 0, 0] },
        data: months.map((m) => toDollars(nbm.get(m)?.outflow_minor ?? 0n))
      },
      {
        name: 'Net',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color: BLUE, width: 2 },
        itemStyle: { color: BLUE },
        data: months.map((m) => toDollars(nbm.get(m)?.net_minor ?? 0n))
      }
    ]
  });

  // Stacked spending-by-category-by-month uses spend projection only (REQ-B0.1).
  const sbcbm = $derived(spendingByCategoryByMonth(spendTxns));
  const stackedCatIds = $derived([
    ...new Set([...sbcbm.values()].flatMap((inner) => [...inner.keys()]))
  ]);
  const stackedOption = $derived<EChartsCoreOption>({
    color: CAT_PALETTE,
    textStyle: { color: TEXT },
    tooltip: { trigger: 'axis', valueFormatter: money },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: TEXT } },
    grid: { left: 68, right: 18, top: 24, bottom: 56 },
    xAxis: { type: 'category', data: months.map(monthLabel), ...axis },
    yAxis: { type: 'value', ...axis },
    series: stackedCatIds.map((id) => ({
      name: catName(id),
      type: 'bar',
      stack: 'spend',
      itemStyle: { color: categoryColor(id) },
      data: months.map((m) => toDollars(sbcbm.get(m)?.get(id) ?? 0n))
    }))
  });
</script>

<svelte:head><title>Dashboard · trackcents</title></svelte:head>

<main class="mx-auto max-w-5xl px-4 sm:px-6 py-8">
  <h1 class="mb-1 text-2xl font-semibold">Dashboard</h1>
  <p class="mb-6 text-sm" style:color="var(--color-muted)">
    Where your money went, and what's left.
  </p>

  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else if !hasData}
    <div
      class="rounded-xl border p-10 text-center"
      style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow);"
    >
      <p class="text-sm" style:color="var(--color-muted)">
        No transactions yet. Import a statement to see your spending here.
      </p>
    </div>
  {:else}
    <!-- Summary stat cards: the numbers that matter, big + tabular. -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {#each [{ label: 'Money in', value: totals.inflow_minor, tone: 'var(--color-success)' }, { label: 'Money out', value: totals.outflow_minor, tone: 'var(--color-danger)' }, { label: 'Net', value: totals.net_minor, tone: totals.net_minor < 0n ? 'var(--color-danger)' : 'var(--color-text)' }] as stat (stat.label)}
        <div
          class="rounded-xl border p-4"
          style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow);"
        >
          <div class="text-xs tracking-wide uppercase" style:color="var(--color-muted)">
            {stat.label}
          </div>
          <div class="num mt-1 text-2xl font-semibold" style:color={stat.tone}>
            {formatMoney(stat.value)}
          </div>
        </div>
      {/each}
    </div>

    <!-- Spending by category -->
    <section
      class="mb-5 rounded-xl border p-4"
      style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow);"
    >
      <h2 class="text-sm font-semibold">Spending by category</h2>
      <p class="mt-0.5 mb-2 text-xs" style:color="var(--color-muted)">
        {#if topCat}
          {formatMoney(totals.outflow_minor)} out across {byCat.size}
          {byCat.size === 1 ? 'category' : 'categories'} — most went to
          <span style:color="var(--color-text)">{catName(topCat[0])}</span>. Click a slice to drill
          in.
        {:else}
          No spending recorded.
        {/if}
      </p>
      <EChart option={pieOption} onItemClick={(name) => (drillCategory = name)} />

      {#if drillCategory !== null}
        <div
          class="mt-3 rounded-lg border p-3"
          style="border-color: var(--color-border); background-color: var(--color-elevated);"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-semibold">{drillCategory}</span>
            <button
              type="button"
              class="text-xs underline"
              style:color="var(--color-accent)"
              onclick={() => (drillCategory = null)}
            >
              clear
            </button>
          </div>
          {#if drillRows.length === 0}
            <p class="text-sm" style:color="var(--color-muted)">No spending in this category.</p>
          {:else}
            <div>
              {#each drillRows as r (r.key)}
                <div
                  class="flex items-center gap-3 border-t py-2"
                  style="border-color: var(--color-border);"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm" style:color="var(--color-text)">
                      {r.description}
                    </div>
                    <div class="mt-0.5 text-xs" style:color="var(--color-muted)">
                      {r.posted_date} · {r.bank_name}
                    </div>
                  </div>
                  <div
                    class="num shrink-0 text-right text-sm font-medium"
                    style:color="var(--color-danger)"
                  >
                    {formatMoney(r.amount_minor)}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Net cash flow per month -->
    <section
      class="mb-5 rounded-xl border p-4"
      style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow);"
    >
      <h2 class="text-sm font-semibold">Net cash flow per month</h2>
      <p class="mt-0.5 mb-2 text-xs" style:color="var(--color-muted)">
        Green is money in, red is money out; the line is what's left after each month.
      </p>
      <EChart option={cashFlowOption} />
    </section>

    <!-- Spending by category over time -->
    <section
      class="rounded-xl border p-4"
      style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow);"
    >
      <h2 class="text-sm font-semibold">Spending by category over time</h2>
      <p class="mt-0.5 mb-2 text-xs" style:color="var(--color-muted)">
        How each category's spending changes month to month.
      </p>
      <EChart option={stackedOption} height="340px" />
    </section>
  {/if}
</main>
