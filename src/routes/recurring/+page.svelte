<script lang="ts">
  // Recurring — USER-OWNED bills + subscriptions (spec 002-income-pockets
  // §7.5–§7.10). This REPLACES the old auto-detected list (which guessed nonsense
  // like "Western Union · Weekly · $43,413/yr"). The user owns every row: add it,
  // set amount + default pocket + cadence + first due date, and mark it paid
  // deliberately (a bottom sheet, never a one-tap toggle). Two sections — 📋 Bills
  // and 🔁 Subscriptions — each with its own due · paid · left totals.
  import { onMount } from 'svelte';
  import { loadRecurring, saveRecurring } from '$lib/db/recurring-store';
  import { loadCategorization } from '$lib/db/categorization-store';
  import { loadState, type ImportRecord } from '$lib/db/store';
  import { suggestRecurring, type RecurringSuggestion } from '$lib/app/recurring-suggest';
  import type { TransactionAnnotation } from '$lib/app/categorization';
  import { DEFAULT_POCKETS, findPocket, type Pocket } from '$lib/app/pockets';
  import {
    deriveStatus,
    remainingMinor,
    paidThisCycleMinor,
    sectionTotals,
    applyPayment,
    markUnpaid as markUnpaidPure,
    startNextCycle as startNextCyclePure,
    cadenceLabel,
    type RecurringItem,
    type RecurringKind,
    type PaymentInput,
    type RecurringStatus
  } from '$lib/app/recurring-items';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { formatMoney } from '$lib/util/money';
  import { today } from '$lib/util/date';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import PayRecurringSheet from '$components/PayRecurringSheet.svelte';
  import AddRecurringSheet from '$components/AddRecurringSheet.svelte';

  let loading = $state(true);
  let items = $state<RecurringItem[]>([]);
  let pockets = $state<Pocket[]>([...DEFAULT_POCKETS]);
  let editMode = $state(false);
  let paySheetItem = $state<RecurringItem | null>(null);
  let addSheetKind = $state<RecurringKind | null>(null);
  // Auto-detection of recurring items from the user's statements.
  let imports = $state<ImportRecord[]>([]);
  let annotations = $state<Record<string, TransactionAnnotation>>({});
  let dismissed = $state<Set<string>>(new Set());

  const todayIso = today();

  onMount(async () => {
    const [rec, cat, state] = await Promise.all([
      loadRecurring(),
      loadCategorization(),
      loadState()
    ]);
    items = rec.items;
    pockets =
      cat.pockets !== undefined && cat.pockets.length > 0 ? cat.pockets : [...DEFAULT_POCKETS];
    annotations = cat.annotations;
    imports = state.imports;
    loading = false;
  });

  // Recurring bills + subscriptions detected in the statements, minus ones the
  // user already added (by name) or dismissed — so we "populate" the tab but the
  // user stays in control (edit / remove).
  const sugKey = (s: { kind: string; name: string }): string => `${s.kind}|${s.name.toLowerCase()}`;
  const suggestions = $derived(
    suggestRecurring(imports, annotations, todayIso).filter((s) => {
      if (dismissed.has(sugKey(s))) return false;
      return !items.some(
        (it) => it.kind === s.kind && it.name.toLowerCase() === s.name.toLowerCase()
      );
    })
  );
  async function addSuggestion(s: RecurringSuggestion): Promise<void> {
    const order = items.filter((i) => i.kind === s.kind).length;
    items = [
      ...items,
      {
        kind: s.kind,
        name: s.name,
        amount_minor: s.amount_minor,
        paid_from: 'paychecks',
        cadence: s.cadence,
        due_date: s.due_date,
        id: newId(),
        order,
        paid_minor: 0n,
        paid_date: null
      }
    ];
    await persist();
  }
  async function addAllSuggestions(): Promise<void> {
    const toAdd = suggestions;
    let next = items;
    for (const s of toAdd) {
      const order = next.filter((i) => i.kind === s.kind).length;
      next = [
        ...next,
        {
          kind: s.kind,
          name: s.name,
          amount_minor: s.amount_minor,
          paid_from: 'paychecks',
          cadence: s.cadence,
          due_date: s.due_date,
          id: newId(),
          order,
          paid_minor: 0n,
          paid_date: null
        }
      ];
    }
    items = next;
    await persist();
  }
  function dismissSuggestion(s: RecurringSuggestion): void {
    dismissed = new Set([...dismissed, sugKey(s)]);
  }

  async function persist(): Promise<void> {
    await saveRecurring({ items });
  }

  function byDue(a: RecurringItem, b: RecurringItem): number {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return a.order - b.order;
  }
  const bills = $derived(items.filter((i) => i.kind === 'bill' && i.archived !== true).sort(byDue));
  const subs = $derived(
    items.filter((i) => i.kind === 'subscription' && i.archived !== true).sort(byDue)
  );
  const billTotals = $derived(sectionTotals(bills));
  const subTotals = $derived(sectionTotals(subs));
  const overdue = $derived(
    [...bills, ...subs].filter((i) => deriveStatus(i, todayIso) === 'overdue')
  );

  // ── mutations ─────────────────────────────────────────────────────────────
  function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    // Fallback for very old engines; ids only need to be unique within this list.
    return 'r' + items.length + '_' + items.reduce((n, i) => n + i.id.length, 0);
  }

  async function handleAdd(
    draft: Omit<RecurringItem, 'id' | 'order' | 'paid_minor' | 'paid_date'>
  ): Promise<void> {
    const order = items.filter((i) => i.kind === draft.kind).length;
    const item: RecurringItem = { ...draft, id: newId(), order, paid_minor: 0n, paid_date: null };
    items = [...items, item];
    addSheetKind = null;
    await persist();
  }

  function replace(updated: RecurringItem): void {
    items = items.map((i) => (i.id === updated.id ? updated : i));
  }

  async function handlePay(input: PaymentInput): Promise<void> {
    if (paySheetItem === null) return;
    const updated = applyPayment(paySheetItem, input);
    replace(updated);
    // Close after recording — the row now reflects the new state (paid / partial).
    // To pay the remainder, roll the cycle, or undo, the user taps the row again.
    paySheetItem = null;
    await persist();
  }
  async function handleMarkUnpaid(): Promise<void> {
    if (paySheetItem === null) return;
    const updated = markUnpaidPure(paySheetItem);
    replace(updated);
    paySheetItem = null;
    await persist();
  }
  async function handleStartNextCycle(): Promise<void> {
    if (paySheetItem === null) return;
    const updated = startNextCyclePure(paySheetItem);
    replace(updated);
    paySheetItem = null;
    await persist();
  }
  async function handleDelete(item: RecurringItem): Promise<void> {
    items = items.filter((i) => i.id !== item.id);
    await persist();
  }

  // ── row presentation ────────────────────────────────────────────────────
  const months = [
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
  function prettyDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${months[Number(m)]} ${Number(d)}`;
  }
  function statusLine(item: RecurringItem, status: RecurringStatus): string {
    if (status === 'paid') {
      const pk = findPocket(pockets, item.paid_from);
      return `✓ paid ${item.paid_date ? prettyDate(item.paid_date) : ''}${pk ? ' · ' + pk.logo + ' ' + pk.name : ''}`;
    }
    if (status === 'partial') {
      return `${formatMoney(paidThisCycleMinor(item))} of ${formatMoney(item.amount_minor)} · ${formatMoney(remainingMinor(item))} left`;
    }
    if (status === 'overdue') return `⚠ overdue · was due ${prettyDate(item.due_date)}`;
    return `due ${prettyDate(item.due_date)} · ${cadenceLabel(item.cadence)}`;
  }
</script>

<svelte:head><title>Recurring · trackcents</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
  <div class="mb-1 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Recurring</h1>
    {#if !loading && items.length > 0}
      <button
        type="button"
        class="rounded-full border px-3 py-1 text-sm font-medium"
        style="border-color: var(--color-border); color: {editMode
          ? 'var(--color-accent)'
          : 'var(--color-muted)'};"
        onclick={() => (editMode = !editMode)}
      >
        {editMode ? 'Done' : 'Edit'}
      </button>
    {/if}
  </div>
  <p class="mb-6 text-sm" style:color="var(--color-muted)">
    Your bills &amp; subscriptions. Add each one, then tick it paid when you pay it.
  </p>

  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else}
    {#if overdue.length > 0}
      <div
        class="card rise mb-4 p-4"
        style="background-image: linear-gradient(to right, color-mix(in oklab, var(--color-danger) 10%, transparent), transparent);"
      >
        <p class="text-sm font-semibold" style:color="var(--color-danger)">
          ⚠ {overdue.length} overdue
        </p>
        <p class="text-xs" style:color="var(--color-muted)">
          {overdue
            .map((i) => i.name)
            .slice(0, 4)
            .join(', ')}{overdue.length > 4 ? '…' : ''}
        </p>
      </div>
    {/if}

    {#if suggestions.length > 0}
      <section class="card rise mb-4 p-5">
        <div class="mb-1 flex items-baseline justify-between">
          <h2 class="text-sm font-semibold">✨ Found in your statements</h2>
          <button
            type="button"
            class="text-sm font-semibold"
            style:color="var(--color-accent)"
            onclick={addAllSuggestions}
          >
            Add all {suggestions.length}
          </button>
        </div>
        <p class="mb-2 text-xs" style:color="var(--color-muted)">
          Recurring bills &amp; subscriptions we spotted by name. Add the ones that make sense; edit
          or remove them anytime.
        </p>
        {#each suggestions as s (s.kind + s.name)}
          <div class="sug-row" style="border-top: 1px solid var(--color-border);">
            {#if s.kind === 'subscription'}
              <CategoryIcon icon={categoryIconName(s.name)} color={categoryColor(s.name)} tint />
            {:else}
              <span class="sug-ic">📋</span>
            {/if}
            <span class="sug-body">
              <span class="sug-name">{s.name}</span>
              <span class="sug-meta">
                {s.kind === 'subscription' ? 'Subscription' : s.label} · {s.occurrences}× · next
                {s.due_date.slice(5)}
              </span>
            </span>
            <span class="num sug-amt">{formatMoney(s.amount_minor)}</span>
            <button
              type="button"
              class="sug-add"
              onclick={() => addSuggestion(s)}
              aria-label="Add {s.name}"
            >
              ＋ Add
            </button>
            <button
              type="button"
              class="sug-x"
              onclick={() => dismissSuggestion(s)}
              aria-label="Dismiss {s.name}"
            >
              ✕
            </button>
          </div>
        {/each}
      </section>
    {/if}

    {#snippet section(
      title: string,
      emoji: string,
      kind: RecurringKind,
      list: RecurringItem[],
      totals: { dueMinor: bigint; paidMinor: bigint; leftMinor: bigint }
    )}
      <section class="card rise mb-4 p-5">
        <div class="mb-2 flex items-baseline justify-between">
          <h2 class="text-sm font-semibold">{emoji} {title}</h2>
          <button
            type="button"
            class="text-sm font-semibold"
            style:color="var(--color-accent)"
            onclick={() => (addSheetKind = kind)}
          >
            ➕ Add
          </button>
        </div>

        {#if list.length === 0}
          <p class="py-3 text-sm" style:color="var(--color-muted)">
            None yet. Tap <strong>➕ Add</strong> to add your first {kind}.
          </p>
        {:else}
          <p class="mb-1 text-xs" style:color="var(--color-muted)">
            {formatMoney(totals.dueMinor)} due · {formatMoney(totals.paidMinor)} paid ·
            <strong style:color="var(--color-text)">{formatMoney(totals.leftMinor)} left</strong>
          </p>
          {#each list as item (item.id)}
            {@const status = deriveStatus(item, todayIso)}
            <div class="rec-row" style="border-top: 1px solid var(--color-border);">
              <button
                type="button"
                class="rec-tap"
                onclick={() => (paySheetItem = item)}
                aria-label="Pay {item.name}"
              >
                <span
                  class="rec-status"
                  class:paid={status === 'paid'}
                  class:partial={status === 'partial'}
                  class:overdue={status === 'overdue'}
                >
                  {status === 'paid' ? '✓' : status === 'partial' ? '◐' : ''}
                </span>
                {#if item.kind === 'subscription'}
                  <CategoryIcon
                    icon={categoryIconName(item.name)}
                    color={categoryColor(item.name)}
                    tint
                  />
                {/if}
                <span class="rec-body">
                  <span class="rec-name" class:done={status === 'paid'}>{item.name}</span>
                  <span
                    class="rec-sub"
                    class:over={status === 'overdue'}
                    class:ok={status === 'paid'}
                  >
                    {statusLine(item, status)}
                  </span>
                </span>
                <span class="num rec-amt">{formatMoney(item.amount_minor)}</span>
              </button>
              {#if editMode}
                <button
                  type="button"
                  class="rec-del"
                  onclick={() => handleDelete(item)}
                  aria-label="Delete {item.name}"
                >
                  🗑
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </section>
    {/snippet}

    {@render section('Bills', '📋', 'bill', bills, billTotals)}
    {@render section('Subscriptions', '🔁', 'subscription', subs, subTotals)}

    <p class="mt-2 text-xs" style:color="var(--color-muted)">
      Bills recur until you remove them; one-time items don't come back. Marking paid is a
      deliberate step — tap a row to confirm the amount and pocket.
    </p>
  {/if}
</main>

<PayRecurringSheet
  open={paySheetItem !== null}
  item={paySheetItem}
  {pockets}
  {todayIso}
  onPay={handlePay}
  onMarkUnpaid={handleMarkUnpaid}
  onStartNextCycle={handleStartNextCycle}
  onClose={() => (paySheetItem = null)}
/>

<AddRecurringSheet
  open={addSheetKind !== null}
  kind={addSheetKind ?? 'bill'}
  {pockets}
  {todayIso}
  onAdd={handleAdd}
  onClose={() => (addSheetKind = null)}
/>

<style>
  .rec-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .rec-tap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0;
    background: none;
    border: 0;
    cursor: pointer;
    text-align: left;
    min-width: 0;
    font-family: inherit;
  }
  .rec-status {
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: 7px;
    border: 1.5px solid var(--color-border);
    display: grid;
    place-items: center;
    font-size: 12px;
    color: var(--color-accent-fg, #fff);
  }
  .rec-status.paid {
    background: var(--color-success);
    border-color: var(--color-success);
  }
  .rec-status.partial {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .rec-status.overdue {
    border-color: var(--color-danger);
  }
  .rec-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .rec-name {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rec-name.done {
    color: var(--color-muted);
    text-decoration: line-through;
  }
  .rec-sub {
    font-size: 0.74rem;
    color: var(--color-muted);
  }
  .rec-sub.over {
    color: var(--color-danger);
    font-weight: 600;
  }
  .rec-sub.ok {
    color: var(--color-success);
  }
  .rec-amt {
    font-weight: 600;
    color: var(--color-text);
    flex: none;
  }
  .rec-del {
    flex: none;
    background: none;
    border: 0;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.4rem;
  }

  .sug-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0;
  }
  .sug-ic {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 9px;
    display: grid;
    place-items: center;
    font-size: 15px;
    background: var(--color-elevated);
  }
  .sug-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .sug-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sug-meta {
    font-size: 0.72rem;
    color: var(--color-muted);
  }
  .sug-amt {
    font-weight: 600;
    color: var(--color-text);
    flex: none;
    font-size: 0.88rem;
  }
  .sug-add {
    flex: none;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    background: transparent;
    border-radius: 999px;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .sug-x {
    flex: none;
    background: none;
    border: 0;
    color: var(--color-muted);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.3rem;
  }
</style>
