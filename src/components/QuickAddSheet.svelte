<script lang="ts">
  // Quick-add bottom sheet — opens from the home BudgetBox's "+ Add expense"
  // (and "+ Income") buttons, so adding a transaction never requires leaving
  // home.  Top of the sheet = a SMART natural-language field (parse "40 chai
  // today" with chrono-node + amount regex); the parsed result auto-fills the
  // structured form below so the user can verify or fix anything in one tap.
  // Category is settable at entry time, persisted via the categorization store.

  import { tick, untrack } from 'svelte';
  import { parseQuickAddText, type ParsedQuickAdd } from '$lib/app/nl-quick-add';
  import { guessCategoryId } from '$lib/app/category-guess';
  import { makeManualImport, newManualId, ManualEntryError } from '$lib/app/manual-entry';
  import { parseAmountToCents, CsvImportError } from '$lib/app/csv-import';
  import { addImport } from '$lib/db/store';
  import { saveCategorization } from '$lib/db/categorization-store';
  import {
    setManualCategory,
    transactionCategoryKey,
    type Category,
    type CategoryRule,
    type TransactionAnnotation
  } from '$lib/app/categorization';
  import { getDisplayCurrency, getDisplayCurrencySymbol, formatMoney } from '$lib/util/money';
  const currencySymbol = getDisplayCurrencySymbol();
  // INR users live in integer rupees (40, 250, 15000) — no decimals; USD/EUR
  // users expect cents (12.34).  Both NL-example and Amount placeholder follow.
  const isInr = currencySymbol === '₹';
  const amountPlaceholder = isInr ? '40' : '12.34';
  // Locale-appropriate everyday example.  Murali's round-5 callout: a Seattle
  // user with USD shouldn't see "chai" (the Indian vernacular) — that bumps
  // the "this app wasn't written for me" feeling.
  const expensePlaceholder = isInr ? '“₹40 chai today”' : '“12.50 coffee today”';
  const incomePlaceholder = isInr ? '“salary 50000 yesterday”' : '“paycheck 2150 last friday”';
  import { today } from '$lib/util/date';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';

  interface Props {
    open: boolean;
    initialType: 'expense' | 'income';
    categories: Category[];
    rules: CategoryRule[];
    annotations: Record<string, TransactionAnnotation>;
    accountSuggestions: string[];
    onClose: () => void;
    /** Called after a successful save so the parent can re-hydrate. */
    /** Called after a successful save.  `learned` is true when a category
     *  annotation was saved — the parent's toast uses this so it doesn't
     *  promise "I'll remember this" on a save with no category set. */
    onSaved: (info: { learned: boolean }) => void;
  }

  const {
    open,
    initialType,
    categories,
    rules,
    annotations,
    accountSuggestions,
    onClose,
    onSaved
  }: Props = $props();

  // ── Form state ─────────────────────────────────────────────────────────────
  let nlText = $state('');
  let parsed = $state<ParsedQuickAdd | null>(null);
  let date = $state(today());
  /** Optional HH:MM — when set, gets prefixed to the description on save so
   *  the time travels with the transaction without a schema change.  Empty
   *  string = no time recorded (the common case). */
  let time = $state('');
  let desc = $state('');
  let amount = $state('');
  let direction = $state<'expense' | 'income'>('expense');
  let account = $state('Cash');
  let categoryId = $state<string | null>(null);
  // Tracks whether the USER has explicitly picked a category — keeps the smart
  // auto-guess from overriding the user's choice as they keep typing.  Cleared
  // on every sheet open.
  let userTouchedCategory = $state(false);
  // Shows the "More categories" overflow row when the user has more than 5
  // categories.  Top 5 + Uncategorized + More = the chip row; the rest hide
  // here.  Bhargav's #1 quick-add complaint was the native <select>: chips
  // collapse the OS picker round-trip into one tap.
  let showMoreCats = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  /** Top 6 categories shown as chips (rest go under "More").  Stable order so
   *  muscle memory works — we just take the first 6 from the user's list. */
  const topCats = $derived(categories.slice(0, 6));
  const restCats = $derived(categories.slice(6));

  function pickCategory(id: string | null): void {
    categoryId = id;
    userTouchedCategory = true;
  }

  let nlInputEl = $state<HTMLInputElement | null>(null);

  // Reset every time the sheet opens.  Auto-focus the NL field so the user can
  // start typing the instant the sheet lands.
  $effect(() => {
    if (open) {
      untrack(() => {
        nlText = '';
        parsed = null;
        date = today();
        time = '';
        desc = '';
        amount = '';
        direction = initialType;
        account = initialType === 'income' ? 'Income' : 'Cash';
        categoryId = null;
        userTouchedCategory = false;
        saving = false;
        error = null;
      });
      void tick().then(() => nlInputEl?.focus());
    }
  });

  // Live parse as the user types.  Don't clobber an empty field — let users
  // skip the NL field entirely and fill the form by hand.
  $effect(() => {
    const trimmed = nlText.trim();
    if (trimmed.length === 0) {
      untrack(() => (parsed = null));
      return;
    }
    const p = parseQuickAddText(nlText, today());
    // Smart category guess from the description — user's own rules first, then a
    // small built-in keyword map (chai → Food, uber → Transport, …) resolved
    // against the user's actual category names.  Null when nothing fits.
    const guess = guessCategoryId(p.description, categories, rules);
    untrack(() => {
      parsed = p;
      date = p.date_iso;
      if (p.amount_minor !== null) amount = (Number(p.amount_minor) / 100).toFixed(2);
      desc = p.description;
      direction = p.direction;
      // Auto-fill the category from the guess UNLESS the user has explicitly
      // picked one — their choice always wins.
      if (!userTouchedCategory) categoryId = guess;
    });
  });

  async function save(): Promise<void> {
    error = null;
    saving = true;
    try {
      const mag = parseAmountToCents(amount, 1);
      const abs = mag < 0n ? -mag : mag;
      if (abs === 0n) {
        error = 'Enter an amount.';
        saving = false;
        return;
      }
      const signed = direction === 'expense' ? -abs : abs;
      // When the user fills the optional Time field, prepend "HH:MM · " to the
      // description so the time travels with the transaction without a schema
      // change.  Skipped when empty (the common case).
      const baseDesc = desc.trim() || (direction === 'income' ? 'Income' : 'Expense');
      const finalDesc = time && /^\d{2}:\d{2}$/.test(time) ? `${time} · ${baseDesc}` : baseDesc;
      const rec = makeManualImport(
        {
          posted_date: date,
          description: finalDesc,
          amount_minor: signed,
          account_nickname: account || (direction === 'income' ? 'Income' : 'Cash'),
          currency: getDisplayCurrency()
        },
        newManualId(),
        new Date().toISOString()
      );
      await addImport(rec);
      // Persist the category annotation if one was picked.  A manual import
      // always has exactly one transaction at index 0.
      if (categoryId !== null) {
        const key = transactionCategoryKey(rec.pdf_source_hash, 0);
        const next = setManualCategory(new Map(Object.entries(annotations)), key, categoryId);
        const nextAnnotations = Object.fromEntries(next);
        await saveCategorization({ categories, rules, annotations: nextAnnotations });
      }
      onSaved({ learned: categoryId !== null });
      onClose();
    } catch (e) {
      if (e instanceof ManualEntryError || e instanceof CsvImportError) error = e.message;
      else error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function onNlKey(e: KeyboardEvent): void {
    // Enter in the NL field jumps to save — but only if we already have an
    // amount, so an empty Enter doesn't silently fail.
    if (e.key === 'Enter' && amount.trim().length > 0) {
      e.preventDefault();
      void save();
    }
  }

  const TODAY_STR = today();
  function relativeDateLabel(iso: string): string {
    if (iso === TODAY_STR) return 'today';
    // "yesterday" / "tomorrow" relative labels for the parse hint.
    const d = new Date(`${iso}T12:00:00`);
    const todayD = new Date(`${TODAY_STR}T12:00:00`);
    const diffDays = Math.round((d.getTime() - todayD.getTime()) / 86_400_000);
    if (diffDays === -1) return 'yesterday';
    if (diffDays === 1) return 'tomorrow';
    return iso;
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Quick add transaction">
    <div class="grab"></div>
    <div class="header">
      <h2 class="title">
        {direction === 'income' ? 'Add income' : 'Add expense'}
      </h2>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <label class="block">
      <span class="label-text">Type it</span>
      <input
        type="text"
        bind:value={nlText}
        bind:this={nlInputEl}
        placeholder={direction === 'income' ? incomePlaceholder : expensePlaceholder}
        class="nl-input"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        onkeydown={onNlKey}
      />
      {#if parsed !== null && (parsed.amount_minor !== null || parsed.description.length > 0)}
        <p class="parse-hint">
          <span class="num font-semibold">
            {parsed.amount_minor !== null ? formatMoney(parsed.amount_minor) : '—'}
          </span>
          <span class="dot">·</span>
          <span>{relativeDateLabel(parsed.date_iso)}</span>
          <span class="dot">·</span>
          <span class="tone">{parsed.direction === 'income' ? 'income' : 'expense'}</span>
          {#if parsed.description}
            <span class="dot">·</span>
            <span class="parse-desc">{parsed.description}</span>
          {/if}
        </p>
      {/if}
    </label>

    <div class="grid">
      <div class="block">
        <span class="label-text">Date · Time <span class="optional">(time optional)</span></span>
        <div class="date-time-row">
          <input type="date" bind:value={date} class="field" aria-label="Date" />
          <input
            type="time"
            bind:value={time}
            class="field time-field"
            aria-label="Time (optional)"
          />
        </div>
      </div>
      <label class="block">
        <span class="label-text">Account</span>
        <input
          type="text"
          list="qa-account-list"
          bind:value={account}
          class="field"
          placeholder={direction === 'income' ? 'Income' : 'Cash'}
        />
        <datalist id="qa-account-list">
          {#each accountSuggestions as a (a)}
            <option value={a}></option>
          {/each}
        </datalist>
      </label>
      <label class="block col-span-2">
        <span class="label-text">Description</span>
        <input
          type="text"
          bind:value={desc}
          class="field"
          placeholder={direction === 'income' ? 'Source (e.g. Salary, Dad)' : 'What did you buy?'}
        />
      </label>
      <label class="block">
        <span class="label-text">Amount</span>
        <input
          type="text"
          inputmode="decimal"
          bind:value={amount}
          class="field num"
          placeholder={amountPlaceholder}
        />
      </label>
      <div class="block">
        <span class="label-text">Type</span>
        <div class="type-toggle">
          {#each [{ v: 'expense', l: 'Expense' }, { v: 'income', l: 'Income' }] as opt (opt.v)}
            {@const active = direction === opt.v}
            <button
              type="button"
              class="type-opt"
              class:active
              onclick={() => (direction = opt.v as 'expense' | 'income')}
            >
              {opt.l}
            </button>
          {/each}
        </div>
      </div>
      <div class="block col-span-2">
        <span class="label-text">Category</span>
        <!-- Category chips: 1-tap selection.  Replaced the native <select> (Bhargav:
             "death by OS picker on Android"; Murali: "iOS wheel picker eats the
             screen").  Top 6 are visible; "More" reveals the rest inline. -->
        <div class="chip-row">
          <button
            type="button"
            class="cat-chip"
            class:active={categoryId === null}
            onclick={() => pickCategory(null)}
          >
            <span class="cat-dot" style:background-color="var(--color-muted)"></span>
            <span class="cat-name">Uncategorized</span>
          </button>
          {#each topCats as c (c.id)}
            {@const isActive = categoryId === c.id}
            {@const isAuto = isActive && !userTouchedCategory}
            <button
              type="button"
              class="cat-chip"
              class:active={isActive}
              onclick={() => pickCategory(c.id)}
              title={isAuto ? `${c.name} — auto-suggested from your text` : c.name}
            >
              <span class="cat-icon">
                <CategoryIcon icon={categoryIconName(c.name)} color={categoryColor(c.id)} tint />
              </span>
              <span class="cat-name">{c.name}</span>
              {#if isAuto}
                <span class="auto-badge">auto</span>
              {/if}
            </button>
          {/each}
          {#if restCats.length > 0}
            <button
              type="button"
              class="cat-chip cat-more"
              class:active={showMoreCats}
              onclick={() => (showMoreCats = !showMoreCats)}
              aria-expanded={showMoreCats}
            >
              {showMoreCats ? '✕ Close' : `+${restCats.length} more`}
            </button>
          {/if}
        </div>
        {#if showMoreCats && restCats.length > 0}
          <div class="chip-row chip-row-more">
            {#each restCats as c (c.id)}
              {@const isActive = categoryId === c.id}
              <button
                type="button"
                class="cat-chip"
                class:active={isActive}
                onclick={() => {
                  pickCategory(c.id);
                  showMoreCats = false;
                }}
              >
                <span class="cat-icon">
                  <CategoryIcon icon={categoryIconName(c.name)} color={categoryColor(c.id)} tint />
                </span>
                <span class="cat-name">{c.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn btn-primary save-btn" onclick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
    animation: fade 0.2s ease both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 50;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    animation: rise 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-height: 92dvh;
    overflow-y: auto;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.85rem;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.85rem;
  }
  .title {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .close-btn {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    color: var(--color-muted);
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.16s ease,
      color 0.16s ease;
  }
  .close-btn:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }
  .block {
    display: block;
    width: 100%;
  }
  .label-text {
    display: block;
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--color-muted);
    margin-bottom: 0.35rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .nl-input {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    border-radius: 14px;
    padding: 0.85rem 0.95rem;
    font-size: 1rem;
    color: var(--color-text);
    transition:
      border-color 0.16s ease,
      background 0.16s ease,
      box-shadow 0.16s ease;
  }
  .nl-input:focus {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-surface);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--color-accent) 14%, transparent);
  }
  .parse-hint {
    margin-top: 0.45rem;
    font-size: 0.8rem;
    color: var(--color-muted);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .parse-hint .num {
    color: var(--color-text);
  }
  .parse-hint .tone {
    color: var(--color-accent);
    font-weight: 500;
  }
  .parse-hint .dot {
    opacity: 0.55;
  }
  .parse-desc {
    color: var(--color-text);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .col-span-2 {
    grid-column: span 2;
  }
  .field {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: 10px;
    padding: 0.6rem 0.7rem;
    font-size: 0.92rem;
  }
  .field:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .date-time-row {
    display: flex;
    gap: 0.4rem;
  }
  .date-time-row .field {
    flex: 1;
    min-width: 0;
  }
  .time-field {
    max-width: 9rem;
  }
  .optional {
    color: var(--color-muted);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .type-toggle {
    display: flex;
    gap: 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.2rem;
    background: var(--color-bg);
  }
  .type-opt {
    flex: 1;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--color-muted);
    background: transparent;
    border: 0;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      color 0.16s ease;
  }
  .type-opt.active {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
  }
  /* ── Category chips ───────────────────────────────────────────────────── */
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip-row-more {
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px dashed var(--color-border);
  }
  .cat-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    color: var(--color-text);
    padding: 0.42rem 0.7rem 0.42rem 0.55rem;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      transform 0.12s ease,
      box-shadow 0.16s ease;
  }
  .cat-chip:hover {
    background: var(--color-surface-hover);
  }
  .cat-chip:active {
    transform: scale(0.96);
  }
  .cat-chip.active {
    background: var(--color-accent-soft);
    border-color: var(--color-accent);
    color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-accent) 22%, transparent);
  }
  .cat-icon {
    display: inline-flex;
    align-items: center;
  }
  .cat-dot {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    display: inline-block;
  }
  .cat-name {
    line-height: 1;
  }
  .auto-badge {
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.1rem 0.35rem;
    border-radius: 6px;
    background: color-mix(in oklab, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
  }
  .cat-more {
    background: transparent;
    color: var(--color-muted);
    font-weight: 600;
  }
  .cat-more.active {
    background: var(--color-elevated);
    border-color: var(--color-border);
    color: var(--color-text);
    box-shadow: none;
  }
  .error {
    margin-top: 0.7rem;
    color: var(--color-danger);
    font-size: 0.85rem;
  }
  .actions {
    margin-top: 1rem;
    display: flex;
    gap: 0.6rem;
  }
  .save-btn {
    flex: 1;
  }
</style>
