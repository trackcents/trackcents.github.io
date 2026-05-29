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
  import { guessAccount } from '$lib/app/account-guess';
  import { extractRulePattern, isDuplicateRule } from '$lib/app/rule-from-desc';
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
    /** `learned` is true when a category annotation was saved.  When the
     *  save ALSO created a learn-from-pick rule, `rulePattern` carries
     *  the pattern so the parent can show a "Tagged X → Food" toast. */
    onSaved: (info: { learned: boolean; rulePattern?: string | null }) => void;
    /** Create a new category (parent persists).  parent_id is set when
     *  the user adds a SUB-category under an existing parent. */
    onCreateCategory?: ((name: string, parentId?: string) => Promise<string> | string) | undefined;
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
  /** True once the user picks a date via the native date input.  Without
   *  this, the date sticks on an earlier-parsed value: typing "biryani
   *  may07th" set date=2026-05-07, backspacing + typing "ice cream"
   *  returned parser.date=today but the old code only OVERWROTE on
   *  non-today, so the form kept showing 2026-05-07 (Hemanth's screenshot
   *  showed 05/04/2026 after typing just "ice cream"). */
  let userTouchedDate = $state(false);
  /** Did the user manually edit the amount field?  Once true, the NL parser
   *  in the description no longer overrides what they typed. */
  let userTouchedAmount = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let pickerOpen = $state(false);
  let accountPickerOpen = $state(false);
  /** True when the soft keyboard is open.  Drives a `.keyboard-open`
   *  class on the sheet that compacts the form (hides the big title,
   *  hides Notes, tightens gaps) so Amount + Description + Category |
   *  Account + Date | Time are all reachable above the keyboard. */
  let keyboardOpen = $state(false);
  $effect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = (): void => {
      keyboardOpen = window.innerHeight - vv.height > 120;
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  });

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
        userTouchedDate = false;
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
        if (!userTouchedDate) date = today();
        if (!userPickedCategory) categoryId = null;
        if (!userTouchedAccount) account = defaultAccount(direction);
      });
      return;
    }
    const p: ParsedQuickAdd = parseQuickAddText(desc, today());
    const guess = guessCategoryId(p.description, categories, rules);
    untrack(() => {
      // Date follows the description on every change (like Amount), unless
      // the user manually picked one via the date input.  Earlier code only
      // wrote when parser returned non-today, so a "biryani may07th" set
      // date=2026-05-07 and then "ice cream" left date stuck at 05/07 —
      // even though the parser correctly reported today() for "ice cream".
      if (!userTouchedDate) date = p.date_iso;
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
      // Account auto-fill (Hemanth: "account should also fill as I type").
      // Match the typed text against the user's saved accounts; a match wins,
      // else fall back to the direction default — unless the user picked one.
      if (!userTouchedAccount) {
        account = guessAccount(desc, accounts) ?? defaultAccount(direction);
      }
    });
  });

  const selectedCategory = $derived(
    categoryId === null ? null : (categories.find((c) => c.id === categoryId) ?? null)
  );
  /** The PARENT of the form's effective categoryId.  When the user has
   *  picked a sub-category, the parent is selectedCategory.parent_id.
   *  When they've picked a top-level category, the parent IS that
   *  category.  When nothing is picked, null.  Drives the "Category"
   *  button's display name and the Sub-category button's parent-filter. */
  const effectiveParentId = $derived.by<string | null>(() => {
    if (selectedCategory === null) return null;
    if (selectedCategory.parent_id !== undefined && selectedCategory.parent_id.length > 0) {
      return selectedCategory.parent_id;
    }
    return selectedCategory.id;
  });
  const effectiveParent = $derived(
    effectiveParentId === null ? null : (categories.find((c) => c.id === effectiveParentId) ?? null)
  );
  /** When the form's categoryId points at a SUB, this is that sub.
   *  Otherwise null.  Drives the Sub-category button's label. */
  const effectiveSub = $derived.by(() => {
    if (
      selectedCategory === null ||
      selectedCategory.parent_id === undefined ||
      selectedCategory.parent_id.length === 0
    ) {
      return null;
    }
    return selectedCategory;
  });
  const selectedCategoryName = $derived(effectiveParent?.name ?? 'Uncategorized');
  const selectedCategoryColor = $derived.by(() =>
    effectiveParentId === null ? 'var(--color-muted)' : categoryColor(effectiveParentId)
  );
  /** Parent category's icon — drives the "Category" button.  When the
   *  user has picked a sub, the button still shows the PARENT icon
   *  (the sub identity is on the sub-button beside it). */
  const selectedCategoryIcon = $derived<IconKey>(
    effectiveParent
      ? effectiveParent.icon && effectiveParent.icon.length > 0
        ? (effectiveParent.icon as IconKey)
        : categoryIconName(effectiveParent.name)
      : 'tag'
  );
  // The dedicated Sub-category button (and its selectedSubIcon /
  // selectedSubColor derives) was removed when sub-cat went back to
  // being picked via the single Category dropdown's nested view.
  // effectiveSub is still kept to render the parent · child label.

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

  async function handleCreateCategory(name: string, parentId?: string): Promise<void> {
    if (onCreateCategory === undefined) return;
    const newId = await onCreateCategory(name, parentId);
    // Only select the new category when it was created at the top level
    // (via "+ Create" in the search row).  When the user added a SUB
    // from the picker's edit mode, they're still managing categories —
    // don't yank focus by silently picking + closing the sheet.
    if (parentId === undefined) pickCategory(newId);
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

      // ── Learn-from-pick (Hemanth: "if I select category to that, then
      //    from next time if I add that name again, the same category
      //    should be selected") ─────────────────────────────────────────
      //
      // When the user manually picked a category AND no existing rule
      // covers the description's cleaned merchant phrase, silently
      // create a user rule for next time.  Guard with:
      //   • userPickedCategory must be true (auto-guesses do NOT create
      //     rules — otherwise every entry would mint one)
      //   • extractRulePattern returns a non-null pattern (≥3 chars
      //     post-stripping of verbs/prepositions)
      //   • no duplicate rule already exists for this pattern+category
      let nextRules = rules;
      let learnedPattern: string | null = null;
      if (userPickedCategory && categoryId !== null && desc.trim().length > 0) {
        const cleaned = parseQuickAddText(desc, today()).description;
        const pattern = extractRulePattern(cleaned);
        if (pattern !== null && !isDuplicateRule(rules, pattern, categoryId)) {
          const ruleId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? `rule-${crypto.randomUUID()}`
              : `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          nextRules = [...rules, { id: ruleId, contains: pattern, category_id: categoryId }];
          learnedPattern = pattern;
        }
      }

      const needsAnnotationSave =
        categoryId !== null ||
        direction === 'transfer' ||
        trimmedNote.length > 0 ||
        nextRules !== rules;
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
          rules: nextRules,
          annotations: Object.fromEntries(map)
        });
      }
      onSaved({ learned: categoryId !== null, rulePattern: learnedPattern });
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
      e.preventDefault();
      void save(); // save() validates the amount and surfaces an error if empty
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
  <div
    class="qas-sheet"
    class:keyboard-open={keyboardOpen}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div class="qas-grab"></div>

    <div class="qas-header">
      <h2 class="qas-title">{title}</h2>
      <button type="button" class="qas-close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <!-- Scrollable form body — when the keyboard opens, this shrinks and
         scrolls so the sticky footer (chip strip + Save) stays glued just
         above the keyboard.  Hemanth's complaint that the form bottom got
         lost under the keyboard was because EVERYTHING was in one scroll
         container; now the chip strip + Save are pinned outside it. -->
    <div class="qas-scroll">
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

      <!-- Option-1: everything below fills in LIVE as you type in the dock at
           the bottom of the sheet, and stays pinned up here out of the
           keyboard's way. -->
      <div class="qas-auto-head">
        <span class="qas-lbl">Auto-filled from what you type</span>
        <span class="qas-live"><span class="qas-live-dot"></span>Live</span>
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
        />
      </div>

      <!-- Category + Account in one row — the original pre-sub-category
           layout.  Sub-category as a separate field was tried and then
           removed (Hemanth: "please once remove that sub categories
           which you added"); the CategoryPicker still renders sub-cats
           indented under their parent so users can pick a sub directly
           from this single Category button if they have any. -->
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
            {#if effectiveSub !== null}
              <!-- Parent reuses the label slot; sub is the bold value, clamped
                   to 2 lines before truncating so the SUB is never the part
                   hidden (Hemanth: always see both category + sub, even long). -->
              <span class="qas-lbl qas-crumb">{selectedCategoryName} ›</span>
              <span class="qas-dd-value qas-clamp2">{effectiveSub.name}</span>
            {:else}
              <span class="qas-lbl">Category</span>
              <span class="qas-dd-value">{selectedCategoryName}</span>
            {/if}
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
          <input
            type="date"
            bind:value={date}
            class="qas-field"
            onchange={() => (userTouchedDate = true)}
          />
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
      <label class="qas-block qas-notes-block">
        <span class="qas-lbl">Notes <span class="qas-opt">(optional — for future you)</span></span>
        <textarea
          bind:value={note}
          placeholder="e.g. with Murali, paid for everyone"
          class="qas-field qas-notes"
          rows="2"
          autocomplete="off"
        ></textarea>
      </label>
    </div>
    <!-- ↑ end of qas-scroll ----------------------------------------------- -->

    <!-- Description dock — pinned at the bottom of the sheet (OUTSIDE the
         scroll area), so the box you TYPE in is always just above the
         keyboard and never covered. The summary above fills in live as you
         type here. This is the Option-1 layout. -->
    <div class="qas-dock">
      <span class="qas-type-hint">↑ Type what you spent — we fill the rest</span>
      <div class="qas-dock-row">
        <input
          type="text"
          bind:value={desc}
          placeholder={descPlaceholder}
          class="qas-dock-input"
          autocomplete="off"
          spellcheck="false"
          onkeydown={onDescKey}
        />
        <button
          type="button"
          class="qas-send-btn"
          onclick={save}
          disabled={saving}
          aria-label="Save"
        >
          {saving ? '…' : '↑'}
        </button>
      </div>
      {#if error}
        <p class="qas-error qas-dock-error">{error}</p>
      {/if}
    </div>
  </div>

  <!-- Category picker popover (top-level + nested view) -->
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
    /* Lift the sheet above the soft keyboard via --kb-inset-bottom
       (set globally by keyboard-inset.ts via visualViewport). */
    bottom: var(--kb-inset-bottom, 0px);
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
    /* Cap height to the available viewport WITHOUT the keyboard so the
       sheet's bottom edge sits right at the keyboard top. */
    max-height: calc(95dvh - var(--kb-inset-bottom, 0px));
    /* NO overflow on the sheet itself — internal scroll lives on
       .qas-scroll so the form body scrolls inside the sheet.  Save now
       sits at the END of the scrollable area (Hemanth: "why to show
       save button even while typing?"), not in a pinned footer. */
    overflow: hidden;
  }
  /* Scroll area — the entire form body, including the Save button as
     the last child.  When the keyboard opens, Amount + Description
     stay visible; the rest is reachable by scrolling or by dismissing
     the keyboard. */
  .qas-scroll {
    flex: 1 1 auto;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0; /* lets flex-shrink kick in inside the column */
    padding-bottom: 0.4rem;
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
  /* qas-full-row + .disabled variants were removed when the dedicated
     Sub-category + standalone Payment-method rows were dropped on
     Hemanth's feedback ("please once remove that sub categories which
     you added").  Re-add the disabled styles when there's another
     dropdown that can be disabled. */
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
  /* When a sub-category is picked, the sub becomes the bold value and may wrap
     to 2 lines (then clip) so it is the LAST thing hidden — never truncated
     away like before. The parent rides in the label slot above it (.qas-crumb). */
  .qas-dd-value.qas-clamp2 {
    white-space: normal;
    text-overflow: clip;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .qas-lbl.qas-crumb {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.62rem;
    margin-bottom: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted);
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

  /* ── Option-1 "auto-filled" header ─────────────────────────────────── */
  .qas-auto-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.1rem;
  }
  .qas-live {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-accent);
  }
  .qas-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--color-accent);
    animation: qas-pulse 1.5s ease-in-out infinite;
  }
  @keyframes qas-pulse {
    0%,
    100% {
      opacity: 0.4;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1.1);
    }
  }

  /* ── Description dock — pinned at the bottom, always above the keyboard ── */
  .qas-dock {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-border);
  }
  .qas-type-hint {
    text-align: center;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-accent);
  }
  .qas-dock-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .qas-dock-input {
    flex: 1;
    min-width: 0;
    border: 1.5px solid var(--color-accent);
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: 12px;
    padding: 0.7rem 0.85rem;
    font-size: 0.98rem;
    font-family: inherit;
  }
  .qas-dock-input:focus {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-surface);
  }
  .qas-send-btn {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: 0;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      filter 0.16s ease,
      transform 0.12s ease;
  }
  .qas-send-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .qas-send-btn:active:not(:disabled) {
    transform: scale(0.95);
  }
  .qas-send-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .qas-dock-error {
    text-align: center;
  }

  /* ── Compact form when the soft keyboard is open ─────────────────────
     The .keyboard-open class is added by JS from the visualViewport
     listener whenever the keyboard reduces the visible area by more
     than 120px.  All rules below use `rem` units so the compaction
     scales the same way across every phone size — from a 320-wide
     iPhone SE up to a folded Galaxy Z.  The goal: Amount + Description
     + Category | Account + Date | Time + Save all reachable above the
     keyboard fold (Hemanth: "okate screen lo … amount kanapadaali,
     categories kanapadaali, time kanapadaali, description kudaa
     kanapadaali, date kudaa").  Tested at viewports 320×568 (iPhone SE)
     and 412×915 (Pixel 7) via scripts/screenshot-quickadd-keyboard.mjs. */
  .qas-sheet.keyboard-open {
    gap: 0.25rem;
    /* Shrink the top + bottom padding so the form has more vertical
       room.  The grab handle still has its own margin so the sheet
       still looks like a sheet. */
    padding-top: 0.2rem;
  }
  /* The grab handle no longer needs vertical breathing room when the
     form is compacted. */
  .qas-sheet.keyboard-open .qas-grab {
    margin: 0.1rem auto 0.1rem;
  }
  /* The big "Add expense" title disappears; only the × close button
     remains in the header.  The X button is positioned via the
     existing flex-end alignment so no layout reflow happens. */
  .qas-sheet.keyboard-open .qas-title {
    display: none;
  }
  /* The header shrinks: just the × close button on its own row,
     no padding to spare. */
  .qas-sheet.keyboard-open .qas-header {
    justify-content: flex-end;
    min-height: 0;
  }
  /* Notes is optional ("for future you").  Hide it while typing so
     Date / Time and Save are reachable; user can dismiss the keyboard
     to access Notes when they actually want to add one. */
  .qas-sheet.keyboard-open .qas-notes-block {
    display: none;
  }
  /* Tighten the Amount + dropdown heights so the saved-pixels add up. */
  .qas-sheet.keyboard-open .qas-amount-row {
    padding: 0.4rem 0.85rem;
  }
  .qas-sheet.keyboard-open .qas-amount {
    font-size: 1.55rem;
  }
  .qas-sheet.keyboard-open .qas-type-toggle {
    padding: 0.12rem;
  }
  .qas-sheet.keyboard-open .qas-type-opt {
    padding: 0.32rem 0.4rem;
    font-size: 0.8rem;
  }
  .qas-sheet.keyboard-open .qas-dd-btn {
    padding: 0.4rem 0.6rem;
  }
  .qas-sheet.keyboard-open .qas-field {
    padding: 0.4rem 0.65rem;
  }
  /* Keyboard open: tighten the dock so the type box + send sit snug above the
     keyboard, and drop the header/hint to save vertical room. */
  .qas-sheet.keyboard-open .qas-auto-head,
  .qas-sheet.keyboard-open .qas-type-hint {
    display: none;
  }
  .qas-sheet.keyboard-open .qas-dock {
    padding-top: 0.35rem;
  }
  .qas-sheet.keyboard-open .qas-dock-input {
    padding: 0.55rem 0.8rem;
  }
  .qas-sheet.keyboard-open .qas-send-btn {
    width: 40px;
    height: 40px;
  }
</style>
