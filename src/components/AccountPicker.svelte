<script lang="ts">
  // Account picker — opens as a popover from the QuickAddSheet's "Account ▾"
  // button.  Shows the list of accounts the user has ever used (imported +
  // manually-added).  A search field at the top filters by name; if the
  // query doesn't match anything, a "+ Create '<query>'" row appears at
  // the bottom so Bhargav can add a new wallet/card without leaving the
  // sheet.
  //
  // Batch B additions:
  //   • Per-row ✏ to set a nickname on top of the raw account ("Chase
  //     Checking 9535" → display as "Main checking"; raw still stored so
  //     reconciliation never breaks).
  //   • Search input auto-focuses on open (single tap to start typing).
  //   • Keyboard-avoid: sheet bottom uses --kb-inset-bottom (set by
  //     keyboard-inset.ts on <html> from visualViewport).
  //
  // Pairs with src/lib/app/accounts.ts (manual additions + last-used) and
  // src/lib/app/account-nicknames.ts (nickname map).

  import { tick } from 'svelte';
  import {
    getAccountNickname,
    setAccountNickname,
    accountDisplayName
  } from '$lib/app/account-nicknames';

  interface Props {
    open: boolean;
    /** All known account names — Cash + imported + manually added. */
    accounts: readonly string[];
    selected: string;
    onSelect: (name: string) => void;
    /** Called when the user creates a new name from the picker. */
    onCreate: (name: string) => void;
    /** Optional — fired when a nickname changes so the parent can refresh. */
    onNicknameChange?: (() => void) | undefined;
    onClose: () => void;
  }

  const { open, accounts, selected, onSelect, onCreate, onNicknameChange, onClose }: Props =
    $props();

  let query = $state('');
  let editMode = $state(false);
  /** When non-null, render the nickname-edit sub-sheet for this raw name. */
  let nicknameTarget = $state<string | null>(null);
  let nicknameInput = $state('');
  let searchInputEl = $state<HTMLInputElement | null>(null);
  /** Bump to force a re-derive of display names after a nickname save. */
  let nicknameRevision = $state(0);

  $effect(() => {
    if (open) {
      query = '';
      editMode = false;
      nicknameTarget = null;
      tick().then(() => {
        try {
          searchInputEl?.focus();
        } catch {
          /* noop */
        }
      });
    }
  });

  /** Display name = nickname if set, else raw.  Re-derives on
   *  nicknameRevision bumps after a save. */
  function display(raw: string): string {
    // Reference the signal so $derived re-runs on bump.
    void nicknameRevision;
    return accountDisplayName(raw);
  }

  const filtered = $derived.by<readonly string[]>(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return accounts;
    // Match against BOTH the raw name and the user-set nickname so the
    // user finds "Main checking" by typing either "main" or "9535".
    void nicknameRevision;
    return accounts.filter(
      (a) => a.toLowerCase().includes(q) || accountDisplayName(a).toLowerCase().includes(q)
    );
  });

  /** Pre-computed nickname per raw name, refreshed when nicknameRevision
   *  bumps (after a save) so the row template can read it via @const
   *  without doing a function call that ESLint flags or parsing tricks
   *  prettier rejects. */
  const nicknameByRaw = $derived.by<Record<string, string | null>>(() => {
    void nicknameRevision;
    const out: Record<string, string | null> = {};
    for (const a of accounts) out[a] = getAccountNickname(a);
    return out;
  });

  /** When the user's exact typed value isn't in the list, offer to create it. */
  const canCreate = $derived.by<boolean>(() => {
    const q = query.trim();
    if (q.length === 0) return false;
    return !accounts.some((a) => a.toLowerCase() === q.toLowerCase());
  });

  function pick(name: string): void {
    if (editMode) return;
    onSelect(name);
    onClose();
  }
  function create(): void {
    const q = query.trim();
    if (q.length === 0) return;
    onCreate(q);
    onClose();
  }
  function startNicknameEdit(rawName: string, ev: MouseEvent): void {
    ev.stopPropagation();
    nicknameTarget = rawName;
    nicknameInput = getAccountNickname(rawName) ?? '';
  }
  function cancelNickname(): void {
    nicknameTarget = null;
  }
  function saveNickname(): void {
    if (nicknameTarget === null) return;
    setAccountNickname(nicknameTarget, nicknameInput);
    nicknameTarget = null;
    nicknameRevision++;
    onNicknameChange?.();
  }
</script>

{#if open}
  <button type="button" class="ap-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="ap-sheet" role="dialog" aria-modal="true" aria-label="Pick an account">
    <div class="ap-grab"></div>

    <div class="ap-head">
      <h2>{editMode ? 'Edit payment methods' : 'Pick a payment method'}</h2>
      <div class="ap-head-actions">
        <button
          type="button"
          class="ap-edit-toggle"
          class:on={editMode}
          onclick={() => (editMode = !editMode)}
          aria-pressed={editMode}
        >
          {editMode ? 'Done' : 'Edit'}
        </button>
        <button type="button" class="ap-close" onclick={onClose} aria-label="Close">✕</button>
      </div>
    </div>

    <div class="ap-search-wrap">
      <input
        type="search"
        placeholder="Search or add new…"
        class="ap-search"
        bind:value={query}
        bind:this={searchInputEl}
        aria-label="Search accounts"
      />
    </div>

    <div class="ap-body">
      {#each filtered as a (a)}
        {@const nick = nicknameByRaw[a] ?? null}
        <div class="ap-row-wrap" class:selected={a === selected}>
          <button
            type="button"
            class="ap-row"
            class:selected={a === selected}
            onclick={() => pick(a)}
            disabled={editMode}
          >
            <span class="ap-icon">💳</span>
            <span class="ap-name-block">
              <!-- Primary = nickname when set, raw otherwise.  Secondary
                   shows the raw name so "Main checking" never loses sight
                   of WHICH "Chase Checking 9535" it actually is. -->
              <span class="ap-name">{display(a)}</span>
              {#if nick}
                <span class="ap-raw">{a}</span>
              {/if}
            </span>
            {#if a === selected && !editMode}
              <span class="ap-check" aria-hidden="true">✓</span>
            {/if}
          </button>
          {#if editMode}
            <button
              type="button"
              class="ap-pencil"
              aria-label="Set nickname for {a}"
              onclick={(ev) => startNicknameEdit(a, ev)}
            >
              ✏
            </button>
          {/if}
        </div>
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

  <!-- Nickname-edit sub-sheet -->
  {#if nicknameTarget !== null}
    <button type="button" class="ap-cd-backdrop" aria-label="Cancel" onclick={cancelNickname}
    ></button>
    <div class="ap-cd-sheet" role="dialog" aria-modal="true" aria-label="Set nickname">
      <h3 class="ap-cd-title">Nickname for {nicknameTarget}</h3>
      <p class="ap-cd-body">
        Show this account as your own name. The original
        <em>{nicknameTarget}</em> stays stored so statement matching keeps working — only the display
        changes.
      </p>
      <input
        type="text"
        bind:value={nicknameInput}
        class="ap-cd-field"
        placeholder="e.g. Main checking, Joint card"
        autocomplete="off"
        maxlength="40"
      />
      <div class="ap-cd-actions">
        <button type="button" class="ap-cd-cancel" onclick={cancelNickname}>Cancel</button>
        <button type="button" class="ap-cd-save" onclick={saveNickname}>Save</button>
      </div>
    </div>
  {/if}
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
    /* Lifts above the soft keyboard via --kb-inset-bottom (set by
       keyboard-inset.ts).  Falls back to 0px on desktop where no
       keyboard ever opens. */
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 80;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 0 calc(0.8rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: ap-rise 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-height: calc(70dvh - var(--kb-inset-bottom, 0px));
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
  .ap-row-wrap {
    display: flex;
    align-items: center;
    width: 100%;
    border-radius: 12px;
    transition: background-color 0.14s ease;
  }
  .ap-row-wrap:hover {
    background: var(--color-elevated);
  }
  .ap-row-wrap.selected {
    background: var(--color-accent-soft);
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
  .ap-row:disabled {
    cursor: default;
    opacity: 0.85;
  }
  .ap-row.selected {
    color: var(--color-accent);
  }
  .ap-create:hover {
    background: var(--color-elevated);
  }
  .ap-head-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .ap-edit-toggle {
    height: 30px;
    padding: 0 0.75rem;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .ap-edit-toggle.on {
    background: var(--color-accent-soft);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .ap-name-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .ap-raw {
    font-size: 0.72rem;
    color: var(--color-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ap-pencil {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    margin-right: 0.3rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-accent);
    cursor: pointer;
    font-size: 1rem;
  }
  .ap-pencil:hover {
    background: color-mix(in oklab, var(--color-accent) 14%, transparent);
  }
  /* ── Nickname-edit sub-sheet (z above the picker) ── */
  .ap-cd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(15, 20, 28, 0.55);
    border: 0;
    cursor: pointer;
  }
  .ap-cd-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 100;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .ap-cd-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .ap-cd-body {
    font-size: 0.85rem;
    color: var(--color-muted);
    line-height: 1.4;
  }
  .ap-cd-field {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: 10px;
    padding: 0.7rem 0.8rem;
    font-size: 0.95rem;
    font-family: inherit;
  }
  .ap-cd-field:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .ap-cd-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .ap-cd-cancel,
  .ap-cd-save {
    padding: 0.78rem;
    border-radius: 12px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--color-border);
  }
  .ap-cd-cancel {
    background: var(--color-elevated);
    color: var(--color-text);
  }
  .ap-cd-save {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    border-color: transparent;
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
