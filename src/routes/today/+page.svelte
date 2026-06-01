<script lang="ts">
  // "Today" / Home — the entry-first home screen.  Centerpiece = a tappable
  // budget hero box wrapped in a MonthSlider, so the user can swipe (or use the
  // mid-edge chevrons / tap the month label) to view any past or planned month.
  // Top categories + recent activity follow the active month so the slider
  // really BROWSES the past, not just the box.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { loadState } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import {
    loadCategorization,
    saveCategorization,
    type CategorizationState
  } from '$lib/db/categorization-store';
  import {
    summaryFromImports,
    detailedRowsFromImports,
    spendableFlowByMonth,
    incomeRowsForMonth,
    summaryByFlowIntent,
    flowIntentRowsFromImports
  } from '$lib/app/categorization-glue';
  import { inferAllFlowIntents } from '$lib/app/flow-intent';
  import { runAutoCategorize } from '$lib/app/auto-categorize';
  import { seedCategoriesAndRules, shouldAutoSeed } from '$lib/app/default-categories';
  import {
    deleteCategory as deleteCategoryPure,
    renameCategory as renameCategoryPure,
    setAnnotation,
    pruneAnnotation,
    type TransactionAnnotation
  } from '$lib/app/categorization';
  import { listAllAccounts } from '$lib/app/accounts';
  import { spendingByCategoryByMonth } from '$lib/app/spending-summary';
  import { today } from '$lib/util/date';
  import { monthOverMonthInsight, topMovers } from '$lib/app/spending-insights';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { goalProgress, type SavingsGoal } from '$lib/app/savings-goal';
  import { loadGoals } from '$lib/db/goals-store';
  import { formatMoney } from '$lib/util/money';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import PocketCards from '$components/PocketCards.svelte';
  import { pocketSummariesForMonth, DEFAULT_POCKETS } from '$lib/app/pockets';
  import PaycheckConfirmSheet from '$components/PaycheckConfirmSheet.svelte';
  import PocketEditSheet from '$components/PocketEditSheet.svelte';
  import type { Pocket } from '$lib/app/pockets';
  import { loadAnchor, saveAnchor } from '$lib/db/budget-anchor-store';
  import { paycheckBudgetMonths, detectedPaychecksNewestFirst } from '$lib/app/paycheck-budget';
  import type { BudgetAnchor } from '$lib/app/budget-window';
  import MonthPickerSheet from '$components/MonthPickerSheet.svelte';
  import QuickAddSheet from '$components/QuickAddSheet.svelte';
  import PocketManageSheet from '$components/PocketManageSheet.svelte';

  let loading = $state(true);
  let imports = $state<ImportRecord[]>([]);
  let cat = $state<CategorizationState>({ categories: [], rules: [], annotations: {} });
  let goals = $state<SavingsGoal[]>([]);
  /** The pocket whose per-pocket "manage" sheet is open (null = closed). */
  let managePocketId = $state<string | null>(null);
  /** Paycheck-window anchor (which month the first paycheck funds) + the confirm sheet. */
  let payAnchor = $state<BudgetAnchor | null>(null);
  let paycheckConfirmOpen = $state(false);

  onMount(async () => {
    imports = (await loadState()).imports;
    cat = await loadCategorization();
    goals = await loadGoals();
    payAnchor = loadAnchor();
    loading = false;
    // Auto-seed the starter category + rule set (REQ-B0.2) whenever the
    // user has ZERO categories.  Originally gated on imports.length > 0
    // but that broke the Bhargav case: a manual-only user opened the
    // Quick Add sheet, tapped Category, and saw NOTHING (because no
    // imports → no seeding fired → empty category list).  Now the seed
    // runs as soon as we know the user has nothing — they'll see the
    // starter set on their first tap.  A returning user who deliberately
    // deleted categories ends up here too on next load; the trade-off is
    // worth it (better cold-start than perfect "I emptied this on
    // purpose" memory).  Bhargav-style users can prune in CategoryPicker
    // edit mode (Batch A safe-delete) once seeded.
    if (shouldAutoSeed(cat)) {
      const seeded = seedCategoriesAndRules();
      cat = {
        categories: seeded.categories,
        rules: seeded.rules,
        annotations: cat.annotations
      };
      await saveCategorization(cat);
    }
    // Run the three-tier auto-categoriser (user rules → keyword fallback →
    // learned naive-Bayes) on every load.  Catches any newly-imported rows
    // and any descriptions the now-larger training set can finally classify.
    // Manual annotations stay sticky; nothing user-pinned is overwritten.
    const updated = runAutoCategorize(imports, cat);
    if (updated !== null) {
      cat = updated;
      await saveCategorization(updated);
    }
  });

  const todayIso = today(); // device-local date — follows the phone's timezone
  const currentMonth = todayIso.slice(0, 7);

  // The month currently shown by the slider.  Defaults to the current calendar
  // month; the user can swipe / tap the label to navigate.
  let activeMonth = $state(currentMonth);
  let pickerOpen = $state(false);

  // ── Quick-add sheet (smart NL "type-it" entry) ────────────────────────────
  // The tab-bar center "+" is the universal entry point — it opens an
  // intermediary AddSheet (in Nav.svelte) which routes here with `?add=<kind>`.
  // We read that query param on mount and open QuickAddSheet preset to it.
  let quickAddOpen = $state(false);
  let quickAddType = $state<'expense' | 'income' | 'transfer'>('expense');

  function openQuickAdd(type: 'expense' | 'income' | 'transfer'): void {
    quickAddType = type;
    quickAddOpen = true;
  }

  // Reactively read ?add=expense|income|transfer from the URL store.
  // Using $page (NOT window.location) ensures the effect re-runs when the
  // Nav.svelte tab-bar "+" calls goto() — same-page nav doesn't refire
  // onMount, but it DOES update $page reactively.  Transfer routes back
  // through expense for now (the flow_intent inference catches transfers
  // automatically; a dedicated transfer flow is REQ-B0.5).
  $effect(() => {
    const add = $page.url.searchParams.get('add');
    if (add === null) return;
    if (add === 'expense' || add === 'income' || add === 'transfer') {
      openQuickAdd(add);
    } else {
      return;
    }
    // Clear the URL param after we've consumed it (so a refresh doesn't
    // re-open the sheet).  Uses replaceState so it doesn't push a history
    // entry.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('add');
      window.history.replaceState(null, '', url.toString());
    }
  });

  // Small toast that confirms a save + (when applicable) signals "I learned
  // from this" — Bhargav's feedback in round-3: "no haptic/toast when the
  // Bayes learns".  Auto-clears after 2.5s.
  let saveToast = $state<string | null>(null);
  let saveToastTimer: ReturnType<typeof setTimeout> | undefined;
  async function refreshAfterSave(info: {
    learned: boolean;
    rulePattern?: string | null;
  }): Promise<void> {
    imports = (await loadState()).imports;
    cat = await loadCategorization();
    // Toast varies by what the save did:
    //  • rulePattern set → QuickAddSheet just minted a new "contains X →
    //    Category" user-rule.  Show it explicitly so Hemanth can verify
    //    + edit it later from /categories ("if for any reason I want to
    //    delete or edit, I should have that option there").
    //  • learned (category picked but no new rule) → "I'll remember this"
    //  • neither → plain "Saved"
    if (info.rulePattern && info.rulePattern.length > 0) {
      saveToast = `✓ Tagged "${info.rulePattern}" — edit in /categories`;
    } else if (info.learned) {
      saveToast = '✓ Saved — I’ll remember this';
    } else {
      saveToast = '✓ Saved';
    }
    if (saveToastTimer !== undefined) clearTimeout(saveToastTimer);
    saveToastTimer = setTimeout(() => (saveToast = null), 3500);
    // Re-run auto-categorise on the freshly loaded data so the new annotation
    // immediately feeds the classifier for future predictions.
    const updated = runAutoCategorize(imports, cat);
    if (updated !== null) {
      cat = updated;
      await saveCategorization(updated);
    }
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

  // "Top categories" + the month-over-month insight must use the HONEST spend
  // projection (REQ-B0.1), not raw `txns`. Otherwise CC payments, investment
  // transfers and inter-account moves show up as top "spending" categories — the
  // exact thing the user flagged ("most went to CC Payment"). Same flow-intent
  // projection the Dashboard already uses for its pie + Money-out.
  const flowIntents = $derived(
    inferAllFlowIntents(flowIntentRowsFromImports(imports, cat.annotations))
  );
  const spendTxns = $derived(summaryByFlowIntent(imports, cat.annotations, flowIntents).spend);
  // Flow-intent-aware month flow (REQ-B0.1): "Spent" EXCLUDES CC payments,
  // inter-account transfers, and investment transfers (which are money
  // movement, not life cash-flow).  "Income" EXCLUDES money-movement inflows.
  // This is what the BudgetBox renders as the headline.
  const nbm = $derived(spendableFlowByMonth(imports, cat.annotations));
  const sbm = $derived(spendingByCategoryByMonth(spendTxns));

  /** Months the BudgetBox nav widget can step through.  Strictly months WITH
   *  imported transaction data, plus the device's current month so a brand-new
   *  user lands on Home with the current month rendered.  We do NOT auto-add
   *  "next month for planning" any more — the user complained the ▶ chevron
   *  let them step into June even with no June data, and the picker then
   *  surfaced an empty future month. */
  const monthsAvailable = $derived.by<string[]>(() => {
    const set = new Set<string>(nbm.keys());
    set.add(currentMonth);
    return [...set].sort();
  });

  /** Months we have any transaction data for — drives the data-dot in the picker. */
  const monthsWithDataSet = $derived(new Set<string>(nbm.keys()));

  // (The old "you're paid biweekly — try the paycheck-window /budget" nudge was
  // removed: the real paycheck setup — the "Set up your paychecks" banner +
  // PaycheckConfirmSheet — now owns this flow, so the old banner was redundant.)

  /** Account list for the quick-add sheet — combines imported accounts
   *  (with bank + last-4 distinguished), manually-added accounts (Bhargav
   *  case), and "Cash" as the always-available fallback.  Owned by
   *  src/lib/app/accounts.ts so it's reusable from other forms. */
  const accountList = $derived<string[]>(listAllAccounts(imports));

  /** Create a new category from the QuickAddSheet -> CategoryPicker flow.
   *  Generates a stable id, persists, returns the new id so the form can
   *  select it immediately. */
  async function handleCreateCategory(
    name: string,
    parentId?: string,
    icon?: string
  ): Promise<string> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('category name is empty');
    // Avoid silent collisions WITHIN THE SAME PARENT — if a category
    // with this exact (name, parent_id) already exists, just return its
    // id.  We allow the SAME name under different parents (e.g. "Ice
    // cream" can exist as a sub of both "Food" and "Gifts/Family") so
    // this is a 2-key match, not name-only.
    const existing = cat.categories.find(
      (c) =>
        c.name.toLowerCase() === trimmed.toLowerCase() && (c.parent_id ?? '') === (parentId ?? '')
    );
    if (existing) return existing.id;
    const newId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `cat-${crypto.randomUUID()}`
        : `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const newCat: import('$lib/app/categorization').Category = { id: newId, name: trimmed };
    if (parentId !== undefined) newCat.parent_id = parentId;
    if (icon !== undefined && icon !== '') newCat.icon = icon;
    cat = {
      ...cat,
      categories: [...cat.categories, newCat]
    };
    await saveCategorization(cat);
    return newId;
  }

  /** Rename a category (and optionally set a custom icon override).
   *  Annotations + rules reference category_id, which is stable, so a
   *  rename leaves everything pointing at the right entry. */
  async function handleRenameCategory(
    id: string,
    patch: { name: string; icon: string }
  ): Promise<void> {
    cat = {
      ...cat,
      categories: renameCategoryPure(cat.categories, id, patch.name, patch.icon)
    };
    await saveCategorization(cat);
  }

  /** Delete a category (called from CategoryPicker edit mode AFTER the
   *  confirm sub-sheet).  Uses the pure deleteCategory() from
   *  categorization.ts which also clears the now-orphaned annotations. */
  async function handleDeleteCategory(id: string): Promise<void> {
    const { categories, annotations } = deleteCategoryPure(
      cat.categories,
      new Map(Object.entries(cat.annotations)),
      id
    );
    cat = {
      categories,
      rules: cat.rules.filter((r) => r.category_id !== id),
      annotations: Object.fromEntries(annotations)
    };
    await saveCategorization(cat);
  }

  // If the user lands on an activeMonth that's no longer in the available set
  // (e.g. data reloaded and the picked month vanished), fall back to current.
  $effect(() => {
    if (!monthsAvailable.includes(activeMonth)) {
      activeMonth = currentMonth;
    }
  });

  // ── BudgetBox nav widget — ◀ / ▶ handlers + bounds (locked v1) ──────────
  // Position of activeMonth within the available list dictates whether the
  // chevrons are enabled.  The picker sheet handles "jump anywhere" + Today.
  const activeIdx = $derived(monthsAvailable.indexOf(activeMonth));
  const canPrevMonth = $derived(activeIdx > 0);
  const canNextMonth = $derived(activeIdx >= 0 && activeIdx < monthsAvailable.length - 1);
  function prevMonth(): void {
    if (activeIdx > 0) activeMonth = monthsAvailable[activeIdx - 1]!;
  }
  function nextMonth(): void {
    if (activeIdx >= 0 && activeIdx < monthsAvailable.length - 1) {
      activeMonth = monthsAvailable[activeIdx + 1]!;
    }
  }

  const activeMonthLabel = $derived(monthName(activeMonth));

  // Income pockets for the active month (spec 002-income-pockets §2/§7.11) — the
  // per-pocket carry-forward (±) math that replaces the single combined hero.
  const activePockets = $derived(cat.pockets ?? DEFAULT_POCKETS);
  // Paycheck-window attribution: once the anchor is set, salary deposits fund
  // their budget month (a late-April paycheck funds May), not the calendar month.
  const salaryMonths = $derived(paycheckBudgetMonths(imports, payAnchor));
  const activePocketSummaries = $derived(
    pocketSummariesForMonth(imports, cat.annotations, activeMonth, activePockets, {}, salaryMonths)
  );
  // Offer the one-time paycheck setup when we detect a cadence but have no anchor.
  const detectedPaychecks = $derived(detectedPaychecksNewestFirst(imports));
  const needsPaycheckSetup = $derived(payAnchor === null && detectedPaychecks.length >= 2);
  function savePaycheckAnchor(a: BudgetAnchor): void {
    saveAnchor(a);
    payAnchor = a;
    paycheckConfirmOpen = false;
  }

  // ── Edit income boxes (add / rename / safe-delete) ──────────────────────────
  let pocketEditOpen = $state(false);
  /** How many transactions reference each pocket (paid_from + income_pocket). */
  const pocketCounts = $derived.by<Record<string, number>>(() => {
    const c: Record<string, number> = {};
    for (const a of Object.values(cat.annotations)) {
      if (a.paid_from !== undefined && a.paid_from !== '')
        c[a.paid_from] = (c[a.paid_from] ?? 0) + 1;
      if (a.income_pocket !== undefined && a.income_pocket !== '')
        c[a.income_pocket] = (c[a.income_pocket] ?? 0) + 1;
    }
    return c;
  });
  async function savePockets(next: Pocket[]): Promise<void> {
    cat = { ...cat, pockets: next };
    await saveCategorization(cat);
  }
  /** Safe-delete: move every reference from the deleted box into the target box. */
  async function deletePocketReassign(deleteId: string, targetId: string): Promise<void> {
    const next: Record<string, TransactionAnnotation> = {};
    for (const [k, a] of Object.entries(cat.annotations)) {
      const na = { ...a };
      if (na.paid_from === deleteId) na.paid_from = targetId;
      if (na.income_pocket === deleteId) na.income_pocket = targetId;
      next[k] = na;
    }
    cat = { ...cat, annotations: next };
    await saveCategorization(cat);
  }

  // ── Income deposits, per pocket ─────────────────────────────────────────
  // The exact income deposits for the month, each carrying its pocketId so the
  // per-pocket "manage" sheet can list only its own.
  const activeIncomeRows = $derived(
    incomeRowsForMonth(imports, cat.annotations, activeMonth, {}, salaryMonths)
  );

  // ── Per-pocket "manage" sheet (income redesign) ─────────────────────────────
  const managedSummary = $derived(
    managePocketId === null
      ? null
      : (activePocketSummaries.find((s) => s.pocket.id === managePocketId) ?? null)
  );
  const managedRows = $derived(activeIncomeRows.filter((r) => r.pocketId === managePocketId));
  /** Remove a deposit from income (the editor's "Remove" → confirm). Excludes it. */
  function removeIncome(key: string): void {
    void updateIncomeAnnotation(key, { ignored: true });
  }
  /** "＋ Add income" from a pocket sheet → the income quick-add. */
  function addIncomeFromPocket(): void {
    managePocketId = null;
    quickAddType = 'income';
    quickAddOpen = true;
  }
  /** Persist a per-transaction edit from the income sheet (rename / not-income
   *  / exclude). Mirrors the transactions page: setAnnotation → prune → save. */
  async function updateIncomeAnnotation(
    key: string,
    patch: Partial<TransactionAnnotation>
  ): Promise<void> {
    const next = setAnnotation(new Map(Object.entries(cat.annotations)), key, patch);
    const a = next.get(key);
    if (a !== undefined) {
      const pruned = pruneAnnotation(a);
      if (pruned === null) next.delete(key);
      else next.set(key, pruned);
    }
    cat = { ...cat, annotations: Object.fromEntries(next) };
    await saveCategorization(cat);
  }

  /** Previous month's leftover (income − spent), signed.  Drives the small
   *  "+₹X from April" / "−₹X from April" carry-forward line under the income
   *  sub-line on the box.  Returns 0n when there's no data for the prior month
   *  (or its income/spend net is exactly zero) so the line stays hidden. */
  // Carry-forward derived values were removed when the "(FYI — not added in)"
  // chip was killed in the locked v1 hero redesign.  Kept the source comment
  // here so future me knows where to look if the chip is ever re-introduced.

  // "Spent today so far" — current-day burn.  Shown ONLY on the current month
  // (the chip is meaningless when browsing past months); hidden when 0 so the
  // first quiet day of the month doesn't look like a UI bug.  Sums every
  // outflow row whose posted_date is exactly todayIso, ignoring transfers and
  // user-ignored rows (matches the budget box's "Spent" semantics).
  const spentTodayMinor = $derived.by<bigint>(() => {
    if (activeMonth !== currentMonth) return 0n;
    let total = 0n;
    for (const r of allDetailed) {
      if (r.posted_date === todayIso && r.amount_minor < 0n && !r.ignored) {
        total += -r.amount_minor;
      }
    }
    return total;
  });
  const txnsTodayCount = $derived.by<number>(() => {
    if (activeMonth !== currentMonth) return 0;
    let n = 0;
    for (const r of allDetailed) {
      if (r.posted_date === todayIso && r.amount_minor < 0n && !r.ignored) n++;
    }
    return n;
  });

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

<main class="mx-auto max-w-5xl px-4 sm:px-6 py-8">
  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else if !hasData}
    <!-- PocketCards carries its own ◀ pill ▶ widget — no outer MonthSlider needed. -->
    <PocketCards
      summaries={activePocketSummaries}
      monthLabel={activeMonthLabel}
      onPrevMonth={prevMonth}
      onNextMonth={nextMonth}
      canPrev={canPrevMonth}
      canNext={canNextMonth}
      onLabelClick={() => (pickerOpen = true)}
      onManage={(id) => (managePocketId = id)}
      onEdit={() => (pocketEditOpen = true)}
    />

    <div class="card rise mt-4 p-8 text-center">
      <p class="text-sm" style:color="var(--color-muted)">
        Nothing here yet. Tap the <strong>+</strong> tab below to log your first expense, or
        <a href="/" style:color="var(--color-accent)">drop a PDF</a> if you have a statement.
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
          <strong>{needsReview}</strong>
          {needsReview === 1 ? 'transaction needs' : 'transactions need'} a category
        </span>
        <span
          class="rounded-full px-3 py-1 text-sm font-medium"
          style="background-image: var(--grad-primary); color: var(--color-accent-fg);"
        >
          Review →
        </span>
      </a>
    {/if}

    {#if needsPaycheckSetup}
      <!-- One-time paycheck setup: we detected a biweekly cadence but the user
           hasn't told us which month their paychecks fund. -->
      <button
        type="button"
        class="card rise mb-4 flex w-full items-center justify-between gap-3 p-4 text-left"
        style="background-image: linear-gradient(to right, color-mix(in oklab, var(--color-success) 12%, transparent), transparent);"
        onclick={() => (paycheckConfirmOpen = true)}
      >
        <span class="text-sm">
          💵 We found <strong>{detectedPaychecks.length} paychecks</strong>. Tell us which month
          they fund so your Paychecks box is spot-on.
        </span>
        <span
          class="flex-none rounded-full px-3 py-1 text-sm font-medium"
          style="background-image: var(--grad-primary); color: var(--color-accent-fg);"
        >
          Set up →
        </span>
      </button>
    {/if}

    <!-- PocketCards carries its own ◀ pill ▶ widget — no outer MonthSlider needed. -->
    <PocketCards
      summaries={activePocketSummaries}
      monthLabel={activeMonthLabel}
      onPrevMonth={prevMonth}
      onNextMonth={nextMonth}
      canPrev={canPrevMonth}
      canNext={canNextMonth}
      onLabelClick={() => (pickerOpen = true)}
      onManage={(id) => (managePocketId = id)}
      onEdit={() => (pocketEditOpen = true)}
    />

    {#if spentTodayMinor > 0n}
      <!-- "Spent today so far" — current-day burn chip.  Shown only on the
           current month and only when there's spend today, so the first quiet
           morning of a month doesn't render a "₹0 today" chip (which Murali's
           round-3 feedback called "demoralising negative reinforcement"). -->
      <a
        href={`/transactions?date_from=${todayIso}&date_to=${todayIso}`}
        class="card card-hover rise mt-3 flex items-center justify-between gap-3 p-3"
        style="animation-delay: 30ms;"
      >
        <div class="flex items-center gap-3">
          <span
            class="inline-flex h-9 w-9 items-center justify-center rounded-full text-base"
            style="background-color: var(--color-elevated);"
            aria-hidden="true">🕒</span
          >
          <div class="min-w-0">
            <p class="text-xs" style:color="var(--color-muted)">Spent today so far</p>
            <p class="num text-base font-semibold">
              {formatMoney(spentTodayMinor)}
              <span class="ml-1 text-xs font-normal" style:color="var(--color-muted)">
                · {txnsTodayCount} txn{txnsTodayCount === 1 ? '' : 's'}
              </span>
            </p>
          </div>
        </div>
        <span class="text-sm" style:color="var(--color-accent)">View →</span>
      </a>
    {/if}

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
        <a
          href={`/transactions?month=${activeMonth}`}
          class="text-xs"
          style:color="var(--color-accent)">See all →</a
        >
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
              <CategoryIcon
                icon={categoryIconName(r.category_id ? catName(r.category_id) : r.description)}
                {color}
                tint
              />
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
    todayMonth={currentMonth}
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
    pockets={activePockets}
    accounts={accountList}
    onClose={() => (quickAddOpen = false)}
    onSaved={refreshAfterSave}
    onCreateCategory={handleCreateCategory}
    onDeleteCategory={handleDeleteCategory}
    onRenameCategory={handleRenameCategory}
  />

  <!-- Per-pocket "manage" sheet — opens from a pocket card's "manage ›". Lists
       only that pocket's deposits, each editable in the redesigned IncomeEditSheet. -->
  <PocketManageSheet
    open={managePocketId !== null}
    summary={managedSummary}
    monthLabel={activeMonthLabel}
    rows={managedRows}
    annotations={cat.annotations}
    pockets={activePockets}
    onUpdate={updateIncomeAnnotation}
    onRemove={removeIncome}
    onAddIncome={addIncomeFromPocket}
    onClose={() => (managePocketId = null)}
  />

  <!-- One-time paycheck-window confirm (which month your paychecks fund). -->
  <PaycheckConfirmSheet
    open={paycheckConfirmOpen}
    paychecks={detectedPaychecks}
    onSave={savePaycheckAnchor}
    onClose={() => (paycheckConfirmOpen = false)}
  />

  <!-- Edit income boxes (add / rename / safe-delete = move transactions). -->
  <PocketEditSheet
    open={pocketEditOpen}
    pockets={activePockets}
    counts={pocketCounts}
    onSave={savePockets}
    onDelete={deletePocketReassign}
    onClose={() => (pocketEditOpen = false)}
  />

  <!-- Save-confirmation toast — shows briefly after a manual transaction is
       added, with explicit "I'll remember this" framing so the user knows the
       Bayes classifier just got another training sample. -->
  {#if saveToast !== null}
    <div class="save-toast" role="status" aria-live="polite">{saveToast}</div>
  {/if}

  <!-- The floating "+" FAB was removed: the universal "Add a transaction"
       affordance now lives in the bottom tab-bar's center button (locked
       design v1).  No more FAB / tab-bar collision. -->
</main>

<style>
  /* FAB removed (locked design v1) — center "+" lives in the tab bar now. */
  .save-toast {
    position: fixed;
    z-index: 60;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(158px + env(safe-area-inset-bottom));
    background: var(--color-text);
    color: var(--color-bg);
    border-radius: 999px;
    padding: 0.55rem 1.05rem;
    font-size: 0.85rem;
    font-weight: 500;
    box-shadow: var(--shadow-md);
    animation: toast-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @media (min-width: 768px) {
    .save-toast {
      bottom: 100px;
      right: 28px;
      left: auto;
      transform: none;
    }
  }
  @keyframes toast-rise {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
</style>
