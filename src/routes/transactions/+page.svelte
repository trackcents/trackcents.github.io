<script lang="ts">
  // US-P1-E: unified searchable transactions view.
  //
  // Single chronological table across every imported statement, with
  // filter / search / sort.  Pure in-memory implementation — fine for
  // current data volumes (≤ 1000 transactions).  When wa-sqlite + FTS5
  // land (task #49), the service layer in $lib/app/transaction-view.ts
  // can be re-implemented over SQL without changing this route.

  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { slide } from 'svelte/transition';
  import FilterBar from '$components/FilterBar.svelte';
  import UnifiedTransactionTable from '$components/UnifiedTransactionTable.svelte';
  import QuickAddSheet from '$components/QuickAddSheet.svelte';
  import { loadImports } from '$lib/app/load-store';
  import { detectTransfers, type TransferTxn } from '$lib/app/transfer-detector';
  import { formatMoney } from '$lib/util/money';
  import {
    toUnifiedRows,
    listAccounts,
    applyFilter,
    sortRows,
    type TransactionFilter,
    type SortSpec,
    type UnifiedRow
  } from '$lib/app/transaction-view';
  import type { ImportSuccess } from '$lib/app/import';
  import { loadCategorization, saveCategorization } from '$lib/db/categorization-store';
  import {
    setManualCategory,
    setAnnotation,
    pruneAnnotation,
    deleteCategory as deleteCategoryPure,
    renameCategory as renameCategoryPure,
    transactionCategoryKey,
    type Category,
    type CategoryRule,
    type TransactionAnnotation
  } from '$lib/app/categorization';
  import { listAllAccounts } from '$lib/app/accounts';

  let imports = $state<ImportSuccess[]>([]);
  let hydrating = $state(true);
  let loadError = $state<string | null>(null);

  // Categorization (local store) — lets the user assign a category per row.
  // rules are held so a save here doesn't clobber rules set on /categories.
  let categories = $state<Category[]>([]);
  let rules = $state<CategoryRule[]>([]);
  let annotations = $state<Record<string, TransactionAnnotation>>({});

  function rowKey(r: UnifiedRow): string {
    return transactionCategoryKey(r.pdf_source_hash, r.transaction_index);
  }
  function categoryForRow(r: UnifiedRow): string | null {
    return annotations[rowKey(r)]?.category_id ?? null;
  }
  async function assignCategory(r: UnifiedRow, categoryId: string | null): Promise<void> {
    const next = setManualCategory(new Map(Object.entries(annotations)), rowKey(r), categoryId);
    annotations = Object.fromEntries(next);
    await saveCategorization({ categories, rules, annotations });
  }

  // Transaction actions (rename / note / tags / ignore / mark-recurring) — T-R2.
  function annotationForRow(r: UnifiedRow): TransactionAnnotation | undefined {
    return annotations[rowKey(r)];
  }
  async function updateAnnotation(
    r: UnifiedRow,
    patch: Partial<TransactionAnnotation>
  ): Promise<void> {
    const next = setAnnotation(new Map(Object.entries(annotations)), rowKey(r), patch);
    // Normalize via the tested pure helper: drop cleared extras, delete the entry
    // entirely if nothing meaningful remains.
    const a = next.get(rowKey(r));
    if (a !== undefined) {
      const pruned = pruneAnnotation(a);
      if (pruned === null) next.delete(rowKey(r));
      else next.set(rowKey(r), pruned);
    }
    annotations = Object.fromEntries(next);
    await saveCategorization({ categories, rules, annotations });
  }

  // ── Manual transaction entry — uses the same QuickAddSheet as Home, so the
  // experience is consistent (chips, NL parser, AUTO badge, category at entry).
  // Both personas in round-2 review flagged the duplicate inline form here.
  let quickAddOpen = $state(false);

  // QuickAddSheet's onSaved now passes a {learned} flag; this view doesn't show
  // a toast so we ignore it, but the signature has to match the prop type.
  async function refreshAfterSave(info: { learned: boolean }): Promise<void> {
    void info;
    const loaded = await loadImports();
    imports = loaded.imports;
    const c = await loadCategorization();
    categories = c.categories;
    rules = c.rules;
    annotations = c.annotations;
  }

  // Filter + sort state.  Filter starts empty (show everything); sort
  // defaults to date-descending (most-recent first).
  let filter = $state<TransactionFilter>({});
  let sort = $state<SortSpec>({ key: 'date', dir: 'desc' });

  /** Resolve query-string filters on landing.  Supports:
   *    ?month=YYYY-MM           — whole-month filter (from the home BudgetBox)
   *    ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — explicit range
   *  Lets the Home "Spent today so far" chip and BudgetBox "tap to manage" link
   *  drop the user into a pre-filtered view (Murali's "tap-to-manage went
   *  nowhere useful" feedback).  An explicit range overrides ?month if both
   *  appear. */
  function applyMonthFromQuery(): void {
    const m = $page.url.searchParams.get('month');
    if (m !== null && /^\d{4}-\d{2}$/.test(m)) {
      const [yStr, mStr] = m.split('-');
      const y = Number(yStr);
      const mo = Number(mStr);
      // Last calendar day of the month (day 0 of next month).
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      filter = {
        ...filter,
        date_from: `${m}-01`,
        date_to: `${m}-${String(lastDay).padStart(2, '0')}`
      };
    }
    const df = $page.url.searchParams.get('date_from');
    const dt = $page.url.searchParams.get('date_to');
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const dfValid = df !== null && isoRe.test(df);
    const dtValid = dt !== null && isoRe.test(dt);
    if (dfValid || dtValid) {
      filter = {
        ...filter,
        ...(dfValid ? { date_from: df } : {}),
        ...(dtValid ? { date_to: dt } : {})
      };
    }
  }

  onMount(async () => {
    try {
      const loaded = await loadImports();
      imports = loaded.imports;
      const c = await loadCategorization();
      categories = c.categories;
      rules = c.rules;
      annotations = c.annotations;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      hydrating = false;
    }
    applyMonthFromQuery();
  });

  // Derived: flatten all imports into rows once per imports change.
  let allRows = $derived(toUnifiedRows(imports));
  let accounts = $derived(listAccounts(allRows));

  // Account list for the manual-add form — single source of truth in
  // src/lib/app/accounts.ts (Batch A).  Combines imported accounts (with
  // bank + last-4 distinguished), manually-added accounts (persisted in
  // localStorage), and "Cash" as the always-available fallback.
  const accountList = $derived<string[]>(listAllAccounts(imports));

  /** Create a new category from QuickAddSheet -> CategoryPicker.  Mirrors
   *  the implementation on the Today page.  Returns the new id so the
   *  form can select it immediately. */
  async function handleCreateCategory(name: string): Promise<string> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('category name is empty');
    const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `cat-${crypto.randomUUID()}`
        : `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    categories = [...categories, { id: newId, name: trimmed }];
    await saveCategorization({ categories, rules, annotations });
    return newId;
  }

  /** Rename a category from CategoryPicker -> CategoryRenameSheet.  The
   *  category id is stable so annotations + rules survive the rename. */
  async function handleRenameCategory(
    id: string,
    patch: { name: string; icon: string }
  ): Promise<void> {
    categories = renameCategoryPure(categories, id, patch.name, patch.icon);
    await saveCategorization({ categories, rules, annotations });
  }

  /** Delete a category from CategoryPicker edit mode (after the confirm
   *  sub-sheet).  Uses the pure deleteCategory() helper which clears the
   *  now-orphaned annotations too. */
  async function handleDeleteCategory(id: string): Promise<void> {
    const result = deleteCategoryPure(categories, new Map(Object.entries(annotations)), id);
    categories = result.categories;
    rules = rules.filter((r) => r.category_id !== id);
    annotations = Object.fromEntries(result.annotations);
    await saveCategorization({ categories, rules, annotations });
  }
  // Apply filter then sort — both are pure functions, so re-running on
  // every keystroke is fine at this dataset size.
  let filteredRows = $derived(applyFilter(allRows, filter));
  let sortedRows = $derived(sortRows(filteredRows, sort));

  // Tag filter (T-R3) — tags live on the annotation overlay, not on the row, so
  // we filter here in the route rather than in the pure transaction-view filter.
  let selectedTag = $state<string | null>(null);
  let allTags = $derived.by(() => {
    const set = new Set<string>();
    for (const a of Object.values(annotations)) for (const t of a.tags ?? []) set.add(t);
    return [...set].sort();
  });
  let visibleRows = $derived(
    selectedTag === null
      ? sortedRows
      : sortedRows.filter((r) => (annotations[rowKey(r)]?.tags ?? []).includes(selectedTag!))
  );

  // Refund-link candidates (US-P3-C): every outflow, labelled, keyed by the stable
  // annotation key so a refund can be linked to its original purchase.
  let refundCandidates = $derived(
    allRows
      .filter((r) => r.amount_minor < 0n)
      .map((r) => ({ key: rowKey(r), label: `${r.posted_date} · ${r.description}` }))
  );

  // Transfer detection (US-P3-D): pair an outflow with an equal inflow in a
  // DIFFERENT account → suggest excluding both from spending. account_id groups
  // statements of the same real account (bank + type + last4).
  let transferTxns = $derived<TransferTxn[]>(
    allRows.map((r) => ({
      key: rowKey(r),
      account_id: `${r.bank_name}|${r.account_type}|${r.account_last_4 ?? ''}`,
      posted_date: r.posted_date,
      amount_minor: r.amount_minor,
      description: r.description
    }))
  );
  // Only surface pairs where at least one leg isn't already excluded.
  let transferPairs = $derived(
    detectTransfers(transferTxns).filter(
      (p) => !(annotations[p.outflow_key]?.ignored && annotations[p.inflow_key]?.ignored)
    )
  );

  // A confirmation + Undo after excluding, so the row doesn't just silently
  // vanish (the pair drops out of `transferPairs` once both legs are ignored).
  let excludedNotice = $state<{ outKey: string; inKey: string; amount: bigint } | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  async function excludeTransfer(outKey: string, inKey: string, amount: bigint): Promise<void> {
    let next = setAnnotation(new Map(Object.entries(annotations)), outKey, { ignored: true });
    next = setAnnotation(next, inKey, { ignored: true });
    annotations = Object.fromEntries(next);
    await saveCategorization({ categories, rules, annotations });
    excludedNotice = { outKey, inKey, amount };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (excludedNotice = null), 6000);
  }

  async function undoExclude(): Promise<void> {
    if (excludedNotice === null) return;
    let next = setAnnotation(new Map(Object.entries(annotations)), excludedNotice.outKey, {
      ignored: false
    });
    next = setAnnotation(next, excludedNotice.inKey, { ignored: false });
    annotations = Object.fromEntries(next);
    await saveCategorization({ categories, rules, annotations });
    clearTimeout(noticeTimer);
    excludedNotice = null;
  }

  function clearFilter() {
    filter = {};
    selectedTag = null;
  }
</script>

<svelte:head><title>Transactions · trackcents</title></svelte:head>

<main class="mx-auto max-w-6xl px-6 py-8">
  <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold text-[var(--color-text)]">All transactions</h1>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Search and filter across every imported statement. Click a row to see provenance and source
        statement.
      </p>
    </div>
    <button type="button" class="btn btn-primary" onclick={() => (quickAddOpen = true)}>
      + Add
    </button>
  </header>

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
  {:else if allRows.length === 0}
    <div
      class="rounded-xl border p-8 text-center"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      <p class="text-sm text-[var(--color-muted)]">
        Nothing here yet. Tap <strong>+ Add</strong> above, or
        <a href="/" class="text-[var(--color-accent)] hover:underline">drop a PDF</a>
        on the import page.
      </p>
    </div>
  {:else}
    <FilterBar
      {filter}
      {accounts}
      onFilterChange={(next) => (filter = next)}
      onClear={clearFilter}
      matchedCount={visibleRows.length}
      totalCount={allRows.length}
    />

    {#if transferPairs.length > 0}
      <section class="card rise mt-3 p-4">
        <h2 class="text-sm font-semibold">Likely transfers between your accounts</h2>
        <p class="mt-0.5 mb-2 text-xs text-[var(--color-muted)]">
          These look like money moved between your own accounts, not spending. Exclude both sides so
          they don't distort your totals.
        </p>
        <ul class="space-y-1.5">
          {#each transferPairs.slice(0, 8) as p (p.outflow_key + p.inflow_key)}
            <li
              class="flex flex-wrap items-center justify-between gap-2 text-sm"
              transition:slide={{ duration: 200 }}
            >
              <span class="min-w-0">
                <span class="num font-medium">{formatMoney(p.amount_minor)}</span>
                <span class="text-[var(--color-muted)]">
                  · {p.out_account_id.split('|')[0]} → {p.in_account_id.split('|')[0]} · {p.out_date}
                  {#if p.confidence === 'high'}· labelled a transfer{/if}
                </span>
              </span>
              <button
                type="button"
                class="exclude-btn"
                onclick={() => excludeTransfer(p.outflow_key, p.inflow_key, p.amount_minor)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
                Exclude from spending
              </button>
            </li>
          {/each}
        </ul>

        {#if excludedNotice}
          <div
            class="mt-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs"
            style="background-color: var(--color-success-soft); color: var(--color-success);"
            transition:slide={{ duration: 200 }}
          >
            <span>Excluded {formatMoney(excludedNotice.amount)} transfer from spending.</span>
            <button type="button" class="font-semibold underline" onclick={undoExclude}>Undo</button
            >
          </div>
        {/if}
      </section>
    {/if}

    {#if allTags.length > 0}
      <div class="mt-3 mb-1 flex flex-wrap items-center gap-2">
        <span class="text-xs text-[var(--color-muted)]">Tags:</span>
        {#each allTags as tag (tag)}
          {@const active = selectedTag === tag}
          <button
            type="button"
            class="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
            style:color={active ? 'var(--color-accent-fg)' : 'var(--color-muted)'}
            style:background-image={active ? 'var(--grad-primary)' : 'none'}
            style:border={active ? 'none' : '1px solid var(--color-border)'}
            onclick={() => (selectedTag = active ? null : tag)}
          >
            #{tag}
          </button>
        {/each}
        {#if selectedTag !== null}
          <button
            type="button"
            class="text-xs text-[var(--color-accent)] hover:underline"
            onclick={() => (selectedTag = null)}
          >
            clear tag
          </button>
        {/if}
      </div>
    {/if}

    <UnifiedTransactionTable
      rows={visibleRows}
      {sort}
      onSortChange={(next) => (sort = next)}
      {categories}
      categoryFor={categoryForRow}
      onAssignCategory={assignCategory}
      annotationFor={annotationForRow}
      onUpdateAnnotation={updateAnnotation}
      {refundCandidates}
    />
  {/if}

  <!-- Same smart entry experience as Home — NL "Type it" + category chips +
       AUTO badge.  Replaces the old inline form (both personas flagged it as
       a duplicate, inferior copy of the home sheet). -->
  <QuickAddSheet
    open={quickAddOpen}
    initialType="expense"
    {categories}
    {rules}
    {annotations}
    accounts={accountList}
    onClose={() => (quickAddOpen = false)}
    onSaved={refreshAfterSave}
    onCreateCategory={handleCreateCategory}
    onDeleteCategory={handleDeleteCategory}
    onRenameCategory={handleRenameCategory}
  />
</main>

<style>
  /* A clear, tappable secondary button for the transfer-exclude action — the
     faint bordered chip didn't read as clickable and gave no press feedback. */
  .exclude-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background-color: var(--color-surface);
    color: var(--color-text);
    padding: 0.35rem 0.7rem;
    font-size: 0.75rem;
    font-weight: 500;
    box-shadow: var(--shadow-sm);
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      transform 0.12s ease;
  }
  .exclude-btn:hover {
    border-color: var(--color-accent);
    background-color: var(--color-elevated);
  }
  .exclude-btn:active {
    transform: scale(0.97);
  }
</style>
