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
    refundCandidates = []
  }: Props = $props();

  const showCategory = $derived(onAssignCategory !== undefined);
  const showActions = $derived(onUpdateAnnotation !== undefined);

  function displayName(r: UnifiedRow): string {
    const cn = annotationFor?.(r)?.custom_name;
    return cn !== undefined && cn !== '' ? cn : r.description;
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

<!-- Shared expanded detail panel: provenance + actions + source link. -->
{#snippet details(r: UnifiedRow)}
  <dl class="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
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
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isRecurring(r)}
            onchange={(e) => onUpdateAnnotation?.(r, { is_recurring: e.currentTarget.checked })}
          />
          <span>Mark as recurring</span>
        </label>
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

<!-- ── Phone + tablet: clean hairline-divided list, tap a row to expand (<1024px) ── -->
<div class="lg:hidden">
  {#if rows.length === 0}
    <p
      class="rounded-xl border p-6 text-center text-sm text-[var(--color-muted)]"
      style="border-color: var(--color-border);"
    >
      No transactions match the current filters.
    </p>
  {:else}
    <div
      class="overflow-hidden rounded-2xl border"
      style="border-color: var(--color-border); background-color: var(--color-surface);"
    >
      {#each rows as r (rowKey(r))}
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
              <div
                class="truncate text-[15px] font-medium text-[var(--color-text)]"
                class:line-through={isIgnored(r)}
                style:opacity={isIgnored(r) ? '0.5' : '1'}
              >
                {displayName(r)}
                {#if isRecurring(r)}<span
                    class="ml-1 text-[10px]"
                    style="color: var(--color-accent);">↻</span
                  >{/if}
              </div>
              <div class="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                {r.posted_date} · {currentCatName(r)}
              </div>
            </div>
            <div
              class="num text-[15px] font-semibold whitespace-nowrap"
              style:color={amountColor(r)}
            >
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
      {/each}
    </div>
  {/if}
</div>

<style>
  .row + .row {
    border-top: 1px solid var(--color-border);
  }
</style>
