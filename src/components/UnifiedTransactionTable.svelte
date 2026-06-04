<script lang="ts">
  // Sortable, inline-expandable transaction list for the /transactions route.
  //
  //   - Desktop (≥768px): a sortable multi-column table.
  //   - Phone (<768px): a clean tap-to-expand card list (icon · name ·
  //     date/account · amount) — a wide table is unreadable on a phone.
  // Both layouts share the same expanded "details" panel via a snippet, and the
  // same expand state, so behaviour is identical across sizes.
  //
  // Differences from the per-statement TransactionTable.svelte:
  //   - Shows the source account on every row (bank + last_4 + type).
  //   - Header cells are click-to-sort with asc/desc toggle and arrow glyph.
  //   - Click a row to expand its provenance fields (raw_text, pdf_hash,
  //     parser version) inline beneath the row.

  import { goto } from '$app/navigation';
  import type { TransactionType } from '$lib/adapters/types';
  import { formatMoney, getDisplayCurrencySymbol } from '$lib/util/money';
  const currencySymbol = getDisplayCurrencySymbol();
  import type { UnifiedRow, SortSpec, SortKey } from '$lib/app/transaction-view';
  import { groupRowsByDay, formatDayHeading, type DayGroup } from '$lib/app/transaction-view';
  import type { Category, TransactionAnnotation, TransactionSplit } from '$lib/app/categorization';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { parseAmountToCents } from '$lib/app/csv-import';
  import { centsToDecimal } from '$lib/app/export-csv';
  import CategoryIcon from './CategoryIcon.svelte';

  interface Props {
    rows: UnifiedRow[];
    sort: SortSpec;
    onSortChange: (next: SortSpec) => void;
    // Optional categorization column — rendered only when onAssignCategory is wired.
    categories?: Category[];
    categoryFor?: (r: UnifiedRow) => string | null;
    onAssignCategory?: (r: UnifiedRow, categoryId: string | null) => void;
    // Optional transaction-actions (rename/note/tags/ignore/recurring) — rendered
    // in the expanded row only when onUpdateAnnotation is wired (US-P3-E + T-R2).
    annotationFor?: (r: UnifiedRow) => TransactionAnnotation | undefined;
    onUpdateAnnotation?: (r: UnifiedRow, patch: Partial<TransactionAnnotation>) => void;
    // Delete a row (only offered for manually-added transactions; statement rows
    // use "Exclude from spending" instead). When wired, a Delete action appears.
    onDelete?: (r: UnifiedRow) => void;
    // Candidate original purchases (outflows) a refund can be linked to (US-P3-C).
    // key = the stable annotation key (`<pdf_source_hash>#<txIndex>`).
    refundCandidates?: Array<{ key: string; label: string }>;
  }
  let {
    rows,
    sort,
    onSortChange,
    categories = [],
    categoryFor,
    onAssignCategory,
    annotationFor,
    onUpdateAnnotation,
    onDelete,
    refundCandidates = []
  }: Props = $props();

  const showCategory = $derived(onAssignCategory !== undefined);
  const showActions = $derived(onUpdateAnnotation !== undefined);

  /** Only manually-added transactions can be deleted as a unit (a statement row
   *  belongs to a multi-row import). Two-tap confirm to avoid an accidental tap. */
  function canDelete(r: UnifiedRow): boolean {
    return onDelete !== undefined && r.adapter_name === 'manual';
  }
  let pendingDeleteKey = $state<string | null>(null);
  function rowDeleteKey(r: UnifiedRow): string {
    return `${r.pdf_source_hash}#${r.transaction_index}`;
  }
  function onDeleteClick(r: UnifiedRow): void {
    const k = rowDeleteKey(r);
    if (pendingDeleteKey === k) {
      pendingDeleteKey = null;
      onDelete?.(r);
    } else {
      pendingDeleteKey = k;
    }
  }

  /** True for a manual quick-add left UNNAMED — its description defaults to the
   *  word "Expense"/"Income" (optionally time-prefixed, e.g. "12:30 PM · Expense"). */
  function isPlaceholderDesc(desc: string): boolean {
    const tail = desc.includes('·') ? desc.slice(desc.lastIndexOf('·') + 1) : desc;
    return /^(expense|income)$/i.test(tail.trim());
  }

  function displayName(r: UnifiedRow): string {
    const cn = annotationFor?.(r)?.custom_name;
    if (cn !== undefined && cn !== '') return cn;
    // An unnamed manual entry shows the generic word "Expense"/"Income". If the
    // user DID pick a (sub-)category, show THAT as the row's name instead — the
    // sub-category is the title, its parent category the subtitle (Bug fix: the
    // user wanted the sub-category name to appear, not the word "Expense").
    if (isPlaceholderDesc(r.description)) {
      const leaf = currentCatName(r);
      if (leaf !== 'Uncategorized') return leaf;
    }
    return r.description;
  }
  function isIgnored(r: UnifiedRow): boolean {
    return annotationFor?.(r)?.ignored === true;
  }
  function isRecurring(r: UnifiedRow): boolean {
    return annotationFor?.(r)?.is_recurring === true;
  }
  function tagsOf(r: UnifiedRow): string[] {
    return annotationFor?.(r)?.tags ?? [];
  }
  function tagsStr(r: UnifiedRow): string {
    return tagsOf(r).join(', ');
  }
  function commitTags(r: UnifiedRow, raw: string): void {
    const tags = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    onUpdateAnnotation?.(r, { tags });
  }

  // ── Split editor (US-SPLIT) ──
  function splitOf(r: UnifiedRow): TransactionSplit[] {
    return annotationFor?.(r)?.split ?? [];
  }
  /** Parts are stored with the SAME sign as the transaction; show magnitudes. */
  function splitSign(r: UnifiedRow): bigint {
    return r.amount_minor < 0n ? -1n : 1n;
  }
  function splitSumMinor(r: UnifiedRow): bigint {
    return splitOf(r).reduce((s, p) => s + p.amount_minor, 0n);
  }
  function splitRemainderMinor(r: UnifiedRow): bigint {
    return r.amount_minor - splitSumMinor(r);
  }
  function commitSplit(r: UnifiedRow, parts: TransactionSplit[]): void {
    onUpdateAnnotation?.(r, { split: parts });
  }
  function addSplitPart(r: UnifiedRow): void {
    // New part defaults to the remaining amount in the txn category.
    const rem = splitRemainderMinor(r);
    commitSplit(r, [...splitOf(r), { category_id: null, amount_minor: rem }]);
  }
  function removeSplitPart(r: UnifiedRow, idx: number): void {
    commitSplit(
      r,
      splitOf(r).filter((_, i) => i !== idx)
    );
  }
  function setSplitCategory(r: UnifiedRow, idx: number, categoryId: string | null): void {
    commitSplit(
      r,
      splitOf(r).map((p, i) => (i === idx ? { ...p, category_id: categoryId } : p))
    );
  }
  function setSplitAmount(r: UnifiedRow, idx: number, raw: string): void {
    let mag: bigint;
    try {
      const c = parseAmountToCents(raw, 0);
      mag = c < 0n ? -c : c;
    } catch {
      return; // ignore unparseable
    }
    const signed = splitSign(r) * mag;
    commitSplit(
      r,
      splitOf(r).map((p, i) => (i === idx ? { ...p, amount_minor: signed } : p))
    );
  }
  function splitAmountStr(p: TransactionSplit): string {
    const m = p.amount_minor < 0n ? -p.amount_minor : p.amount_minor;
    return centsToDecimal(m);
  }
  const colSpan = $derived(showCategory ? 6 : 5);

  function currentCatName(r: UnifiedRow): string {
    const id = categoryFor?.(r) ?? null;
    if (id === null) return 'Uncategorized';
    return categories.find((c) => c.id === id)?.name ?? id;
  }

  /** The subtitle under a row's name — shows BOTH the category and sub-category
   *  (Hemanth: "in small names the category and sub category also has to be
   *  visible"). For a normal/named row that's the full "Category › Sub-category"
   *  path. For an UNNAMED manual entry the name already shows the sub-category, so
   *  the subtitle is just the parent category (together they read Category / Sub).
   *  '' = nothing to show (top-level category on an unnamed manual row). */
  function secondaryCatLabel(r: UnifiedRow): string {
    const id = categoryFor?.(r) ?? null;
    if (id === null) return 'Uncategorized';
    const leaf = categories.find((c) => c.id === id);
    if (leaf === undefined) return id;
    const parent =
      leaf.parent_id !== undefined && leaf.parent_id !== ''
        ? categories.find((c) => c.id === leaf.parent_id)
        : undefined;
    const nameShowsSub =
      (annotationFor?.(r)?.custom_name ?? '') === '' && isPlaceholderDesc(r.description);
    if (nameShowsSub) return parent?.name ?? '';
    return parent !== undefined ? `${parent.name} › ${leaf.name}` : leaf.name;
  }

  function amountColor(r: UnifiedRow): string {
    return r.amount_minor < 0n
      ? 'var(--color-danger)'
      : r.amount_minor > 0n
        ? 'var(--color-success)'
        : 'var(--color-muted)';
  }

  const TYPE_LABELS: Record<TransactionType, string> = {
    purchase: 'Purchase',
    refund: 'Refund',
    payment_to_card: 'Card payment',
    transfer: 'Transfer',
    fee: 'Fee',
    interest: 'Interest',
    deposit: 'Deposit',
    withdrawal: 'Withdrawal',
    other: 'Other'
  };

  const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    credit_card: 'Credit Card',
    loan: 'Loan',
    cash: 'Cash',
    other: 'Account'
  };

  // Track which row keys are expanded.  Using a Set of unique (import_idx ::
  // txn_idx) so toggling one row doesn't disturb others.
  let expanded = $state(new Set<string>());

  function rowKey(r: UnifiedRow): string {
    return `${r.import_index}::${r.transaction_index}`;
  }
  function isExpanded(r: UnifiedRow): boolean {
    return expanded.has(rowKey(r));
  }
  function toggleExpanded(r: UnifiedRow) {
    const k = rowKey(r);
    if (expanded.has(k)) expanded.delete(k);
    else expanded.add(k);
    expanded = new Set(expanded); // trigger reactivity
  }

  // ── Day-grouped ledger (mobile) ──
  // The viewer's LOCAL calendar date, for "Today" / "Yesterday" headings.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  // Group into days; headers only make sense when the list is in date order
  // (mobile has no sort control, so it always is — this just guards the desktop
  // user who sorts by amount then narrows the window to the card layout).
  const dayGroups = $derived(groupRowsByDay(rows));
  const showDayHeaders = $derived(sort.key === 'date');
  // The account chip per row is noise when there's only one account.
  const multiAccount = $derived(
    new Set(rows.map((r) => `${r.bank_name}|${r.account_last_4 ?? ''}`)).size > 1
  );
  /** A day's net across its NON-ignored rows (ignored = excluded from spending). */
  function dayNetMinor(g: DayGroup): bigint {
    let s = 0n;
    for (const r of g.rows) if (!isIgnored(r)) s += r.amount_minor;
    return s;
  }
  function accountChip(r: UnifiedRow): string {
    const t = ACCOUNT_TYPE_LABELS[r.account_type] ?? r.account_type;
    return r.account_last_4 ? `${r.bank_name} ${t} ••••${r.account_last_4}` : `${r.bank_name} ${t}`;
  }

  function onHeaderClick(key: SortKey) {
    if (sort.key === key) {
      // Toggle direction
      onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      // Switch column — default to desc for date/amount (most-recent / largest
      // first), asc for the others (alphabetical readability).
      const defaultDir = key === 'date' || key === 'amount' ? 'desc' : 'asc';
      onSortChange({ key, dir: defaultDir });
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? ' ↑' : ' ↓';
  }
</script>

<!-- Shared category picker (used in the desktop column and the mobile card). -->
{#snippet categoryPicker(r: UnifiedRow)}
  <div class="flex items-center gap-2">
    <CategoryIcon
      icon={categoryIconName(categoryFor?.(r) ? currentCatName(r) : displayName(r))}
      color={categoryColor(categoryFor?.(r) ?? null)}
      size={15}
    />
    <select
      class="min-w-0 flex-1 rounded-md border px-1.5 py-1 text-xs"
      style="border-color: var(--color-border); background-color: var(--color-surface); color: var(--color-text);"
      value={categoryFor?.(r) ?? ''}
      onchange={(e) => onAssignCategory?.(r, e.currentTarget.value || null)}
      aria-label="Category"
    >
      <option value="">Uncategorized</option>
      {#each categories as c (c.id)}
        <option value={c.id}>{c.name}</option>
      {/each}
    </select>
  </div>
{/snippet}

<!-- Shared expanded detail panel: everyday actions first, then a collapsed
     "Source & details" provenance block, then the source-statement link. -->
{#snippet details(r: UnifiedRow)}
  {#if showActions}
    <div class="mt-3 border-t pt-3" style="border-color: var(--color-border);">
      <p class="mb-2 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        Actions
      </p>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-[var(--color-muted)]">Rename (display name)</span>
          <input
            type="text"
            value={annotationFor?.(r)?.custom_name ?? ''}
            placeholder={r.description}
            class="w-full rounded-md border px-2 py-1 text-xs"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            onchange={(e) => onUpdateAnnotation?.(r, { custom_name: e.currentTarget.value })}
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[var(--color-muted)]">Tags (comma-separated)</span>
          <input
            type="text"
            value={tagsStr(r)}
            placeholder="e.g. work, reimbursable"
            class="w-full rounded-md border px-2 py-1 text-xs"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            onchange={(e) => commitTags(r, e.currentTarget.value)}
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="mb-1 block text-[var(--color-muted)]">Note</span>
          <input
            type="text"
            value={annotationFor?.(r)?.note ?? ''}
            placeholder="Add a note…"
            class="w-full rounded-md border px-2 py-1 text-xs"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            onchange={(e) => onUpdateAnnotation?.(r, { note: e.currentTarget.value })}
          />
        </label>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-4">
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isIgnored(r)}
            onchange={(e) => onUpdateAnnotation?.(r, { ignored: e.currentTarget.checked })}
          />
          <span>Exclude from spending</span>
        </label>
        <!-- The old per-row "Mark as recurring" toggle was removed: it only painted
             a ↻ icon and did NOT connect to the Recurring tab, which confused
             Hemanth. Recurring bills live on the Recurring tab. -->
        {#if canDelete(r)}
          <button
            type="button"
            class="ml-auto rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
            style:border-color={pendingDeleteKey === rowDeleteKey(r)
              ? 'var(--color-danger)'
              : 'var(--color-border)'}
            style:color="var(--color-danger)"
            onclick={() => onDeleteClick(r)}
          >
            {pendingDeleteKey === rowDeleteKey(r) ? 'Tap to confirm' : 'Delete'}
          </button>
        {/if}
      </div>

      {#if r.amount_minor > 0n && refundCandidates.length > 0}
        <label class="mt-3 block">
          <span class="mb-1 block text-[var(--color-muted)]">
            Refund of (links this credit to a purchase so it nets, not double-counts)
          </span>
          <select
            class="w-full rounded-md border px-2 py-1 text-xs"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            value={annotationFor?.(r)?.refund_of ?? ''}
            onchange={(e) => onUpdateAnnotation?.(r, { refund_of: e.currentTarget.value })}
          >
            <option value="">— not a refund —</option>
            {#each refundCandidates as c (c.key)}
              <option value={c.key}>{c.label}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if categories.length > 0}
        {@const parts = splitOf(r)}
        <div class="mt-3">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[var(--color-muted)]">Split across categories</span>
            <button
              type="button"
              class="rounded-md border px-2 py-0.5 text-xs transition-colors hover:border-[var(--color-accent)]"
              style="border-color: var(--color-border); background-color: var(--color-bg);"
              onclick={() => addSplitPart(r)}
            >
              + Add split
            </button>
          </div>
          {#if parts.length > 0}
            <div class="space-y-1.5">
              {#each parts as part, idx (idx)}
                <div class="flex items-center gap-2">
                  <select
                    class="min-w-0 flex-1 rounded-md border px-1.5 py-1 text-xs"
                    style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
                    value={part.category_id ?? ''}
                    onchange={(e) => setSplitCategory(r, idx, e.currentTarget.value || null)}
                  >
                    <option value="">Uncategorized</option>
                    {#each categories as c (c.id)}
                      <option value={c.id}>{c.name}</option>
                    {/each}
                  </select>
                  <span class="text-[var(--color-muted)]">{currencySymbol}</span>
                  <input
                    type="text"
                    inputmode="decimal"
                    value={splitAmountStr(part)}
                    class="num w-20 rounded-md border px-2 py-1 text-right text-xs"
                    style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
                    onchange={(e) => setSplitAmount(r, idx, e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                    onclick={() => removeSplitPart(r, idx)}
                    aria-label="Remove split part">✕</button
                  >
                </div>
              {/each}
            </div>
            <p class="mt-1 text-[11px] text-[var(--color-muted)]">
              {#if splitRemainderMinor(r) === 0n}
                Split covers the full amount.
              {:else}
                Remainder {formatMoney(splitRemainderMinor(r))} stays in the transaction's category.
              {/if}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <details class="provenance mt-3">
    <summary
      class="cursor-pointer list-none text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase select-none"
    >
      <span class="chev">▸</span> Source &amp; details
    </summary>
    <dl class="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      <div class="flex gap-2">
        <dt class="text-[var(--color-muted)]">Bank:</dt>
        <dd class="text-[var(--color-text)]">{r.bank_name}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-[var(--color-muted)]">Account type:</dt>
        <dd class="text-[var(--color-text)]">{r.account_type}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-[var(--color-muted)]">Account ••••:</dt>
        <dd class="font-mono text-[var(--color-text)]">{r.account_last_4 ?? '—'}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-[var(--color-muted)]">Parser:</dt>
        <dd class="font-mono text-[var(--color-text)]">{r.adapter_name} v{r.adapter_version}</dd>
      </div>
      <div class="flex gap-2 sm:col-span-2">
        <dt class="text-[var(--color-muted)]">PDF hash:</dt>
        <dd class="font-mono break-all text-[var(--color-text)]">{r.pdf_source_hash}</dd>
      </div>
      <div class="flex gap-2 sm:col-span-2">
        <dt class="text-[var(--color-muted)]">Raw text:</dt>
        <dd
          class="max-h-32 overflow-y-auto font-mono text-xs break-words whitespace-pre-wrap text-[var(--color-text)]"
        >
          {r.raw_text}
        </dd>
      </div>
    </dl>
  </details>

  <div class="mt-3 flex gap-2">
    <button
      type="button"
      onclick={() => goto(`/statements/${encodeURIComponent(r.pdf_source_hash)}`)}
      class="rounded-md border px-2 py-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      style="border-color: var(--color-border); background-color: var(--color-bg);"
    >
      View source statement →
    </button>
  </div>
{/snippet}

<!-- ── Desktop: sortable table (≥1024px only — phones/tablets get the card list
     so the 6-column table never forces horizontal scroll). ── -->
<div
  class="hidden overflow-x-auto rounded-xl border lg:block"
  style="border-color: var(--color-border);"
>
  <table class="w-full text-sm">
    <thead
      class="text-xs text-[var(--color-muted)]"
      style="background-color: var(--color-surface);"
    >
      <tr>
        <th class="px-3 py-2 text-left font-medium">
          <button
            type="button"
            onclick={() => onHeaderClick('date')}
            class="-mx-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--color-text)]"
            aria-label="Sort by date">Date{sortIndicator('date')}</button
          >
        </th>
        <th class="px-3 py-2 text-left font-medium">
          <button
            type="button"
            onclick={() => onHeaderClick('description')}
            class="-mx-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--color-text)]"
            aria-label="Sort by description">Description{sortIndicator('description')}</button
          >
        </th>
        <th class="px-3 py-2 text-left font-medium">
          <button
            type="button"
            onclick={() => onHeaderClick('account')}
            class="-mx-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--color-text)]"
            aria-label="Sort by account">Account{sortIndicator('account')}</button
          >
        </th>
        {#if showCategory}
          <th class="px-3 py-2 text-left font-medium">Category</th>
        {/if}
        <th class="px-3 py-2 text-left font-medium">
          <button
            type="button"
            onclick={() => onHeaderClick('type')}
            class="-mx-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--color-text)]"
            aria-label="Sort by type">Type{sortIndicator('type')}</button
          >
        </th>
        <th class="px-3 py-2 text-right font-medium">
          <button
            type="button"
            onclick={() => onHeaderClick('amount')}
            class="-mx-1 rounded px-1 py-0.5 transition-colors hover:text-[var(--color-text)]"
            aria-label="Sort by amount">Amount{sortIndicator('amount')}</button
          >
        </th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (rowKey(r))}
        {@const expandedNow = isExpanded(r)}
        <tr
          style:background-color={expandedNow
            ? 'color-mix(in oklab, var(--color-accent) 6%, transparent)'
            : 'transparent'}
        >
          <td class="px-3 py-2 font-mono text-xs whitespace-nowrap text-[var(--color-text)]">
            {r.posted_date}
          </td>
          <td class="px-3 py-2 text-[var(--color-text)]">
            <button
              type="button"
              onclick={() => toggleExpanded(r)}
              class="text-left transition-colors hover:underline"
              class:line-through={isIgnored(r)}
              style:opacity={isIgnored(r) ? '0.5' : '1'}
              aria-expanded={expandedNow}
              title="Click to {expandedNow ? 'hide' : 'show'} details & actions"
            >
              {displayName(r)}
            </button>
            {#if isRecurring(r)}
              <span
                class="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style="color: var(--color-accent); background-color: color-mix(in oklab, var(--color-accent) 14%, transparent);"
                title="Marked recurring">↻ recurring</span
              >
            {/if}
            {#if tagsOf(r).length > 0}
              <span class="ml-1 inline-flex flex-wrap gap-1 align-middle">
                {#each tagsOf(r) as tag (tag)}
                  <span
                    class="rounded-full px-1.5 py-0.5 text-[10px]"
                    style="color: var(--color-muted); background-color: var(--color-surface); border: 1px solid var(--color-border);"
                    >#{tag}</span
                  >
                {/each}
              </span>
            {/if}
          </td>
          <td class="px-3 py-2 text-xs whitespace-nowrap text-[var(--color-muted)]">
            {r.bank_name}
            <span
              class="ml-1 inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase"
              style="border-color: var(--color-border);"
            >
              {ACCOUNT_TYPE_LABELS[r.account_type] ?? r.account_type}
            </span>
            {#if r.account_last_4}
              <span class="ml-1 font-mono text-[var(--color-muted)]">••••{r.account_last_4}</span>
            {/if}
          </td>
          {#if showCategory}
            <td class="px-3 py-2">{@render categoryPicker(r)}</td>
          {/if}
          <td class="px-3 py-2 text-xs text-[var(--color-muted)]">
            {TYPE_LABELS[r.transaction_type]}
          </td>
          <td class="px-3 py-2 text-right font-mono whitespace-nowrap" style:color={amountColor(r)}>
            {formatMoney(r.amount_minor, { currency: r.currency })}
          </td>
        </tr>

        {#if expandedNow}
          <!-- Inline provenance row — Constitution Principle VI says every
               transaction must carry full provenance, and we show it here. -->
          <tr style:background-color="color-mix(in oklab, var(--color-accent) 4%, transparent)">
            <td colspan={colSpan} class="px-6 py-3 text-xs">{@render details(r)}</td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
  {#if rows.length === 0}
    <p class="p-6 text-center text-sm text-[var(--color-muted)]">
      No transactions match the current filters.
    </p>
  {/if}
</div>

<!-- One mobile row (icon · name + badges · category/account · amount), tap to
     expand.  Shared by the day-grouped and flat (non-date-sort) layouts. -->
{#snippet mobileRow(r: UnifiedRow)}
  {@const expandedNow = isExpanded(r)}
  <div class="row" style="border-color: var(--color-border);">
    <button
      type="button"
      onclick={() => toggleExpanded(r)}
      class="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      aria-expanded={expandedNow}
    >
      <CategoryIcon
        icon={categoryIconName(categoryFor?.(r) ? currentCatName(r) : displayName(r))}
        color={categoryColor(categoryFor?.(r) ?? null)}
        tint
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span
            class="truncate text-[15px] font-medium text-[var(--color-text)]"
            class:line-through={isIgnored(r)}
            style:opacity={isIgnored(r) ? '0.5' : '1'}>{displayName(r)}</span
          >
          {#if isRecurring(r)}
            <span class="shrink-0 text-[11px]" style="color: var(--color-accent);" title="Recurring"
              >↻</span
            >
          {/if}
        </div>
        <div class="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          {#if secondaryCatLabel(r) !== ''}
            <span class="truncate">{secondaryCatLabel(r)}</span>
          {/if}
          {#if multiAccount}
            <span class="acct-chip shrink-0">{accountChip(r)}</span>
          {/if}
          {#each tagsOf(r) as tag (tag)}
            <span class="tag-chip shrink-0">#{tag}</span>
          {/each}
        </div>
      </div>
      <div class="num text-[15px] font-semibold whitespace-nowrap" style:color={amountColor(r)}>
        {formatMoney(r.amount_minor, { currency: r.currency })}
      </div>
    </button>
    {#if expandedNow}
      <div class="px-3.5 pb-3.5">
        {#if showCategory}
          <div class="mb-3">{@render categoryPicker(r)}</div>
        {/if}
        <div class="border-t pt-3 text-xs" style="border-color: var(--color-border);">
          {@render details(r)}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

<!-- ── Phone + tablet (<1024px): a day-grouped ledger.  Each day is its own card
     with a friendly heading (Today / Yesterday / Fri, May 30) and the day's net,
     so the date isn't repeated on every row. ── -->
<div class="lg:hidden">
  {#if rows.length === 0}
    <p
      class="rounded-xl border p-6 text-center text-sm text-[var(--color-muted)]"
      style="border-color: var(--color-border);"
    >
      No transactions match the current filters.
    </p>
  {:else if showDayHeaders}
    {#each dayGroups as g (g.date)}
      {@const net = dayNetMinor(g)}
      <section class="mt-4 first:mt-0">
        <header class="mb-1.5 flex items-baseline justify-between px-1">
          <h3 class="text-xs font-semibold text-[var(--color-text)]">
            {formatDayHeading(g.date, todayIso)}
          </h3>
          <span class="num text-xs font-medium text-[var(--color-muted)]">
            {net > 0n ? '+' : ''}{formatMoney(net)}
          </span>
        </header>
        <div
          class="overflow-hidden rounded-2xl border"
          style="border-color: var(--color-border); background-color: var(--color-surface);"
        >
          {#each g.rows as r (rowKey(r))}
            {@render mobileRow(r)}
          {/each}
        </div>
      </section>
    {/each}
  {:else}
    <div
      class="overflow-hidden rounded-2xl border"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      {#each rows as r (rowKey(r))}
        {@render mobileRow(r)}
      {/each}
    </div>
  {/if}
</div>

<style>
  .row + .row {
    border-top: 1px solid var(--color-border);
  }
  /* Small inline chips on a row's sub-line (account when multiple, tags). */
  .acct-chip,
  .tag-chip {
    border-radius: 9999px;
    border: 1px solid var(--color-border);
    padding: 0 0.4rem;
    font-size: 10px;
    line-height: 1.4;
    color: var(--color-muted);
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Collapsed provenance: rotate the chevron when open, hide the native marker. */
  .provenance > summary::-webkit-details-marker {
    display: none;
  }
  .provenance .chev {
    display: inline-block;
    transition: transform 0.15s ease;
  }
  .provenance[open] .chev {
    transform: rotate(90deg);
  }
</style>
