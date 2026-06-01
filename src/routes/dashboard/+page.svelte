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
    spendDetailRowsFromImports,
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
  import {
    buildCategoryTree,
    findNode,
    levelRows,
    sumTotals,
    UNCATEGORIZED_ID,
    type CatNode
  } from '$lib/app/category-tree';
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

  // ONE spend-projected, display-carrying row set feeds BOTH the category totals
  // and the drill-down transaction panel, so a category's total and the
  // transactions it reveals always reconcile — no CC-payment / transfer /
  // investment / ignored / split drift. `spendingByCategory` sums the very rows
  // the panel lists.
  const spendDetail = $derived(spendDetailRowsFromImports(imports, cat.annotations, flowIntents));
  const byCat = $derived(spendingByCategory(spendDetail));
  const topCat = $derived([...byCat.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))[0] ?? null);

  // ── Hierarchical drill (Hemanth: click a category → its sub-categories →
  //    sub-sub → its transactions). The tree rolls each parent's total up from
  //    its descendants; we navigate it with a path of ids + a breadcrumb. ──
  const catTree = $derived(buildCategoryTree(cat.categories, byCat, catName));
  const OTHER_ID = '__other__';
  const OTHER_COLOR = '#94a3b8';
  /** Category ids from root ([] = top). OTHER_ID may appear as a single top entry. */
  let drillPath = $state<string[]>([]);
  /** When set, the transactions panel shows this category's spend (catId null =
   *  uncategorized). Identified by the row's unique `key`, never its display
   *  name (category names are free-text and can collide). */
  let txnSel = $state<{ key: string; catId: string | null; name: string } | null>(null);
  /** Customize: top-level category ids the user hid (grouped into an "Other" row). */
  let hiddenRoots = $state<Set<string>>(new Set());
  let customizeOpen = $state(false);
  const HIDDEN_KEY = 'mtrb.dash.hiddenCats';
  onMount(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      if (raw !== null) hiddenRoots = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
  });
  function toggleHidden(id: string): void {
    const next = new Set(hiddenRoots);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    hiddenRoots = next;
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  const currentId = $derived(drillPath.length > 0 ? drillPath[drillPath.length - 1]! : null);

  type Row = {
    key: string;
    name: string;
    color: string;
    totalMinor: bigint;
    drillable: boolean;
    /** for non-drillable rows: which category's transactions to show. */
    txnCatId: string | null;
  };
  function nodeToRow(n: CatNode): Row {
    const realId = n.id === UNCATEGORIZED_ID ? null : n.id;
    return {
      key: n.id,
      name: n.name,
      color: n.id === UNCATEGORIZED_ID ? OTHER_COLOR : categoryColor(realId),
      totalMinor: n.totalMinor,
      drillable: n.hasChildrenWithSpend,
      txnCatId: realId
    };
  }
  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    if (currentId === null) {
      const top = levelRows(catTree, null);
      for (const n of top.filter((n) => !hiddenRoots.has(n.id))) out.push(nodeToRow(n));
      const hidden = top.filter((n) => hiddenRoots.has(n.id));
      if (hidden.length > 0) {
        out.push({
          key: OTHER_ID,
          name: `Other · ${hidden.length} ${hidden.length === 1 ? 'category' : 'categories'}`,
          color: OTHER_COLOR,
          totalMinor: sumTotals(hidden),
          drillable: true,
          txnCatId: null
        });
      }
    } else if (currentId === OTHER_ID) {
      for (const n of levelRows(catTree, null).filter((n) => hiddenRoots.has(n.id)))
        out.push(nodeToRow(n));
    } else {
      const node = findNode(catTree, currentId);
      for (const n of levelRows(catTree, currentId)) out.push(nodeToRow(n));
      if (node !== null && node.ownMinor > 0n && node.hasChildrenWithSpend) {
        out.push({
          key: '__direct__',
          name: `Directly in ${node.name}`,
          color: node.id === UNCATEGORIZED_ID ? OTHER_COLOR : categoryColor(node.id),
          totalMinor: node.ownMinor,
          drillable: false,
          txnCatId: node.id === UNCATEGORIZED_ID ? null : node.id
        });
      }
    }
    return out.sort((a, b) => {
      // Rank by total desc, deterministic name tie-break for equal totals (a
      // never-0 comparator leaves ties in engine-defined order — two $80 siblings
      // would shuffle). Synthetic "Other"/"Directly in …" rows tie-break by name
      // too, which is fine.
      if (a.totalMinor !== b.totalMinor) return b.totalMinor > a.totalMinor ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  });
  const rowMax = $derived(rows.reduce((m, r) => (r.totalMinor > m ? r.totalMinor : m), 1n));
  const levelTotal = $derived(rows.reduce((s, r) => s + r.totalMinor, 0n));

  /** Breadcrumb (All › Food › …) from the current path. */
  const crumbs = $derived.by<Array<{ label: string; depth: number }>>(() => {
    const list = [{ label: 'All', depth: 0 }];
    drillPath.forEach((id, i) => {
      const label = id === OTHER_ID ? 'Other' : (findNode(catTree, id)?.name ?? '…');
      list.push({ label, depth: i + 1 });
    });
    return list;
  });

  function openRow(r: Row): void {
    if (r.drillable) {
      drillPath = [...drillPath, r.key];
      txnSel = null;
    } else {
      // Toggle by the unique row key, not the display name (names can collide).
      txnSel = txnSel?.key === r.key ? null : { key: r.key, catId: r.txnCatId, name: r.name };
    }
  }
  function gotoDepth(depth: number): void {
    drillPath = drillPath.slice(0, depth);
    txnSel = null;
  }

  const drillRows = $derived.by(() => {
    const sel = txnSel;
    if (sel === null) return [];
    // Same spend projection that built the totals → the listed outflows sum to
    // the row total the panel sits under (movement / ignored / split-correct).
    return spendDetail.filter((r) => r.amount_minor < 0n && r.category_id === sel.catId);
  });

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
    // confine keeps the tooltip inside the chart box so it's never cut off-screen.
    tooltip: { trigger: 'item', valueFormatter: money, confine: true },
    // Custom HTML legend below (see markup) lists every category at once, so the
    // built-in paginated legend is hidden here.
    legend: { show: false },
    series: [
      {
        name: 'Spending by category',
        type: 'pie',
        radius: ['45%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: 'transparent', borderWidth: 2 },
        label: { show: false },
        // Mirrors the current drill level (top categories, or one node's children).
        data: rows.map((r) => ({
          name: r.name,
          value: toDollars(r.totalMinor),
          itemStyle: { color: r.color }
        }))
      }
    ]
  });

  const cashFlowOption = $derived<EChartsCoreOption>({
    textStyle: { color: TEXT },
    tooltip: { trigger: 'axis', valueFormatter: money, confine: true },
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
    tooltip: { trigger: 'axis', valueFormatter: money, confine: true },
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
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">Spending by category</h2>
          <p class="mt-0.5 text-xs" style:color="var(--color-muted)">
            {#if topCat}
              {formatMoney(totals.outflow_minor)} out — tap a category to see its sub-categories.
            {:else}
              No spending recorded.
            {/if}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium"
          style="border-color: var(--color-border); color: {customizeOpen
            ? 'var(--color-accent)'
            : 'var(--color-muted)'};"
          onclick={() => (customizeOpen = !customizeOpen)}
        >
          {customizeOpen ? 'Done' : '⚙ Customize'}
        </button>
      </div>

      {#if customizeOpen}
        <!-- Customize: choose which TOP-LEVEL categories show on their own; the
             rest fold into a single "Other" row you can still drill into. -->
        <div
          class="mt-3 rounded-lg border p-3"
          style="border-color: var(--color-border); background-color: var(--color-elevated);"
        >
          <p class="mb-2 text-xs" style:color="var(--color-muted)">
            Show as its own slice, or fold into “Other”. Add categories from <a
              href="/categories"
              class="underline"
              style:color="var(--color-accent)">Manage categories</a
            >.
          </p>
          <div class="flex flex-wrap gap-1.5">
            {#each levelRows(catTree, null) as n (n.id)}
              {@const on = !hiddenRoots.has(n.id)}
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style:border-color={on
                  ? n.id === UNCATEGORIZED_ID
                    ? OTHER_COLOR
                    : categoryColor(n.id)
                  : 'var(--color-border)'}
                style:color={on ? 'var(--color-text)' : 'var(--color-muted)'}
                style:opacity={on ? '1' : '0.6'}
                onclick={() => toggleHidden(n.id)}
              >
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  style:background-color={n.id === UNCATEGORIZED_ID
                    ? OTHER_COLOR
                    : categoryColor(n.id)}
                ></span>
                {n.name}
                <span style:color="var(--color-muted)">{on ? '✓' : '＋'}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Breadcrumb: All › Food › Restaurants … tap any crumb to jump back up. -->
      {#if drillPath.length > 0}
        <nav class="mt-3 flex flex-wrap items-center gap-1 text-xs" aria-label="Category path">
          {#each crumbs as c, i (c.depth)}
            {#if i > 0}<span style:color="var(--color-muted)">›</span>{/if}
            <button
              type="button"
              class="rounded px-1.5 py-0.5 font-medium"
              style:color={i === crumbs.length - 1 ? 'var(--color-text)' : 'var(--color-accent)'}
              disabled={i === crumbs.length - 1}
              onclick={() => gotoDepth(c.depth)}
            >
              {c.label}
            </button>
          {/each}
        </nav>
      {/if}

      <EChart
        option={pieOption}
        onItemClick={(_name, i) => {
          // Resolve by series index (pie data is built from `rows` in order) —
          // robust to two categories sharing a display name.
          const r = rows[i];
          if (r) openRow(r);
        }}
      />

      <!-- Ranked rows for the CURRENT level: colour, name, share bar, amount, and
           — for parents — a › chevron to drill into sub-categories. Tap a leaf to
           list its transactions. -->
      <ul class="mt-3 space-y-0.5">
        {#each rows as r (r.key)}
          <li>
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
              style:background-color={txnSel?.key === r.key
                ? 'var(--color-elevated)'
                : 'transparent'}
              onclick={() => openRow(r)}
            >
              <span class="h-3 w-3 shrink-0 rounded-full" style:background-color={r.color}></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-1.5">
                  <span class="truncate text-sm" style:color="var(--color-text)">{r.name}</span>
                  {#if levelTotal > 0n}
                    <span class="num shrink-0 text-[11px]" style:color="var(--color-muted)"
                      >{Number((r.totalMinor * 1000n) / levelTotal) / 10}%</span
                    >
                  {/if}
                </span>
                <span
                  class="mt-1 block h-1 rounded-full"
                  style:background-color="var(--color-border)"
                >
                  <span
                    class="block h-1 rounded-full"
                    style:width="{rowMax > 0n ? Number((r.totalMinor * 100n) / rowMax) : 0}%"
                    style:background-color={r.color}
                  ></span>
                </span>
              </span>
              <span class="num shrink-0 text-sm font-medium" style:color="var(--color-text)"
                >{formatMoney(r.totalMinor)}</span
              >
              {#if r.drillable}
                <span class="shrink-0 text-sm" style:color="var(--color-muted)">›</span>
              {:else}
                <span class="w-[0.9em] shrink-0"></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      {#if txnSel !== null}
        <div
          class="mt-3 rounded-lg border p-3"
          style="border-color: var(--color-border); background-color: var(--color-elevated);"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-semibold">{txnSel.name}</span>
            <button
              type="button"
              class="text-xs underline"
              style:color="var(--color-accent)"
              onclick={() => (txnSel = null)}
            >
              close
            </button>
          </div>
          {#if drillRows.length === 0}
            <p class="text-sm" style:color="var(--color-muted)">
              No transactions in this category.
            </p>
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
