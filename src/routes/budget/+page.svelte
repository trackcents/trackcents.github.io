<script lang="ts">
  // Paycheck-to-bills budget view (US-P2-D). Detects biweekly paychecks, groups
  // each pair into an anchored "budget month", and shows income vs bank spending
  // vs what's left. The anchor (which budget month the FIRST paycheck funds) is a
  // one-time, user-adjustable setting persisted locally.
  import { onMount } from 'svelte';
  import { loadImports } from '$lib/app/load-store';
  import { loadState } from '$lib/db/store';
  import { detectPaychecks, type Paycheck } from '$lib/app/paycheck-detector';
  import { groupIntoBudgetWindows, type BudgetAnchor } from '$lib/app/budget-window';
  import { computeBudgetSummaries, type BankTxn } from '$lib/app/budget-summary';
  import { summaryFromImports } from '$lib/app/categorization-glue';
  import { sortedMonths, netByMonth } from '$lib/app/spending-summary';
  import { computeCategoryBudgets, budgetTotals } from '$lib/app/category-budget';
  import { loadCategorization, type CategorizationState } from '$lib/db/categorization-store';
  import { loadBudgets, saveBudgets, type CategoryLimits } from '$lib/db/budget-store';
  import { parseAmountToCents } from '$lib/app/csv-import';
  import { centsToDecimal } from '$lib/app/export-csv';
  import { categoryColor } from '$lib/app/category-visuals';
  import { formatMoney, getDisplayCurrency, getDisplayCurrencySymbol } from '$lib/util/money';
  const currencySymbol = getDisplayCurrencySymbol();
  // The paycheck-window UI is designed around the US biweekly cadence (two
  // paychecks fund one budget month).  Monthly-paid users (typical in India)
  // get their salary tracked on /today's hero box instead; surface that path
  // here so they don't bounce off this screen.
  const isMonthlyPayCulture = getDisplayCurrency() === 'INR';
  import type { ImportSuccess } from '$lib/app/import';
  import type { ImportRecord } from '$lib/db/store';
  import ProgressRing from '$components/ProgressRing.svelte';

  const toN = (m: bigint): number => Number(m) / 100;

  const ANCHOR_KEY = 'mtrb.budget.anchor';

  let loading = $state(true);
  let imports = $state<ImportSuccess[]>([]);
  let paychecks = $state<Paycheck[]>([]);
  let anchor = $state<BudgetAnchor | null>(null);

  function loadStoredAnchor(): BudgetAnchor | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ANCHOR_KEY);
    if (raw === null) return null;
    try {
      const a = JSON.parse(raw) as BudgetAnchor;
      if (Number.isInteger(a.year) && Number.isInteger(a.month)) return a;
    } catch {
      /* fall through */
    }
    return null;
  }

  function defaultAnchorFrom(first: Paycheck | undefined): BudgetAnchor | null {
    if (first === undefined) return null;
    const [y, m] = first.posted_date.split('-');
    return { year: Number(y), month: Number(m) };
  }

  const monthLabel = (ym: string): string => {
    const [y, m] = ym.split('-');
    const names = [
      '',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return `${names[Number(m)] ?? m} ${y}`;
  };

  // ── Per-category budgets (US-P4-A) ──
  let recordImports = $state<ImportRecord[]>([]);
  let cat = $state<CategorizationState>({ categories: [], rules: [], annotations: {} });
  let limits = $state<CategoryLimits>({});

  onMount(async () => {
    imports = (await loadImports()).imports;
    paychecks = detectPaychecks(imports).paychecks;
    anchor = loadStoredAnchor() ?? defaultAnchorFrom(paychecks[0]);
    recordImports = (await loadState()).imports;
    cat = await loadCategorization();
    limits = await loadBudgets();
    loading = false;
  });

  // The latest calendar month present in the data → budget rows for that month.
  const allSummary = $derived(summaryFromImports(recordImports, cat.annotations));
  const latestMonth = $derived(sortedMonths(netByMonth(allSummary)).at(-1) ?? null);
  const monthSummary = $derived(
    latestMonth === null ? [] : allSummary.filter((t) => t.posted_date.startsWith(latestMonth))
  );
  const budgetRows = $derived(computeCategoryBudgets(limits, monthSummary));
  const budgetTotal = $derived(budgetTotals(budgetRows));
  const catName = (id: string): string => cat.categories.find((c) => c.id === id)?.name ?? id;
  const budgetMonthLabel = $derived(latestMonth === null ? '' : monthLabel(latestMonth));

  async function setLimit(categoryId: string, raw: string): Promise<void> {
    const next: CategoryLimits = { ...limits };
    const trimmed = raw.trim();
    if (trimmed === '') {
      delete next[categoryId];
    } else {
      try {
        const cents = parseAmountToCents(trimmed, 0);
        const mag = cents < 0n ? -cents : cents;
        if (mag === 0n) delete next[categoryId];
        else next[categoryId] = mag;
      } catch {
        return; // ignore unparseable input; leave limits unchanged
      }
    }
    limits = next;
    await saveBudgets(next);
  }

  function persistAnchor(): void {
    if (anchor !== null && typeof localStorage !== 'undefined') {
      localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor));
    }
  }
  function shiftAnchor(delta: number): void {
    if (anchor === null) return;
    const zero = anchor.month - 1 + delta;
    anchor = { year: anchor.year + Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
    persistAnchor();
  }

  const bankTxns = $derived<BankTxn[]>(
    imports
      .filter(
        (imp) =>
          imp.statement.account_type === 'checking' || imp.statement.account_type === 'savings'
      )
      .flatMap((imp) =>
        imp.transactions.map((t) => ({ posted_date: t.posted_date, amount_minor: t.amount_minor }))
      )
  );

  const summaries = $derived(
    anchor === null
      ? []
      : computeBudgetSummaries(groupIntoBudgetWindows(paychecks, anchor), bankTxns)
  );
</script>

<main class="mx-auto max-w-3xl px-6 py-8">
  <h1 class="mb-1 text-2xl font-semibold">Budget</h1>
  <p class="mb-6 text-sm" style:color="var(--color-muted)">
    Two paychecks fund each budget month. Here's what's left in each.
  </p>

  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else if paychecks.length === 0}
    <div class="card rise p-10 text-center">
      {#if isMonthlyPayCulture}
        <p class="mb-2 text-sm" style:color="var(--color-muted)">
          This view groups <strong>biweekly</strong> paychecks (every 2 weeks) into a monthly
          budget. Most Indian salaries are paid <strong>monthly</strong>, so this screen isn't built
          for you — your monthly salary is already covered on
          <a href="/today" style:color="var(--color-accent)">Home</a>.
        </p>
        <p class="text-sm" style:color="var(--color-muted)">
          The <strong>Category budgets</strong> section below still works for everyone.
        </p>
      {:else}
        <p class="text-sm" style:color="var(--color-muted)">
          No recurring paychecks detected yet. Import a few months of a checking statement so we can
          spot your biweekly deposits.
        </p>
      {/if}
    </div>
  {:else if anchor !== null}
    <div class="card rise mb-4 p-3 text-sm">
      <div class="flex flex-wrap items-center gap-3">
        <span style:color="var(--color-muted)">Your first paycheck funds</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-ghost px-2 py-1"
            onclick={() => shiftAnchor(-1)}
            aria-label="Earlier month">◀</button
          >
          <strong>{monthLabel(`${anchor.year}-${String(anchor.month).padStart(2, '0')}`)}</strong>
          <button
            type="button"
            class="btn btn-ghost px-2 py-1"
            onclick={() => shiftAnchor(1)}
            aria-label="Later month">▶</button
          >
        </div>
      </div>
      <p class="mt-2 text-xs" style:color="var(--color-muted)">
        Which budget month is the earliest detected paycheck funding? Shift it if our guess is off
        (e.g. the Dec&nbsp;19 paycheck was actually for January).
      </p>
    </div>

    <div class="space-y-4">
      {#each summaries as s, i (s.window.index)}
        <div class="card rise p-5" style="animation-delay: {i * 50}ms;">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <div class="font-semibold">{monthLabel(s.window.budget_month)}</div>
              <div class="text-xs" style:color="var(--color-muted)">
                {s.window.start_date} – {s.window.end_date ?? 'now'}{#if !s.window.complete}
                  · in progress{/if}
              </div>
            </div>
            {#if !s.window.complete}
              <span
                class="chip"
                style="background-color: var(--color-accent-soft); color: var(--color-accent);"
                >current</span
              >
            {/if}
          </div>
          <div class="flex items-center gap-5">
            <ProgressRing
              value={toN(s.spending_minor)}
              max={toN(s.income_minor)}
              size={108}
              stroke={11}
              color={s.remaining_minor < 0n ? 'var(--color-danger)' : 'var(--color-accent)'}
              label={formatMoney(s.remaining_minor)}
              sublabel="left"
            />
            <div class="flex-1 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm" style:color="var(--color-muted)">Paychecks in</span>
                <span class="num text-sm font-medium" style:color="var(--color-success)"
                  >{formatMoney(s.income_minor)}</span
                >
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm" style:color="var(--color-muted)">Spent from bank</span>
                <span class="num text-sm font-medium" style:color="var(--color-danger)"
                  >{formatMoney(s.spending_minor)}</span
                >
              </div>
              <div
                class="flex items-center justify-between border-t pt-2"
                style="border-color: var(--color-border);"
              >
                <span class="text-sm font-medium">Left</span>
                <span
                  class="num text-sm font-semibold"
                  style:color={s.remaining_minor < 0n ? 'var(--color-danger)' : 'var(--color-text)'}
                >
                  {formatMoney(s.remaining_minor)}
                </span>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <p class="mt-4 text-xs" style:color="var(--color-muted)">
      "Spent" counts money that left checking/savings in the window (including credit-card
      payments), so individual card purchases aren't double-counted. Transfers to savings are
      counted as "spend" by default —
      <a href="/transactions#transfer-pairs" style:color="var(--color-accent)"
        >mark them on the transactions page</a
      > to exclude them and see a truer burn rate.
    </p>
  {/if}

  <!-- Per-category monthly budgets (US-P4-A) -->
  {#if !loading && cat.categories.length > 0}
    <section class="mt-8">
      <div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-semibold">Category budgets</h2>
        {#if budgetMonthLabel}
          <span class="text-xs" style:color="var(--color-muted)">{budgetMonthLabel}</span>
        {/if}
      </div>
      <p class="mb-4 text-sm" style:color="var(--color-muted)">
        Set a monthly limit per category. Spending toward it (refunds netted) is tracked against the
        limit. {#if budgetTotal.limit_minor > 0n}You've budgeted {formatMoney(
            budgetTotal.limit_minor
          )} and spent {formatMoney(budgetTotal.spent_minor)}.{/if}
      </p>

      <div class="stagger space-y-3">
        {#each cat.categories as c (c.id)}
          {@const row = budgetRows.find((r) => r.category_id === c.id)}
          {@const limitStr = limits[c.id] !== undefined ? centsToDecimal(limits[c.id]!) : ''}
          <div class="card rise p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  style:background-color={categoryColor(c.id)}
                ></span>
                <span class="text-sm font-medium">{catName(c.id)}</span>
                {#if row?.over}
                  <span
                    class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style="color: var(--color-danger); background-color: color-mix(in oklab, var(--color-danger) 14%, transparent);"
                    >over budget</span
                  >
                {/if}
              </div>
              <label class="flex items-center gap-1 text-sm">
                <span style:color="var(--color-muted)">{currencySymbol}</span>
                <input
                  type="text"
                  inputmode="decimal"
                  value={limitStr}
                  placeholder="limit"
                  class="num w-24 rounded-md border px-2 py-1 text-right text-sm"
                  style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
                  onchange={(e) => setLimit(c.id, e.currentTarget.value)}
                />
              </label>
            </div>
            {#if row}
              <div class="mt-3">
                <div class="mb-1 flex justify-between text-xs" style:color="var(--color-muted)">
                  <span class="num">{formatMoney(row.spent_minor)} spent</span>
                  <span class="num"
                    >{row.remaining_minor < 0n
                      ? `${formatMoney(-row.remaining_minor)} over`
                      : `${formatMoney(row.remaining_minor)} left`}</span
                  >
                </div>
                <div
                  class="h-2 overflow-hidden rounded-full"
                  style="background-color: var(--color-elevated);"
                >
                  <div
                    class="h-full rounded-full transition-all"
                    style:width="{Math.min(100, row.pct)}%"
                    style:background-color={row.over ? 'var(--color-danger)' : categoryColor(c.id)}
                  ></div>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</main>
