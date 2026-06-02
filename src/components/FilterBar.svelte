<script lang="ts">
  // Filter controls for the unified transactions view.
  // Binds bidirectionally to the parent's `filter` state; the parent
  // re-applies filtering reactively whenever any control changes.

  import { slide } from 'svelte/transition';
  import type { TransactionFilter } from '$lib/app/transaction-view';
  import { accountKeyString, type AccountKey } from '$lib/app/transaction-view';
  import type { TransactionType } from '$lib/adapters/types';
  import { getDisplayCurrency, getDisplayCurrencySymbol } from '$lib/util/money';

  const currencySymbol = getDisplayCurrencySymbol();
  // Locale-aware search examples so the placeholder isn't a USD-only joke
  // (Bhargav's round-5 note: "starbucks doesn't exist in Bengaluru, payroll is
  // a US-only word").  Falls back to a culture-neutral hint for unknown codes.
  const searchPlaceholder =
    getDisplayCurrency() === 'INR'
      ? 'e.g. swiggy, zomato, salary …'
      : 'e.g. groceries, salary, rent …';

  interface Props {
    filter: TransactionFilter;
    accounts: AccountKey[];
    onFilterChange: (next: TransactionFilter) => void;
    onClear: () => void;
    matchedCount: number;
    totalCount: number;
  }
  let { filter, accounts, onFilterChange, onClear, matchedCount, totalCount }: Props = $props();

  const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    credit_card: 'Credit Card',
    loan: 'Loan',
    cash: 'Cash',
    other: 'Account'
  };

  const TYPE_OPTIONS: Array<{ value: TransactionType; label: string }> = [
    { value: 'purchase', label: 'Purchase' },
    { value: 'refund', label: 'Refund' },
    { value: 'payment_to_card', label: 'Card payment' },
    { value: 'transfer', label: 'Transfer' },
    { value: 'fee', label: 'Fee' },
    { value: 'interest', label: 'Interest' },
    { value: 'deposit', label: 'Deposit' },
    { value: 'withdrawal', label: 'Withdrawal' },
    { value: 'other', label: 'Other' }
  ];

  function toggleAccount(key: string) {
    const current = new Set(filter.account_keys ?? []);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    onFilterChange({ ...filter, account_keys: [...current] });
  }

  function toggleType(t: TransactionType) {
    const current = new Set(filter.types ?? []);
    if (current.has(t)) current.delete(t);
    else current.add(t);
    onFilterChange({ ...filter, types: [...current] });
  }

  function isAccountSelected(key: string): boolean {
    return (filter.account_keys ?? []).includes(key);
  }

  function isTypeSelected(t: TransactionType): boolean {
    return (filter.types ?? []).includes(t);
  }

  // Local controlled input for the search box so we can debounce the
  // filter callback.  Date and amount inputs commit on blur or change
  // and so don't need a local mirror.
  //
  // Svelte 5 note: initializing `let searchInput = $state(filter.search)`
  // would only capture the INITIAL value of `filter.search` (svelte/e/state_referenced_locally
  // warning).  We start with an empty string and let the effect below
  // sync from the parent's filter — including the initial render.
  let searchInput = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    searchInput = filter.search ?? '';
  });
  function onSearchInput(value: string) {
    searchInput = value;
    if (searchTimer !== null) clearTimeout(searchTimer);
    // 200ms debounce — fast enough to feel responsive, slow enough that
    // we don't re-filter on every keystroke.
    searchTimer = setTimeout(() => {
      onFilterChange({ ...filter, search: value });
    }, 200);
  }

  // Active-filter count for the summary badge.
  let activeFilterCount = $derived(
    (filter.account_keys && filter.account_keys.length > 0 ? 1 : 0) +
      (filter.date_from ? 1 : 0) +
      (filter.date_to ? 1 : 0) +
      (filter.amount_min !== undefined ? 1 : 0) +
      (filter.amount_max !== undefined ? 1 : 0) +
      (filter.search && filter.search.trim().length > 0 ? 1 : 0) +
      (filter.types && filter.types.length > 0 ? 1 : 0)
  );

  // Advanced filters (everything except the always-visible search) collapse
  // behind a toggle so the transaction list isn't buried under filter chrome.
  let advancedActiveCount = $derived(
    (filter.account_keys && filter.account_keys.length > 0 ? 1 : 0) +
      (filter.date_from ? 1 : 0) +
      (filter.date_to ? 1 : 0) +
      (filter.amount_min !== undefined ? 1 : 0) +
      (filter.amount_max !== undefined ? 1 : 0) +
      (filter.types && filter.types.length > 0 ? 1 : 0)
  );
  let advancedOpen = $state(false);
  let userClosedAdvanced = $state(false);
  $effect(() => {
    // Auto-reveal when advanced filters are already active (e.g. landing via
    // ?month from the home BudgetBox), unless the user has collapsed it.
    if (advancedActiveCount > 0 && !userClosedAdvanced) advancedOpen = true;
  });
  function toggleAdvanced(): void {
    advancedOpen = !advancedOpen;
    userClosedAdvanced = !advancedOpen;
  }
</script>

<section class="card rise mb-4 p-3 text-sm" aria-label="Filter transactions">
  <div class="mb-2 flex items-baseline justify-between gap-3">
    <h2 class="text-sm font-medium text-[var(--color-text)]">Filters</h2>
    <p class="text-xs text-[var(--color-muted)]">
      <span class="font-mono text-[var(--color-text)]">{matchedCount}</span> of {totalCount}
      transactions
      {#if activeFilterCount > 0}
        <button
          type="button"
          onclick={onClear}
          class="ml-3 rounded-md border px-2 py-0.5 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          style="border-color: var(--color-border); background-color: var(--color-bg);"
        >
          Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
        </button>
      {/if}
    </p>
  </div>

  <!-- Search (always visible) + the advanced-filters toggle -->
  <div class="flex items-center gap-2">
    <input
      id="filter-search"
      type="search"
      aria-label="Search transactions"
      value={searchInput}
      oninput={(e) => onSearchInput(e.currentTarget.value)}
      placeholder={searchPlaceholder}
      class="min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm"
      style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
    />
    <button
      type="button"
      onclick={toggleAdvanced}
      class="flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
      style:border-color={advancedOpen || advancedActiveCount > 0
        ? 'var(--color-accent)'
        : 'var(--color-border)'}
      style:color={advancedOpen || advancedActiveCount > 0
        ? 'var(--color-accent)'
        : 'var(--color-muted)'}
      style:background-color="var(--color-bg)"
      aria-expanded={advancedOpen}
    >
      <span class="chev" class:open={advancedOpen}>▸</span>
      Filters{#if advancedActiveCount > 0}
        <span class="badge">{advancedActiveCount}</span>{/if}
    </button>
  </div>

  {#if advancedOpen}
    <div class="mt-3" transition:slide={{ duration: 150 }}>
      <!-- Date + amount range: 4 columns -->
      <div class="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label for="filter-date-from" class="block text-xs text-[var(--color-muted)]"
            >Date from</label
          >
          <input
            id="filter-date-from"
            type="date"
            value={filter.date_from ?? ''}
            onchange={(e) =>
              onFilterChange({ ...filter, date_from: e.currentTarget.value || undefined })}
            class="mt-1 w-full rounded-md border px-2 py-1 font-mono text-sm"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
        </div>
        <div>
          <label for="filter-date-to" class="block text-xs text-[var(--color-muted)]">Date to</label
          >
          <input
            id="filter-date-to"
            type="date"
            value={filter.date_to ?? ''}
            onchange={(e) =>
              onFilterChange({ ...filter, date_to: e.currentTarget.value || undefined })}
            class="mt-1 w-full rounded-md border px-2 py-1 font-mono text-sm"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
        </div>
        <div>
          <label for="filter-amount-min" class="block text-xs text-[var(--color-muted)]"
            >Min amount ({currencySymbol})</label
          >
          <input
            id="filter-amount-min"
            type="number"
            min="0"
            step="0.01"
            value={filter.amount_min ?? ''}
            onchange={(e) => {
              const v = e.currentTarget.value;
              onFilterChange({
                ...filter,
                amount_min: v === '' ? undefined : parseFloat(v)
              });
            }}
            placeholder="0.00"
            class="mt-1 w-full rounded-md border px-2 py-1 font-mono text-sm"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
        </div>
        <div>
          <label for="filter-amount-max" class="block text-xs text-[var(--color-muted)]"
            >Max amount ({currencySymbol})</label
          >
          <input
            id="filter-amount-max"
            type="number"
            min="0"
            step="0.01"
            value={filter.amount_max ?? ''}
            onchange={(e) => {
              const v = e.currentTarget.value;
              onFilterChange({
                ...filter,
                amount_max: v === '' ? undefined : parseFloat(v)
              });
            }}
            placeholder="∞"
            class="mt-1 w-full rounded-md border px-2 py-1 font-mono text-sm"
            style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
        </div>
      </div>

      <!-- Account multi-select as toggle chips -->
      {#if accounts.length > 0}
        <div class="mb-2">
          <p class="block text-xs text-[var(--color-muted)]">Accounts</p>
          <div class="mt-1 flex flex-wrap gap-1.5">
            {#each accounts as acct (accountKeyString(acct))}
              {@const key = accountKeyString(acct)}
              {@const selected = isAccountSelected(key)}
              <button
                type="button"
                onclick={() => toggleAccount(key)}
                class="rounded-md border px-2 py-0.5 text-xs transition-colors"
                style:border-color={selected ? 'var(--color-accent)' : 'var(--color-border)'}
                style:color={selected ? 'var(--color-accent)' : 'var(--color-muted)'}
                style:background-color={selected
                  ? 'color-mix(in oklab, var(--color-accent) 12%, transparent)'
                  : 'var(--color-bg)'}
                aria-pressed={selected}
              >
                {acct.bank_name}
                {ACCOUNT_TYPE_LABELS[acct.account_type] ?? acct.account_type}
                {#if acct.account_last_4}
                  <span class="font-mono">••••{acct.account_last_4}</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Transaction type chips -->
      <div>
        <p class="block text-xs text-[var(--color-muted)]">Transaction types</p>
        <div class="mt-1 flex flex-wrap gap-1.5">
          {#each TYPE_OPTIONS as opt (opt.value)}
            {@const selected = isTypeSelected(opt.value)}
            <button
              type="button"
              onclick={() => toggleType(opt.value)}
              class="rounded-md border px-2 py-0.5 text-xs transition-colors"
              style:border-color={selected ? 'var(--color-accent)' : 'var(--color-border)'}
              style:color={selected ? 'var(--color-accent)' : 'var(--color-muted)'}
              style:background-color={selected
                ? 'color-mix(in oklab, var(--color-accent) 12%, transparent)'
                : 'var(--color-bg)'}
              aria-pressed={selected}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .chev {
    display: inline-block;
    transition: transform 0.15s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.05rem;
    height: 1.05rem;
    padding: 0 0.3rem;
    border-radius: 9999px;
    background-color: var(--color-accent);
    color: var(--color-accent-fg, #fff);
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
  }
</style>
