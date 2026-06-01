<script lang="ts">
  // Recurring — USER-OWNED bills + subscriptions, MONTH-AWARE (spec
  // 002-income-pockets §7.5–§7.10). The user owns every row: add it, set amount +
  // default pocket + cadence + first due date, and mark it paid deliberately.
  //
  // Two interactions, deliberately SEPARATE (Hemanth's bug report — editing must
  // not force a payment):
  //   • tap the ROW (name/amount)  → EDIT the bill (amount/name/cadence/due)
  //   • tap the CIRCLE             → PAY this month (a confirm sheet, never 1-tap)
  //
  // A month navigator (◀ June 2026 ▶ + calendar) sits at the top, just like Home,
  // so the user can jump to any month — see what they paid in February, or add a
  // bill they forgot to a past month. Each month shows the bills/subscriptions
  // ACTIVE that month with that month's own paid/left status.
  import { onMount } from 'svelte';
  import { loadRecurring, saveRecurring } from '$lib/db/recurring-store';
  import { loadCategorization } from '$lib/db/categorization-store';
  import { loadState, type ImportRecord } from '$lib/db/store';
  import { suggestRecurring, type RecurringSuggestion } from '$lib/app/recurring-suggest';
  import type { TransactionAnnotation } from '$lib/app/categorization';
  import { DEFAULT_POCKETS, findPocket, type Pocket } from '$lib/app/pockets';
  import {
    monthOf,
    isActiveInMonth,
    dueDateInMonth,
    statusInMonth,
    sectionTotalsForMonth,
    remainingInMonth,
    paidCappedInMonth,
    latestPaymentInMonth,
    applyPayment,
    unpayMonth,
    cadenceLabel,
    defaultSectionForKind,
    DEFAULT_SECTIONS,
    SECTION_BILLS,
    type RecurringItem,
    type RecurringSection,
    type PaymentInput,
    type RecurringStatus,
    type Cadence
  } from '$lib/app/recurring-items';
  import { categoryColor, categoryIconName, type GlyphKey } from '$lib/app/category-visuals';
  import { formatMoney } from '$lib/util/money';
  import { today } from '$lib/util/date';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import PayRecurringSheet from '$components/PayRecurringSheet.svelte';
  import AddRecurringSheet from '$components/AddRecurringSheet.svelte';
  import MonthPickerSheet from '$components/MonthPickerSheet.svelte';
  import RecurringActionSheet from '$components/RecurringActionSheet.svelte';
  import ConfirmSheet from '$components/ConfirmSheet.svelte';
  import ManageSectionsSheet from '$components/ManageSectionsSheet.svelte';
  import SectionIcon from '$components/SectionIcon.svelte';

  let loading = $state(true);
  let items = $state<RecurringItem[]>([]);
  let sections = $state<RecurringSection[]>([...DEFAULT_SECTIONS]);
  let pockets = $state<Pocket[]>([...DEFAULT_POCKETS]);
  let paySheetItem = $state<RecurringItem | null>(null);
  // The ⋮ per-row menu (Mark paid / Edit / Delete) and the delete confirm.
  let actionSheetItem = $state<RecurringItem | null>(null);
  let confirmDeleteItem = $state<RecurringItem | null>(null);
  let manageOpen = $state(false);
  // One add/edit sheet, three uses: blank add, edit an item, or seed from a
  // statement suggestion (so the user can tweak the name/amount before adding).
  type AddEdit = {
    sectionId: string;
    editItem: RecurringItem | null;
    seed: { name: string; amount_minor: bigint; cadence: Cadence; due_date: string } | null;
  };
  let addEdit = $state<AddEdit | null>(null);
  let pickerOpen = $state(false);
  // Auto-detection of recurring items from the user's statements.
  let imports = $state<ImportRecord[]>([]);
  let annotations = $state<Record<string, TransactionAnnotation>>({});
  let dismissed = $state<Set<string>>(new Set());

  const todayIso = today();
  const currentMonth = todayIso.slice(0, 7);
  /** The month currently shown — defaults to this calendar month. */
  let activeMonth = $state(currentMonth);

  onMount(async () => {
    const [rec, cat, state] = await Promise.all([
      loadRecurring(),
      loadCategorization(),
      loadState()
    ]);
    items = rec.items;
    sections = rec.sections.length > 0 ? rec.sections : [...DEFAULT_SECTIONS];
    pockets =
      cat.pockets !== undefined && cat.pockets.length > 0 ? cat.pockets : [...DEFAULT_POCKETS];
    annotations = cat.annotations;
    imports = state.imports;
    loading = false;
  });

  // ── month navigation ────────────────────────────────────────────────────────
  function addMonths(ym: string, n: number): string {
    const y = Number.parseInt(ym.slice(0, 4), 10);
    const m = Number.parseInt(ym.slice(5, 7), 10);
    const t = y * 12 + (m - 1) + n;
    const ny = Math.floor(t / 12);
    const nm = t % 12;
    return `${ny}-${String(nm + 1).padStart(2, '0')}`;
  }
  /** Contiguous month list the nav can step through: spans every month an item
   *  starts or was paid in, ±6 months of headroom so a forgotten bill can be
   *  added to a nearby empty month. */
  const monthsAvailable = $derived.by<string[]>(() => {
    let min = currentMonth;
    let max = currentMonth;
    for (const it of items) {
      if (it.archived === true) continue;
      const start = monthOf(it.due_date);
      if (start < min) min = start;
      if (start > max) max = start;
      for (const p of it.payments) {
        if (p.month < min) min = p.month;
        if (p.month > max) max = p.month;
      }
    }
    min = addMonths(min, -6);
    max = addMonths(max, 6);
    const list: string[] = [];
    let cur = min;
    let guard = 0;
    while (cur <= max && guard < 600) {
      list.push(cur);
      cur = addMonths(cur, 1);
      guard++;
    }
    return list;
  });
  const monthsSet = $derived(new Set(monthsAvailable));
  const activeIdx = $derived(monthsAvailable.indexOf(activeMonth));
  const canPrev = $derived(activeIdx > 0);
  const canNext = $derived(activeIdx >= 0 && activeIdx < monthsAvailable.length - 1);
  function prevMonth(): void {
    if (canPrev) activeMonth = monthsAvailable[activeIdx - 1]!;
  }
  function nextMonth(): void {
    if (canNext) activeMonth = monthsAvailable[activeIdx + 1]!;
  }
  const MONTHS = [
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
  const activeMonthLabel = $derived(
    `${MONTHS[Number(activeMonth.slice(5, 7))]} ${activeMonth.slice(0, 4)}`
  );

  // ── statement suggestions ────────────────────────────────────────────────────
  const sugKey = (s: { kind: string; name: string }): string => `${s.kind}|${s.name.toLowerCase()}`;
  const suggestions = $derived(
    suggestRecurring(imports, annotations, todayIso).filter((s) => {
      if (dismissed.has(sugKey(s))) return false;
      // Already added under ANY section (matched by name) → don't re-suggest.
      return !items.some((it) => it.name.toLowerCase() === s.name.toLowerCase());
    })
  );
  /** Move a suggestion's due day into the active month so it appears immediately. */
  function seedDueDate(s: RecurringSuggestion): string {
    return dueDateInMonth({ due_date: s.due_date }, activeMonth);
  }
  function customizeSuggestion(s: RecurringSuggestion): void {
    addEdit = {
      sectionId: defaultSectionForKind(s.kind),
      editItem: null,
      seed: {
        name: s.name,
        amount_minor: s.amount_minor,
        cadence: s.cadence,
        due_date: seedDueDate(s)
      }
    };
  }
  async function addAllSuggestions(): Promise<void> {
    let next = items;
    for (const s of suggestions) {
      const sectionId = defaultSectionForKind(s.kind);
      const order = next.filter((i) => i.section_id === sectionId).length;
      next = [
        ...next,
        {
          section_id: sectionId,
          name: s.name,
          amount_minor: s.amount_minor,
          paid_from: 'paychecks',
          cadence: s.cadence,
          due_date: s.due_date,
          id: newId(),
          order,
          payments: []
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
    await saveRecurring({ items, sections });
  }

  // ── per-month views ──────────────────────────────────────────────────────────
  function byDueInMonth(a: RecurringItem, b: RecurringItem): number {
    const da = dueDateInMonth(a, activeMonth);
    const db = dueDateInMonth(b, activeMonth);
    if (da !== db) return da < db ? -1 : 1;
    return a.order - b.order;
  }
  const orderedSections = $derived([...sections].sort((a, b) => a.order - b.order));
  /** One view per section: the section, its items ACTIVE this month (sorted), and
   *  this month's totals over ALL its non-archived items. */
  type SectionView = {
    section: RecurringSection;
    list: RecurringItem[];
    totals: { dueMinor: bigint; paidMinor: bigint; leftMinor: bigint };
  };
  const sectionViews = $derived.by<SectionView[]>(() =>
    orderedSections.map((section) => {
      const all = items.filter((i) => i.section_id === section.id && i.archived !== true);
      return {
        section,
        list: all.filter((i) => isActiveInMonth(i, activeMonth)).sort(byDueInMonth),
        totals: sectionTotalsForMonth(all, activeMonth)
      };
    })
  );
  const overdue = $derived(
    items.filter(
      (i) =>
        i.archived !== true &&
        isActiveInMonth(i, activeMonth) &&
        statusInMonth(i, activeMonth, todayIso) === 'overdue'
    )
  );

  // ── mutations ─────────────────────────────────────────────────────────────
  function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'r' + items.length + '_' + items.reduce((n, i) => n + i.id.length, 0);
  }

  type Draft = Pick<
    RecurringItem,
    'section_id' | 'name' | 'amount_minor' | 'paid_from' | 'cadence' | 'due_date'
  > & { logo: string };
  async function handleAddOrEdit(draft: Draft): Promise<void> {
    const ae = addEdit;
    if (ae === null) return;
    if (ae.editItem !== null) {
      // Edit: keep id/payments, overwrite the editable fields (incl. section). NO payment.
      replace({ ...ae.editItem, ...draft });
    } else {
      const order = items.filter((i) => i.section_id === draft.section_id).length;
      items = [...items, { ...draft, id: newId(), order, payments: [] }];
    }
    addEdit = null;
    await persist();
  }

  function replace(updated: RecurringItem): void {
    items = items.map((i) => (i.id === updated.id ? updated : i));
  }

  async function handlePay(input: PaymentInput): Promise<void> {
    if (paySheetItem === null) return;
    replace(applyPayment(paySheetItem, input));
    paySheetItem = null;
    await persist();
  }
  async function handleMarkUnpaid(): Promise<void> {
    if (paySheetItem === null) return;
    replace(unpayMonth(paySheetItem, activeMonth));
    paySheetItem = null;
    await persist();
  }
  async function handleDelete(item: RecurringItem): Promise<void> {
    items = items.filter((i) => i.id !== item.id);
    await persist();
  }

  function openAdd(sectionId: string): void {
    addEdit = { sectionId, editItem: null, seed: null };
  }
  function openEdit(item: RecurringItem): void {
    addEdit = { sectionId: item.section_id, editItem: item, seed: null };
  }

  // ── section CRUD (user-owned grouping) ─────────────────────────────────────
  function newSectionId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      return 'sec-' + crypto.randomUUID();
    return 'sec-' + sections.length + '-' + sections.reduce((n, s) => n + s.id.length, 0);
  }
  /** Create a section (used by the in-sheet "＋ New section"); returns its id. */
  function createSection(name: string, icon: string): string {
    const id = newSectionId();
    const order = sections.reduce((m, s) => Math.max(m, s.order), -1) + 1;
    sections = [...sections, { id, name: name.trim() || 'Section', icon, order }];
    void persist();
    return id;
  }
  function renameSection(id: string, name: string, icon: string): void {
    sections = sections.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name, icon } : s));
    void persist();
  }
  /** Delete a custom section; its items move to Bills so nothing is lost. */
  function deleteSection(id: string): void {
    const sec = sections.find((s) => s.id === id);
    if (sec === undefined || sec.builtin === true) return;
    items = items.map((i) => (i.section_id === id ? { ...i, section_id: SECTION_BILLS } : i));
    sections = sections.filter((s) => s.id !== id);
    void persist();
  }
  function moveSection(id: string, dir: -1 | 1): void {
    const ord = [...sections].sort((a, b) => a.order - b.order);
    const idx = ord.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ord.length) return;
    const a = ord[idx]!;
    const b = ord[swap]!;
    sections = sections.map((s) =>
      s.id === a.id ? { ...s, order: b.order } : s.id === b.id ? { ...s, order: a.order } : s
    );
    void persist();
  }

  // ── ⋮ action sheet → Mark paid / Edit / Delete ─────────────────────────────
  /** Plain-English label for the menu's pay action, by this month's status. */
  function payActionLabel(item: RecurringItem): string {
    const st = statusInMonth(item, activeMonth, todayIso);
    if (st === 'paid') return 'View payment';
    if (st === 'partial') return 'Continue paying…';
    return `Mark paid for ${activeMonthLabel}…`;
  }
  function actionMarkPaid(): void {
    paySheetItem = actionSheetItem;
    actionSheetItem = null;
  }
  function actionEdit(): void {
    if (actionSheetItem !== null) openEdit(actionSheetItem);
    actionSheetItem = null;
  }
  function actionDelete(): void {
    confirmDeleteItem = actionSheetItem;
    actionSheetItem = null;
  }
  /** "Delete bill" tapped at the bottom of the Edit sheet — route to the confirm. */
  function requestDeleteFromEdit(): void {
    const it = addEdit?.editItem ?? null;
    addEdit = null;
    if (it !== null) confirmDeleteItem = it;
  }
  async function confirmDelete(): Promise<void> {
    const it = confirmDeleteItem;
    confirmDeleteItem = null;
    if (it !== null) await handleDelete(it);
  }
  /** Pre-filled due date for a NEW item: today if viewing this month, else the
   *  same day-of-month inside the viewed month (so it lands where expected). */
  function defaultDueFor(month: string): string {
    if (month === currentMonth) return todayIso;
    return dueDateInMonth({ due_date: todayIso }, month);
  }

  // ── row presentation ────────────────────────────────────────────────────
  /** The glyph for a row: the user's chosen icon override (item.logo), else the
   *  one auto-derived from the name (banks/car/internet/EMI/insurance all map to
   *  a meaningful icon now, never a pale generic tag). */
  function iconFor(item: { logo?: string; name: string }): GlyphKey {
    return item.logo !== undefined && item.logo.length > 0
      ? (item.logo as GlyphKey)
      : categoryIconName(item.name);
  }
  function prettyDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${MONTHS[Number(m)]} ${Number(d)}`;
  }
  function statusLine(item: RecurringItem, status: RecurringStatus): string {
    if (status === 'paid') {
      const lp = latestPaymentInMonth(item, activeMonth);
      const pk = lp ? findPocket(pockets, lp.paid_from) : null;
      return `✓ paid ${lp ? prettyDate(lp.paid_date) : ''}${pk ? ' · ' + pk.logo + ' ' + pk.name : ''}`;
    }
    if (status === 'partial') {
      return `${formatMoney(paidCappedInMonth(item, activeMonth))} of ${formatMoney(item.amount_minor)} · ${formatMoney(remainingInMonth(item, activeMonth))} left`;
    }
    const due = dueDateInMonth(item, activeMonth);
    if (status === 'overdue') return `⚠ overdue · was due ${prettyDate(due)}`;
    return `due ${prettyDate(due)} · ${cadenceLabel(item.cadence)}`;
  }
</script>

<svelte:head><title>Recurring · trackcents</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
  <h1 class="mb-1 text-2xl font-semibold">Recurring</h1>
  <p class="mb-4 text-sm" style:color="var(--color-muted)">
    Tap the circle to <strong>mark a bill paid</strong> · tap <strong>⋮</strong> to edit or delete.
  </p>

  {#if !loading}
    <!-- Month navigator — ◀ Month YYYY ▶ + calendar, mirroring Home. -->
    <div class="month-nav">
      <button
        type="button"
        class="mn-arrow"
        onclick={prevMonth}
        disabled={!canPrev}
        aria-label="Previous month"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg
        >
      </button>
      <button type="button" class="mn-label" onclick={() => (pickerOpen = true)}>
        <span>{activeMonthLabel}</span>
        {#if activeMonth !== currentMonth}<span class="mn-dot" aria-hidden="true"></span>{/if}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          ><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg
        >
      </button>
      <button
        type="button"
        class="mn-arrow"
        onclick={nextMonth}
        disabled={!canNext}
        aria-label="Next month"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
        >
      </button>
    </div>
  {/if}

  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else}
    {#if overdue.length > 0}
      <div
        class="card rise mb-4 p-4"
        style="background-image: linear-gradient(to right, color-mix(in oklab, var(--color-danger) 10%, transparent), transparent);"
      >
        <p class="text-sm font-semibold" style:color="var(--color-danger)">
          ⚠ {overdue.length} overdue in {activeMonthLabel}
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
          Recurring bills &amp; subscriptions we spotted by name. Tap <strong>＋ Add</strong> to review
          the name &amp; amount before saving; edit or remove anytime.
        </p>
        {#each suggestions as s (s.kind + s.name)}
          <div class="sug-row" style="border-top: 1px solid var(--color-border);">
            <CategoryIcon icon={categoryIconName(s.name)} color={categoryColor(s.name)} tint />
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
              onclick={() => customizeSuggestion(s)}
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

    {#snippet section(v: SectionView)}
      <section class="card rise mb-4 p-5">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="flex items-center gap-2 text-sm font-semibold">
            <SectionIcon icon={v.section.icon} name={v.section.name} size={16} />
            {v.section.name}
          </h2>
          <button
            type="button"
            class="text-sm font-semibold"
            style:color="var(--color-accent)"
            onclick={() => openAdd(v.section.id)}
          >
            ➕ Add
          </button>
        </div>

        {#if v.list.length === 0}
          <p class="py-3 text-sm" style:color="var(--color-muted)">
            None due in {activeMonthLabel}. Tap <strong>➕ Add</strong> to add one.
          </p>
        {:else}
          <p class="mb-1 text-xs" style:color="var(--color-muted)">
            {formatMoney(v.totals.dueMinor)} due · {formatMoney(v.totals.paidMinor)} paid ·
            <strong style:color="var(--color-text)">{formatMoney(v.totals.leftMinor)} left</strong>
          </p>
          {#each v.list as item (item.id)}
            {@const status = statusInMonth(item, activeMonth, todayIso)}
            <div class="rec-row" style="border-top: 1px solid var(--color-border);">
              <button
                type="button"
                class="rec-circle"
                onclick={() => (paySheetItem = item)}
                aria-label="Mark {item.name} paid for {activeMonthLabel}"
              >
                <span
                  class="rec-status"
                  class:paid={status === 'paid'}
                  class:partial={status === 'partial'}
                  class:overdue={status === 'overdue'}
                >
                  {status === 'paid' ? '✓' : status === 'partial' ? '◐' : ''}
                </span>
              </button>
              <!-- Body is inert text: editing lives on the explicit ⋮ menu, not on
                   an invisible body tap (the #1 complaint). -->
              <div class="rec-body-wrap">
                <CategoryIcon icon={iconFor(item)} color={categoryColor(item.name)} tint />
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
              </div>
              <button
                type="button"
                class="rec-overflow"
                onclick={() => (actionSheetItem = item)}
                aria-label="More actions for {item.name}"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="5" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="12" cy="19" r="1.6" />
                </svg>
              </button>
            </div>
          {/each}
        {/if}
      </section>
    {/snippet}

    {#each sectionViews as v (v.section.id)}
      {@render section(v)}
    {/each}

    <button type="button" class="manage-sections" onclick={() => (manageOpen = true)}>
      ⚙ Manage sections
    </button>
  {/if}
</main>

<PayRecurringSheet
  open={paySheetItem !== null}
  item={paySheetItem}
  month={activeMonth}
  {pockets}
  {todayIso}
  onPay={handlePay}
  onMarkUnpaid={handleMarkUnpaid}
  onClose={() => (paySheetItem = null)}
/>

<AddRecurringSheet
  open={addEdit !== null}
  sectionId={addEdit?.sectionId ?? SECTION_BILLS}
  {sections}
  editItem={addEdit?.editItem ?? null}
  seed={addEdit?.seed ?? null}
  defaultDueDate={defaultDueFor(activeMonth)}
  {pockets}
  {todayIso}
  onAdd={handleAddOrEdit}
  onCreateSection={createSection}
  onDelete={requestDeleteFromEdit}
  onClose={() => (addEdit = null)}
/>

<RecurringActionSheet
  open={actionSheetItem !== null}
  item={actionSheetItem}
  payLabel={actionSheetItem !== null ? payActionLabel(actionSheetItem) : ''}
  onMarkPaid={actionMarkPaid}
  onEdit={actionEdit}
  onDelete={actionDelete}
  onClose={() => (actionSheetItem = null)}
/>

<ManageSectionsSheet
  open={manageOpen}
  {sections}
  counts={items.reduce(
    (m, i) => {
      if (i.archived !== true) m[i.section_id] = (m[i.section_id] ?? 0) + 1;
      return m;
    },
    {} as Record<string, number>
  )}
  onCreate={createSection}
  onRename={renameSection}
  onDelete={deleteSection}
  onMove={moveSection}
  onClose={() => (manageOpen = false)}
/>

<ConfirmSheet
  open={confirmDeleteItem !== null}
  title="Delete {confirmDeleteItem?.name ?? 'this item'}?"
  message="This removes it and its payment history. This can't be undone."
  confirmLabel="Delete"
  danger
  onConfirm={confirmDelete}
  onClose={() => (confirmDeleteItem = null)}
/>

<MonthPickerSheet
  open={pickerOpen}
  currentMonth={activeMonth}
  monthsWithData={monthsSet}
  todayMonth={currentMonth}
  onSelect={(m) => (activeMonth = m)}
  onClose={() => (pickerOpen = false)}
/>

<style>
  .month-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .mn-arrow {
    width: 38px;
    height: 38px;
    border-radius: 999px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
    color: var(--color-text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: none;
  }
  .mn-arrow:disabled {
    opacity: 0.35;
    cursor: default;
    box-shadow: none;
  }
  .mn-arrow:not(:disabled):active {
    transform: scale(0.92);
  }
  .mn-label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 9.5rem;
    justify-content: center;
    padding: 0.5rem 1rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-weight: 700;
    font-size: 0.98rem;
    cursor: pointer;
    font-family: inherit;
  }
  .mn-label svg {
    color: var(--color-muted);
  }
  .mn-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--color-accent);
  }

  .manage-sections {
    display: block;
    width: 100%;
    text-align: center;
    padding: 0.7rem;
    border: 1px dashed var(--color-border);
    border-radius: 14px;
    background: transparent;
    color: var(--color-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    margin-top: 0.2rem;
  }
  .manage-sections:active {
    background: var(--color-elevated);
  }

  .rec-row {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }
  .rec-circle {
    flex: none;
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0.7rem 0.35rem 0.7rem 0;
    display: grid;
    place-items: center;
  }
  .rec-status {
    width: 24px;
    height: 24px;
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
  .rec-body-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0;
    min-width: 0;
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
  .rec-overflow {
    flex: none;
    background: none;
    border: 0;
    cursor: pointer;
    color: var(--color-muted);
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    margin-left: 0.1rem;
  }
  .rec-overflow:active {
    background: var(--color-elevated);
  }

  .sug-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0;
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
