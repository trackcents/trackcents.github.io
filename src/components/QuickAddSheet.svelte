<script lang="ts">
  // Quick-add bottom sheet — compact one-page form (locked design v1.2).
  // Opens from the bottom-tab "+" directly (the intermediate AddSheet was
  // killed in Batch A — the user's segmented Expense/Income/Transfer
  // control at the top is enough).  The entire form fits inside the sheet
  // without scrolling.  Smart NL parsing lives on the Description field —
  // typing "ate biryani on 23rd may 03:40 PM for 450" still auto-fills
  // amount + date + TIME + category.
  //
  // Batch A additions:
  //   • Account is now a full combobox (AccountPicker) — typed names get
  //     created + remembered, default = last used.
  //   • Notes textarea below Description so future you can find out why.
  //   • Time autofills from the NL parser when the user typed one.
  //   • Category picker can create + delete categories inline.

  import { untrack } from 'svelte';
  import { parseQuickAddText, type ParsedQuickAdd } from '$lib/app/nl-quick-add';
  import { guessCategoryId } from '$lib/app/category-guess';
  import { makeManualImport, newManualId, ManualEntryError } from '$lib/app/manual-entry';
  import { parseAmountToCents, CsvImportError } from '$lib/app/csv-import';
  import { addImport } from '$lib/db/store';
  import { saveCategorization } from '$lib/db/categorization-store';
  import {
    setManualCategory,
    setAnnotation,
    transactionCategoryKey,
    type Category,
    type CategoryRule,
    type TransactionAnnotation
  } from '$lib/app/categorization';
  import { getDisplayCurrency, getDisplayCurrencySymbol } from '$lib/util/money';
  import { today } from '$lib/util/date';
  import {
    loadLastUsedAccount,
    rememberManualAccount,
    saveLastUsedAccount
  } from '$lib/app/accounts';
  import { accountDisplayName } from '$lib/app/account-nicknames';
  import { categoryColor, categoryIconName, type IconKey } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import CategoryPicker from '$components/CategoryPicker.svelte';
  import AccountPicker from '$components/AccountPicker.svelte';
  import TimeInput from '$components/TimeInput.svelte';

  const currencySymbol = getDisplayCurrencySymbol();
  const isInr = currencySymbol === '₹';
  const amountPlaceholder = isInr ? '40' : '12.34';
  const expensePlaceholder = isInr ? '“₹40 chai today”' : '“12.50 coffee today”';
  const incomePlaceholder = isInr ? '“salary 50000 yesterday”' : '“paycheck 2150 last friday”';

  type Direction = 'expense' | 'income' | 'transfer';

  interface Props {
    open: boolean;
    /** 'expense' | 'income' | 'transfer' — preset from the "+" tab. */
    initialType: Direction;
    categories: Category[];
    rules: CategoryRule[];
    annotations: Record<string, TransactionAnnotation>;
    /** All known accounts (Cash + imported + manually added). */
    accounts: string[];
    onClose: () => void;
    /** `learned` is true when a category annotation was saved. */
    onSaved: (info: { learned: boolean }) => void;
    /** Create a new category (parent persists). */
    onCreateCategory?: ((name: string) => Promise<string> | string) | undefined;
    /** Delete a category (parent persists). */
    onDeleteCategory?: ((id: string) => Promise<void> | void) | undefined;
    /** Rename + re-icon a category (parent persists). */
    onRenameCategory?:
      | ((id: string, patch: { name: string; icon: string }) => Promise<void> | void)
      | undefined;
  }

  const {
    open,
    initialType,
    categories,
    rules,
    annotations,
    accounts,
    onClose,
    onSaved,
    onCreateCategory,
    onDeleteCategory,
    onRenameCategory
  }: Props = $props();

  // ── Form state ─────────────────────────────────────────────────────────────
  let date = $state(today());
  /** Free-form time text the user typed.  We accept "10:30", "10:30 PM",
   *  "10pm", "22:30", etc.  Parsed to 24-hour HH:MM on save (see
   *  parseFreeFormTime). */
  let time = $state('');
  let desc = $state('');
  let note = $state('');
  let amount = $state('');
  let direction = $state<Direction>('expense');
  let account = $state('Cash');
  let categoryId = $state<string | null>(null);
  /** True only when the user EXPLICITLY picked a category via the picker.
   *  Bare auto-guesses don't flip this — so a later description change
   *  ("biryani" → "cab") refreshes the category to whatever the new
   *  description guesses to (or clears it).  Matches the way Amount/Date
   *  already behave; Hemanth's screenshot bug was that Category got
   *  stuck on the first guess and never refreshed when description
   *  changed.  Renamed from userTouchedCategory for clarity. */
  let userPickedCategory = $state(false);
  let userTouchedTime = $state(false);
  let userTouchedAccount = $state(false);
  /** Did the user manually edit the amount field?  Once true, the NL parser
   *  in the description no longer overrides what they typed. */
  let userTouchedAmount = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let pickerOpen = $state(false);
  let accountPickerOpen = $state(false);

  function pickCategory(id: string | null): void {
    categoryId = id;
    userPickedCategory = true;
  }

  /** Parse a free-form time string into 24-hour HH:MM.  Returns '' on
   *  empty input, null on unparseable.  Examples:
   *    "10:30"     -> "10:30"   (24h preserved)
   *    "10:30 AM"  -> "10:30"
   *    "10:30pm"   -> "22:30"
   *    "10pm"      -> "22:00"
   *    "22:30"     -> "22:30"
   *    "noon"      -> "12:00"
   *    "midnight"  -> "00:00"
   */
  function parseFreeFormTime(input: string): string | null {
    const s = input.trim().toLowerCase();
    if (s === '') return '';
    if (s === 'noon') return '12:00';
    if (s === 'midnight') return '00:00';
    const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/);
    if (!m) return null;
    let h = parseInt(m[1]!, 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3] ? m[3][0] : '';
    if (Number.isNaN(h) || Number.isNaN(min) || min < 0 || min > 59) return null;
    if (h < 0 || h > 23) return null;
    if (ap === 'a') {
      if (h === 12) h = 0;
    } else if (ap === 'p') {
      if (h < 12) h += 12;
    }
    if (h < 0 || h > 23) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  let amountInputEl = $state<HTMLInputElement | null>(null);

  /** Defaults to use whenever the sheet opens.  Direction-aware:
   *    expense  → last-used real account (or "Cash")
   *    income   → "Income"   (so transfers/income don't pollute "last used")
   *    transfer → "Transfer" */
  function defaultAccount(d: Direction): string {
    if (d === 'income') return 'Income';
    if (d === 'transfer') return 'Transfer';
    return loadLastUsedAccount() ?? 'Cash';
  }

  // Reset every time the sheet opens.  Deliberately DO NOT auto-focus any
  // input — auto-focus pops the soft keyboard on mobile, which covers half
  // the form and makes the "compact one-page" promise impossible to keep.
  $effect(() => {
    if (open) {
      untrack(() => {
        date = today();
        time = '';
        desc = '';
        note = '';
        amount = '';
        direction = initialType;
        account = defaultAccount(initialType);
        categoryId = null;
        userPickedCategory = false;
        userTouchedAmount = false;
        userTouchedTime = false;
        userTouchedAccount = false;
        saving = false;
        error = null;
      });
    }
  });

  // When the user switches direction (Expense / Income / Transfer), update
  // the default account label unless they've already typed something.
  $effect(() => {
    const d = direction;
    untrack(() => {
      if (!userTouchedAccount) account = defaultAccount(d);
    });
  });

  // Live parse the Description as the user types — pulls amount + date +
  // TIME + auto-suggests a category.  Until the user touches a field, the
  // NL parser keeps the form in sync with the description — INCLUDING
  // clearing values when the current parse no longer finds them.  The
  // earlier "only set when non-null" version was one-way: an intermediate
  // typo like "drank milkshake on 22nd may 7" briefly filled $7, and once
  // the final "75 dollars" landed in the date span the $7 stayed put
  // (Hemanth's screenshots: $22, $7, $34 all came from stale intermediate
  // parses).  The fix is to ALWAYS write the parser's view; the
  // userTouched* flags still protect a field once the user has typed
  // into it directly.
  $effect(() => {
    if (desc.trim().length === 0) {
      untrack(() => {
        if (!userTouchedAmount) amount = '';
        if (!userTouchedTime) time = '';
      });
      return;
    }
    const p: ParsedQuickAdd = parseQuickAddText(desc, today());
    const guess = guessCategoryId(p.description, categories, rules);
    untrack(() => {
      if (p.date_iso !== today()) date = p.date_iso;
      if (!userTouchedAmount) {
        amount =
          p.amount_minor !== null ? (Number(p.amount_minor) / 100).toFixed(isInr ? 0 : 2) : '';
      }
      // Time: a parsed time in the description ALWAYS wins (it's the
      // newest user intent), even if they typed in TimeInput earlier.
      // When no time is in the description, only clear if the user
      // hasn't typed manually — so a user-typed "06:00" survives a
      // description with no time mention.  Hemanth's bug: time stuck
      // on a stale "05:46 PM" after backspacing biryani and re-typing
      // a fresh description with a new time.
      if (p.time_hhmm !== null) {
        time = p.time_hhmm;
      } else if (!userTouchedTime) {
        time = '';
      }
      if (p.direction === 'income' && direction === 'expense') direction = 'income';
      // Category: ALWAYS follow the new description guess (null clears
      // to Uncategorized) unless the user explicitly picked one via the
      // CategoryPicker.  Previously the guard skipped null guesses, so
      // an "auto Food from biryani" stayed Food forever after the user
      // backspaced + typed "cab".  Now category behaves like Amount /
      // Date — the description is the single source of truth until the
      // user actively picks.
      if (!userPickedCategory) categoryId = guess;
    });
  });

  const selectedCategory = $derived(
    categoryId === null ? null : (categories.find((c) => c.id === categoryId) ?? null)
  );
  const selectedCategoryName = $derived(selectedCategory?.name ?? 'Uncategorized');
  const selectedCategoryColor = $derived.by(() =>
    categoryId === null ? 'var(--color-muted)' : categoryColor(categoryId)
  );
  /** Selected category's icon — honours the user's override when set,
   *  else auto-maps from the name. */
  const selectedCategoryIcon = $derived<IconKey>(
    selectedCategory
      ? selectedCategory.icon && selectedCategory.icon.length > 0
        ? (selectedCategory.icon as IconKey)
        : categoryIconName(selectedCategory.name)
      : 'tag'
  );

  /** Account display name = nickname when set, else raw. */
  const accountLabel = $derived(accountDisplayName(account));

  /** Tx-count map keyed by category_id — drives the confirm-delete message
   *  in CategoryPicker so "Delete Food?" cites "12 transactions affected". */
  const txCountByCategoryId = $derived.by<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const a of Object.values(annotations)) {
      if (a.category_id !== null) m.set(a.category_id, (m.get(a.category_id) ?? 0) + 1);
    }
    return m;
  });

  async function handleCreateCategory(name: string): Promise<void> {
    if (onCreateCategory === undefined) return;
    const newId = await onCreateCategory(name);
    pickCategory(newId);
  }
  async function handleDeleteCategory(id: string): Promise<void> {
    if (onDeleteCategory === undefined) return;
    await onDeleteCategory(id);
    // If the deleted category was the one selected, clear the selection.
    if (categoryId === id) categoryId = null;
  }
  async function handleRenameCategoryInner(
    id: string,
    patch: { name: string; icon: string }
  ): Promise<void> {
    if (onRenameCategory === undefined) return;
    await onRenameCategory(id, patch);
  }

  function pickAccount(name: string): void {
    account = name;
    userTouchedAccount = true;
  }
  function createAccount(name: string): void {
    rememberManualAccount(name);
    account = name;
    userTouchedAccount = true;
  }

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
      const signed = direction === 'income' ? abs : -abs;
      const baseDesc = desc.trim() || direction.charAt(0).toUpperCase() + direction.slice(1);
      const parsedTime = parseFreeFormTime(time);
      const finalDesc = parsedTime && parsedTime !== '' ? `${parsedTime} · ${baseDesc}` : baseDesc;
      const accountFinal = account || defaultAccount(direction);
      // Remember real accounts (not the synthetic "Income"/"Transfer" labels)
      // so they appear in the picker + as the next default.  Bhargav adds
      // "HDFC UPI" once → next time it's the default.
      if (direction === 'expense') {
        rememberManualAccount(accountFinal);
        saveLastUsedAccount(accountFinal);
      }
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
      // Persist category + (when transfer) flow_intent override + note.
      const key = transactionCategoryKey(rec.pdf_source_hash, 0);
      const trimmedNote = note.trim();
      const needsAnnotationSave =
        categoryId !== null || direction === 'transfer' || trimmedNote.length > 0;
      if (needsAnnotationSave) {
        let map = new Map(Object.entries(annotations));
        if (categoryId !== null) {
          map = setManualCategory(map, key, categoryId);
        }
        if (trimmedNote.length > 0) {
          map = setAnnotation(map, key, { note: trimmedNote });
        }
        if (direction === 'transfer') {
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
  <button type="button" class="qas-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="qas-sheet" role="dialog" aria-modal="true" aria-label={title}>
    <div class="qas-grab"></div>

    <div class="qas-header">
      <h2 class="qas-title">{title}</h2>
      <button type="button" class="qas-close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <!-- Type toggle -->
    <div class="qas-type-toggle">
      {#each [{ v: 'expense', l: 'Expense' }, { v: 'income', l: 'Income' }, { v: 'transfer', l: 'Transfer' }] as opt (opt.v)}
        {@const active = direction === opt.v}
        <button
          type="button"
          class="qas-type-opt"
          class:active
          onclick={() => (direction = opt.v as Direction)}
        >
          {opt.l}
        </button>
      {/each}
    </div>

    <!-- Amount (big & prominent). -->
    <div class="qas-amount-row">
      <span class="qas-cur">{currencySymbol}</span>
      <input
        type="text"
        inputmode="decimal"
        bind:value={amount}
        bind:this={amountInputEl}
        placeholder={amountPlaceholder}
        class="qas-amount num"
        aria-label="Amount"
        oninput={() => (userTouchedAmount = true)}
        onfocus={() => (userTouchedAmount = true)}
      />
    </div>

    <!-- Description with smart NL parsing -->
    <label class="qas-block">
      <span class="qas-lbl">Description</span>
      <input
        type="text"
        bind:value={desc}
        placeholder={descPlaceholder}
        class="qas-field"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onDescKey}
      />
    </label>

    <!-- Category + Account triggers -->
    <div class="qas-row-2col">
      <button type="button" class="qas-dd-btn" onclick={() => (pickerOpen = true)}>
        <span class="qas-dd-icon">
          {#if categoryId === null}
            <span class="dot" style:background-color={selectedCategoryColor}></span>
          {:else}
            <CategoryIcon icon={selectedCategoryIcon} color={selectedCategoryColor} tint />
          {/if}
        </span>
        <span class="qas-dd-label">
          <span class="qas-lbl">Category</span>
          <span class="qas-dd-value">{selectedCategoryName}</span>
        </span>
        <span class="qas-dd-chev" aria-hidden="true">▾</span>
      </button>

      <button type="button" class="qas-dd-btn" onclick={() => (accountPickerOpen = true)}>
        <span class="qas-dd-icon">💳</span>
        <span class="qas-dd-label">
          <span class="qas-lbl">Account</span>
          <span class="qas-dd-value">{accountLabel}</span>
        </span>
        <span class="qas-dd-chev" aria-hidden="true">▾</span>
      </button>
    </div>

    <!-- Date + Time. -->
    <div class="qas-row-2col">
      <label class="qas-block">
        <span class="qas-lbl">Date</span>
        <input type="date" bind:value={date} class="qas-field" />
      </label>
      <div class="qas-block">
        <span class="qas-lbl">Time <span class="qas-opt">(optional)</span></span>
        <!-- Segmented HH : MM AM/PM control — no typing the colon, AM/PM is
             a tappable toggle.  Two-way bound to the 24-hour `time` string,
             which both the NL autofill and the save path already speak. -->
        <TimeInput bind:value={time} onUserEdit={() => (userTouchedTime = true)} />
      </div>
    </div>

    <!-- Notes — free-form, persisted as an annotation so you can find out
         later WHY this transaction matters. -->
    <label class="qas-block">
      <span class="qas-lbl">Notes <span class="qas-opt">(optional — for future you)</span></span>
      <textarea
        bind:value={note}
        placeholder="e.g. with Murali, paid for everyone"
        class="qas-field qas-notes"
        rows="2"
        autocomplete="off"
      ></textarea>
    </label>

    {#if error}
      <p class="qas-error">{error}</p>
    {/if}

    <button type="button" class="qas-save-btn" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>

  <!-- Category picker popover -->
  <CategoryPicker
    open={pickerOpen}
    {categories}
    selectedId={categoryId}
    {txCountByCategoryId}
    onSelect={pickCategory}
    onCreate={onCreateCategory !== undefined ? handleCreateCategory : undefined}
    onDelete={onDeleteCategory !== undefined ? handleDeleteCategory : undefined}
    onRename={onRenameCategory !== undefined ? handleRenameCategoryInner : undefined}
    onClose={() => (pickerOpen = false)}
  />

  <!-- Account picker popover -->
  <AccountPicker
    open={accountPickerOpen}
    {accounts}
    selected={account}
    onSelect={pickAccount}
    onCreate={createAccount}
    onClose={() => (accountPickerOpen = false)}
  />
{/if}

<style>
  .qas-backdrop {
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
  .qas-sheet {
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
    gap: 0.5rem;
    max-height: 95dvh;
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

  .qas-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.2rem auto 0.2rem;
  }
  .qas-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .qas-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .qas-close-btn {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .qas-close-btn:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  .qas-type-toggle {
    display: flex;
    gap: 0.2rem;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.2rem;
    background: var(--color-bg);
  }
  .qas-type-opt {
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
  .qas-type-opt.active {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
  }

  .qas-amount-row {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 0.6rem 1rem;
  }
  .qas-cur {
    color: var(--color-muted);
    font-size: 1.4rem;
    font-weight: 600;
    line-height: 1;
  }
  .qas-amount {
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
  .qas-amount::placeholder {
    color: var(--color-muted);
    opacity: 0.5;
    font-weight: 600;
  }

  .qas-block {
    display: flex;
    flex-direction: column;
  }
  .qas-lbl {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--color-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 0.25rem;
  }
  .qas-opt {
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .qas-field {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    font-size: 0.93rem;
    font-family: inherit;
  }
  .qas-field:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .qas-notes {
    resize: vertical;
    min-height: 2.4rem;
    max-height: 6rem;
    line-height: 1.4;
  }

  .qas-row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
  }

  .qas-dd-btn {
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
  .qas-dd-btn:hover {
    background: var(--color-surface-hover);
  }
  .qas-dd-icon {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 0.95rem;
  }
  .qas-dd-icon .dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    display: inline-block;
  }
  .qas-dd-label {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .qas-dd-label .qas-lbl {
    margin-bottom: 0;
    font-size: 0.6rem;
  }
  .qas-dd-value {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--color-text);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qas-dd-chev {
    color: var(--color-muted);
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .qas-error {
    color: var(--color-danger);
    font-size: 0.82rem;
    margin: 0;
  }

  .qas-save-btn {
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
  .qas-save-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .qas-save-btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .qas-save-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
