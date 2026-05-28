<script lang="ts">
  // Account picker — opens as a popover from the QuickAddSheet's "Account ▾"
  // button.  Shows the list of accounts the user has ever used (imported +
  // manually-added).  A search field at the top filters by name; if the
  // query doesn't match anything, a "+ Create '<query>'" row appears at
  // the bottom so Bhargav can add a new wallet/card without leaving the
  // sheet.
  //
  // Pairs with src/lib/app/accounts.ts which owns the persistence (manual
  // additions + last-used pointer in localStorage).

  interface Props {
    open: boolean;
    /** All known account names — Cash + imported + manually added. */
    accounts: readonly string[];
    selected: string;
    onSelect: (name: string) => void;
    /** Called when the user creates a new name from the picker. */
    onCreate: (name: string) => void;
    onClose: () => void;
  }

  const { open, accounts, selected, onSelect, onCreate, onClose }: Props = $props();

  let query = $state('');
  $effect(() => {
    if (open) query = '';
  });

  const filtered = $derived.by<readonly string[]>(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return accounts;
    return accounts.filter((a) => a.toLowerCase().includes(q));
  });

  /** When the user's exact typed value isn't in the list, offer to create it. */
  const canCreate = $derived.by<boolean>(() => {
    const q = query.trim();
    if (q.length === 0) return false;
    return !accounts.some((a) => a.toLowerCase() === q.toLowerCase());
  });

  function pick(name: string): void {
    onSelect(name);
    onClose();
  }
  function create(): void {
    const q = query.trim();
    if (q.length === 0) return;
    onCreate(q);
    onClose();
  }
</script>

{#if open}
  <button type="button" class="ap-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="ap-sheet" role="dialog" aria-modal="true" aria-label="Pick an account">
    <div class="ap-grab"></div>

    <div class="ap-head">
      <h2>Pick an account</h2>
      <button type="button" class="ap-close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="ap-search-wrap">
      <input
        type="search"
        placeholder="Search or add new…"
        class="ap-search"
        bind:value={query}
        aria-label="Search accounts"
      />
    </div>

    <div class="ap-body">
      {#each filtered as a (a)}
        <button
          type="button"
          class="ap-row"
          class:selected={a === selected}
          onclick={() => pick(a)}
        >
          <span class="ap-icon">💳</span>
          <span class="ap-name">{a}</span>
          {#if a === selected}
            <span class="ap-check" aria-hidden="true">✓</span>
          {/if}
        </button>
      {/each}

      {#if canCreate}
        <button type="button" class="ap-create" onclick={create}>
          <span class="ap-icon">＋</span>
          <span class="ap-name">Create &quot;<strong>{query.trim()}</strong>&quot;</span>
        </button>
      {/if}

      {#if filtered.length === 0 && !canCreate}
        <p class="ap-empty">No accounts yet.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ap-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
    animation: ap-fade 0.18s ease both;
  }
  @keyframes ap-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .ap-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 80;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 0 calc(0.8rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: ap-rise 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-height: 70dvh;
    display: flex;
    flex-direction: column;
    max-width: 640px;
    margin: 0 auto;
  }
  @keyframes ap-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .ap-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.65rem;
  }
  .ap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.1rem 0.5rem;
  }
  .ap-head h2 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .ap-close {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .ap-search-wrap {
    padding: 0 1.1rem 0.6rem;
  }
  .ap-search {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 0.55rem 0.75rem;
    font-size: 0.92rem;
    color: var(--color-text);
  }
  .ap-search:focus {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-surface);
  }
  .ap-body {
    overflow-y: auto;
    padding: 0 0.8rem 0.4rem;
    flex: 1;
  }
  .ap-row,
  .ap-create {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--color-text);
    padding: 0.8rem 0.55rem;
    border-radius: 12px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.14s ease;
  }
  .ap-row:hover,
  .ap-create:hover {
    background: var(--color-elevated);
  }
  .ap-row.selected {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
  .ap-icon {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 1rem;
  }
  .ap-name {
    flex: 1;
    font-size: 0.93rem;
    font-weight: 500;
    line-height: 1;
  }
  .ap-check {
    color: var(--color-accent);
    font-size: 1rem;
    font-weight: 700;
  }
  .ap-create {
    color: var(--color-accent);
    font-weight: 600;
    margin-top: 0.3rem;
    border-top: 1px solid var(--color-border);
    padding-top: 0.9rem;
    border-radius: 0;
  }
  .ap-empty {
    text-align: center;
    color: var(--color-muted);
    font-size: 0.85rem;
    padding: 1.4rem 0.8rem;
  }
</style>
