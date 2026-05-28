<script lang="ts">
  // Quick-add bottom sheet — compact one-page form (locked design v1.1).
  // Opens from the bottom-tab "+ Add" → AddSheet → here, presets to expense /
  // income / transfer.  The entire form fits inside the sheet without
  // scrolling.  Smart NL parsing lives on the Description field — typing
  // "₹40 chai today" still auto-fills amount + date + category.
  //
  // Category lives behind a "▾" button that opens CategoryPicker (popover
  // with search + ★ favorites + full list).  Account is a native datalist.

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
  import { getDisplayCurrency, getDisplayCurrencySymbol } from '$lib/util/money';
  import { today } from '$lib/util/date';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import CategoryPicker from '$components/CategoryPicker.svelte';

  const currencySymbol = getDisplayCurrencySymbol();
  const isInr = currencySymbol === '₹';
  const amountPlaceholder = isInr ? '40' : '12.34';
  const expensePlaceholder = isInr ? '“₹40 chai today”' : '“12.50 coffee today”';
  const incomePlaceholder = isInr ? '“salary 50000 yesterday”' : '“paycheck 2150 last friday”';

  type Direction = 'expense' | 'income' | 'transfer';

  interface Props {
    open: boolean;
    /** 'expense' | 'income' | 'transfer' — preset from the AddSheet pick. */
    initialType: Direction;
    categories: Category[];
    rules: CategoryRule[];
    annotations: Record<string, TransactionAnnotation>;
    accountSuggestions: string[];
    onClose: () => void;
    /** `learned` is true when a category annotation was saved. */
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
  let date = $state(today());
  let time = $state('');
  let desc = $state('');
  let amount = $state('');
  let direction = $state<Direction>('expense');
  let account = $state('Cash');
  let categoryId = $state<string | null>(null);
  let userTouchedCategory = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let pickerOpen = $state(false);

  function pickCategory(id: string | null): void {
    categoryId = id;
    userTouchedCategory = true;
  }

  let descInputEl = $state<HTMLInputElement | null>(null);
  let amountInputEl = $state<HTMLInputElement | null>(null);

  // Reset every time the sheet opens.  Auto-focus the Description field so
  // the smart NL parser is one tap away.
  $effect(() => {
    if (open) {
      untrack(() => {
        date = today();
        time = '';
        desc = '';
        amount = '';
        direction = initialType;
        account =
          initialType === 'income' ? 'Income' : initialType === 'transfer' ? 'Transfer' : 'Cash';
        categoryId = null;
        userTouchedCategory = false;
        saving = false;
        error = null;
      });
      void tick().then(() => descInputEl?.focus());
    }
  });

  // Live parse the Description as the user types — pulls amount + date out of
  // "₹40 chai today" and auto-suggests a category.
  $effect(() => {
    const trimmed = desc.trim();
    if (trimmed.length === 0) return;
    const p: ParsedQuickAdd = parseQuickAddText(desc, today());
    const guess = guessCategoryId(p.description, categories, rules);
    untrack(() => {
      if (p.date_iso !== today()) date = p.date_iso;
      if (p.amount_minor !== null && amount.trim() === '') {
        amount = (Number(p.amount_minor) / 100).toFixed(isInr ? 0 : 2);
      }
      // Only switch direction when the parser is confident (text actually
      // contains an income word).  Otherwise honour the user's preset.
      if (p.direction === 'income' && direction === 'expense') direction = 'income';
      if (!userTouchedCategory && guess !== null) categoryId = guess;
    });
  });

  const selectedCategoryName = $derived.by(() => {
    if (categoryId === null) return 'Uncategorized';
    return categories.find((c) => c.id === categoryId)?.name ?? 'Uncategorized';
  });
  const selectedCategoryColor = $derived.by(() =>
    categoryId === null ? 'var(--color-muted)' : categoryColor(categoryId)
  );

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
      // Expense / Transfer = outflow (negative); Income = inflow.
      const signed = direction === 'income' ? abs : -abs;
      const baseDesc = desc.trim() || direction.charAt(0).toUpperCase() + direction.slice(1);
      const finalDesc = time && /^\d{2}:\d{2}$/.test(time) ? `${time} · ${baseDesc}` : baseDesc;
      const accountFinal =
        account ||
        (direction === 'income' ? 'Income' : direction === 'transfer' ? 'Transfer' : 'Cash');
      const rec = makeManualImport(
        {
          posted_date: date,
          description: finalDesc,
          amount_minor: signed,
          account_nickname: accountFinal,
          currency: getDisplayCurrency()
        },
        newManualId(),
        new Date().toISOString()
      );
      await addImport(rec);
      // Persist category + (when transfer) flow_intent override.
      const key = transactionCategoryKey(rec.pdf_source_hash, 0);
      if (categoryId !== null || direction === 'transfer') {
        let map = new Map(Object.entries(annotations));
        if (categoryId !== null) {
          map = setManualCategory(map, key, categoryId);
        }
        if (direction === 'transfer') {
          // Tag the saved row so spendableFlowByMonth excludes it from Spent.
          const prior = map.get(key) ?? { category_id: null, source: 'manual' as const };
          map.set(key, { ...prior, flow_intent: 'transfer_self' });
        }
        await saveCategorization({
          categories,
          rules,
          annotations: Object.fromEntries(map)
        });
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

  function onDescKey(e: KeyboardEvent): void {
    // Enter in the description field jumps to amount if empty, else saves.
    if (e.key === 'Enter') {
      if (amount.trim() === '') {
        e.preventDefault();
        amountInputEl?.focus();
      } else {
        e.preventDefault();
        void save();
      }
    }
  }

  const title = $derived(
    direction === 'income'
      ? 'Add income'
      : direction === 'transfer'
        ? 'Add transfer'
        : 'Add expense'
  );

  const descPlaceholder = $derived(
    direction === 'income'
      ? incomePlaceholder
      : direction === 'transfer'
        ? '“200 to savings”'
        : expensePlaceholder
  );
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
    <div class="grab"></div>

    <div class="header">
      <h2 class="title">{title}</h2>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <!-- Type toggle -->
    <div class="type-toggle">
      {#each [{ v: 'expense', l: 'Expense' }, { v: 'income', l: 'Income' }, { v: 'transfer', l: 'Transfer' }] as opt (opt.v)}
        {@const active = direction === opt.v}
        <button
          type="button"
          class="type-opt"
          class:active
          onclick={() => (direction = opt.v as Direction)}
        >
          {opt.l}
        </button>
      {/each}
    </div>

    <!-- Amount (big & prominent) -->
    <div class="amount-row">
      <span class="cur">{currencySymbol}</span>
      <input
        type="text"
        inputmode="decimal"
        bind:value={amount}
        bind:this={amountInputEl}
        placeholder={amountPlaceholder}
        class="amount num"
        aria-label="Amount"
      />
    </div>

    <!-- Description with smart NL parsing -->
    <label class="block">
      <span class="lbl">Description</span>
      <input
        type="text"
        bind:value={desc}
        bind:this={descInputEl}
        placeholder={descPlaceholder}
        class="field"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onDescKey}
      />
    </label>

    <!-- Category dropdown trigger (opens CategoryPicker popover) -->
    <div class="row-2col">
      <button type="button" class="dd-btn" onclick={() => (pickerOpen = true)}>
        <span class="dd-icon">
          {#if categoryId === null}
            <span class="dot" style:background-color={selectedCategoryColor}></span>
          {:else}
            <CategoryIcon
              icon={categoryIconName(selectedCategoryName)}
              color={selectedCategoryColor}
              tint
            />
          {/if}
        </span>
        <span class="dd-label">
          <span class="lbl">Category</span>
          <span class="dd-value">{selectedCategoryName}</span>
        </span>
        <span class="dd-chev" aria-hidden="true">▾</span>
      </button>

      <label class="dd-btn dd-account">
        <span class="dd-icon">💳</span>
        <span class="dd-label">
          <span class="lbl">Account</span>
          <input
            type="text"
            list="qa-account-list"
            bind:value={account}
            class="dd-input"
            placeholder={direction === 'income'
              ? 'Income'
              : direction === 'transfer'
                ? 'Transfer'
                : 'Cash'}
          />
        </span>
        <datalist id="qa-account-list">
          {#each accountSuggestions as a (a)}
            <option value={a}></option>
          {/each}
        </datalist>
      </label>
    </div>

    <!-- Date + Time -->
    <div class="row-2col">
      <label class="block">
        <span class="lbl">Date</span>
        <input type="date" bind:value={date} class="field" />
      </label>
      <label class="block">
        <span class="lbl">Time <span class="opt">(optional)</span></span>
        <input type="time" bind:value={time} class="field" />
      </label>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <button type="button" class="save-btn" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>

  <!-- Category picker popover (mounted on top of this sheet) -->
  <CategoryPicker
    open={pickerOpen}
    {categories}
    selectedId={categoryId}
    onSelect={pickCategory}
    onClose={() => (pickerOpen = false)}
  />
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
    padding: 0.45rem 1.05rem calc(0.9rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    animation: rise 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
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
    margin: 0.2rem auto 0.2rem;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .close-btn {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .close-btn:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  /* ── Type toggle (segmented control) ─────────────────────────── */
  .type-toggle {
    display: flex;
    gap: 0.2rem;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.2rem;
    background: var(--color-bg);
  }
  .type-opt {
    flex: 1;
    border-radius: 9px;
    padding: 0.45rem 0.4rem;
    font-size: 0.84rem;
    font-weight: 600;
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

  /* ── Amount (big & prominent) ────────────────────────────────── */
  .amount-row {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 0.6rem 1rem;
  }
  .cur {
    color: var(--color-muted);
    font-size: 1.4rem;
    font-weight: 600;
    line-height: 1;
  }
  .amount {
    flex: 1;
    border: 0;
    background: transparent;
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-text);
    letter-spacing: -0.02em;
    padding: 0;
    outline: none;
    min-width: 0;
  }
  .amount::placeholder {
    color: var(--color-muted);
    opacity: 0.5;
    font-weight: 600;
  }

  /* ── Generic labelled block + field ───────────────────────────── */
  .block {
    display: flex;
    flex-direction: column;
  }
  .lbl {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--color-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 0.25rem;
  }
  .opt {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .field {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    font-size: 0.93rem;
  }
  .field:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
  }

  /* ── Dropdown-style trigger button (Category / Account) ──────── */
  .dd-btn {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    border-radius: 12px;
    padding: 0.55rem 0.65rem;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 0.14s ease,
      border-color 0.14s ease;
    min-width: 0;
  }
  .dd-btn:hover {
    background: var(--color-surface-hover);
  }
  .dd-icon {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 0.95rem;
  }
  .dd-icon .dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    display: inline-block;
  }
  .dd-label {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .dd-label .lbl {
    margin-bottom: 0;
    font-size: 0.6rem;
  }
  .dd-value {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--color-text);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dd-input {
    border: 0;
    background: transparent;
    padding: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--color-text);
    width: 100%;
    outline: none;
  }
  .dd-input::placeholder {
    color: var(--color-muted);
    font-weight: 500;
  }
  .dd-chev {
    color: var(--color-muted);
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .dd-account {
    cursor: text;
  }

  .error {
    color: var(--color-danger);
    font-size: 0.82rem;
    margin: 0;
  }

  .save-btn {
    margin-top: 0.25rem;
    width: 100%;
    padding: 0.85rem;
    border-radius: 14px;
    border: 0;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      filter 0.16s ease,
      transform 0.12s ease;
  }
  .save-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .save-btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .save-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
