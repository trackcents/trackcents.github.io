<script lang="ts">
  // Category picker — opens as a popover from the QuickAddSheet's "Category ▾"
  // button.  Shows ★ favorites first, then all categories grouped alphabetically.
  // A search field at the top filters by name.  Each row has a star icon the
  // user can tap to favorite / unfavorite without leaving the picker.
  //
  // Adds (Batch A):
  //   • "+ New category" inline at the bottom of the list — Bhargav can add
  //     "Tiffin" or "UPI Send" without going to /categories.
  //   • Edit-mode toggle (pencil button in the header) reveals 🗑 buttons
  //     per row.  Single tap on 🗑 opens a confirmation sub-sheet that
  //     cites the tx-count before delete — no accidental loss.
  //   • Delete is guarded behind the explicit toggle, so a normal pick
  //     can never drop a category by mistake.

  import type { Category } from '$lib/app/categorization';
  import { loadFavoriteCategoryIds, toggleFavoriteCategory } from '$lib/app/favorites';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';

  interface Props {
    open: boolean;
    categories: Category[];
    selectedId: string | null;
    /** Existing annotations — used to count "X transactions" before delete. */
    txCountByCategoryId?: Map<string, number> | undefined;
    onSelect: (id: string | null) => void;
    /** Create a new category with the given name; caller persists. */
    onCreate?: ((name: string) => void) | undefined;
    /** Delete a category; caller persists.  Picker only calls this after
     *  the user confirms in the sub-sheet. */
    onDelete?: ((id: string) => void) | undefined;
    onClose: () => void;
  }

  const {
    open,
    categories,
    selectedId,
    txCountByCategoryId,
    onSelect,
    onCreate,
    onDelete,
    onClose
  }: Props = $props();

  let query = $state('');
  let favIds = $state<string[]>([]);
  /** Edit-mode reveals 🗑 buttons. Off by default to keep delete out of
   *  accidental-tap range (Hemanth's ask: "option to delete categories
   *  should not be in a place where accidentally deletes"). */
  let editMode = $state(false);
  /** When non-null, render the confirm-delete sub-sheet. */
  let confirmDeleteId = $state<string | null>(null);

  $effect(() => {
    if (open) {
      favIds = loadFavoriteCategoryIds();
      query = '';
      editMode = false;
      confirmDeleteId = null;
    }
  });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  });

  const favSet = $derived(new Set(favIds));
  const favs = $derived(filtered.filter((c) => favSet.has(c.id)));
  const others = $derived(filtered.filter((c) => !favSet.has(c.id)));

  /** Show "+ Create 'X'" when the typed query has no exact match. */
  const canCreate = $derived.by<boolean>(() => {
    if (onCreate === undefined) return false;
    const q = query.trim();
    if (q.length === 0) return false;
    return !categories.some((c) => c.name.toLowerCase() === q.toLowerCase());
  });

  const confirmTarget = $derived(
    confirmDeleteId === null ? null : (categories.find((c) => c.id === confirmDeleteId) ?? null)
  );
  const confirmTxCount = $derived(
    confirmDeleteId === null ? 0 : (txCountByCategoryId?.get(confirmDeleteId) ?? 0)
  );

  function pick(id: string | null): void {
    if (editMode) return; // ignore picks while editing — focused on delete
    onSelect(id);
    onClose();
  }
  function toggleFav(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    favIds = toggleFavoriteCategory(id);
  }
  function startDelete(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    confirmDeleteId = id;
  }
  function cancelDelete(): void {
    confirmDeleteId = null;
  }
  function confirmDelete(): void {
    if (confirmDeleteId === null || onDelete === undefined) return;
    onDelete(confirmDeleteId);
    confirmDeleteId = null;
  }
  function createNow(): void {
    if (onCreate === undefined) return;
    const q = query.trim();
    if (q.length === 0) return;
    onCreate(q);
    query = '';
    onClose();
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick a category">
    <div class="grab"></div>

    <div class="head">
      <h2>{editMode ? 'Edit categories' : 'Pick a category'}</h2>
      <div class="head-actions">
        {#if onDelete !== undefined}
          <button
            type="button"
            class="edit-toggle"
            class:on={editMode}
            onclick={() => (editMode = !editMode)}
            aria-pressed={editMode}
            aria-label={editMode ? 'Done editing' : 'Edit categories'}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        {/if}
        <button type="button" class="close" onclick={onClose} aria-label="Close">✕</button>
      </div>
    </div>

    <div class="search-wrap">
      <input
        type="search"
        placeholder={onCreate !== undefined ? 'Search or add new…' : 'Search category…'}
        class="search"
        bind:value={query}
        aria-label="Search categories"
      />
    </div>

    <div class="body">
      {#if favs.length > 0}
        <div class="section-head">★ Favorites</div>
        {#each favs as c (c.id)}
          <div class="row" class:selected={c.id === selectedId}>
            <button type="button" class="row-main" onclick={() => pick(c.id)} disabled={editMode}>
              <span class="icon">
                <CategoryIcon icon={categoryIconName(c.name)} color={categoryColor(c.id)} tint />
              </span>
              <span class="name">{c.name}</span>
            </button>
            {#if editMode}
              <button
                type="button"
                class="trash"
                aria-label="Delete {c.name}"
                onclick={(ev) => startDelete(c.id, ev)}
              >
                🗑
              </button>
            {:else}
              <button
                type="button"
                class="star starred"
                aria-label="Unfavorite {c.name}"
                onclick={(ev) => toggleFav(c.id, ev)}
              >
                ★
              </button>
            {/if}
          </div>
        {/each}
      {/if}

      {#if others.length > 0 && favs.length > 0}
        <div class="section-head muted">All categories</div>
      {/if}

      {#if !editMode}
        <div class="row" class:selected={selectedId === null}>
          <button type="button" class="row-main" onclick={() => pick(null)}>
            <span class="icon dot-icon">
              <span class="dot" style:background-color="var(--color-muted)"></span>
            </span>
            <span class="name muted">Uncategorized</span>
          </button>
          <span class="star-placeholder"></span>
        </div>
      {/if}

      {#each others as c (c.id)}
        <div class="row" class:selected={c.id === selectedId}>
          <button type="button" class="row-main" onclick={() => pick(c.id)} disabled={editMode}>
            <span class="icon">
              <CategoryIcon icon={categoryIconName(c.name)} color={categoryColor(c.id)} tint />
            </span>
            <span class="name">{c.name}</span>
          </button>
          {#if editMode}
            <button
              type="button"
              class="trash"
              aria-label="Delete {c.name}"
              onclick={(ev) => startDelete(c.id, ev)}
            >
              🗑
            </button>
          {:else}
            <button
              type="button"
              class="star"
              aria-label="Favorite {c.name}"
              onclick={(ev) => toggleFav(c.id, ev)}
            >
              ☆
            </button>
          {/if}
        </div>
      {/each}

      {#if filtered.length === 0 && !canCreate}
        <p class="empty">No categories match “{query}”.</p>
      {/if}

      {#if canCreate && !editMode}
        <button type="button" class="create" onclick={createNow}>
          <span class="icon">＋</span>
          <span class="name">Create &quot;<strong>{query.trim()}</strong>&quot;</span>
        </button>
      {/if}
    </div>
  </div>

  <!-- Confirm-delete sub-sheet (stacks ABOVE the picker sheet) -->
  {#if confirmTarget !== null}
    <button type="button" class="cd-backdrop" aria-label="Cancel delete" onclick={cancelDelete}
    ></button>
    <div class="cd-sheet" role="dialog" aria-modal="true" aria-label="Confirm delete">
      <h3 class="cd-title">Delete &quot;{confirmTarget.name}&quot;?</h3>
      {#if confirmTxCount > 0}
        <p class="cd-body">
          <strong>{confirmTxCount}</strong>
          {confirmTxCount === 1 ? 'transaction' : 'transactions'} on this category will become
          <em>Uncategorized</em>. Your transactions stay safe — just the label is removed.
        </p>
      {:else}
        <p class="cd-body">No transactions are using this category. Safe to remove.</p>
      {/if}
      <div class="cd-actions">
        <button type="button" class="cd-cancel" onclick={cancelDelete}>Cancel</button>
        <button type="button" class="cd-confirm" onclick={confirmDelete}>Delete</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
    animation: fade 0.18s ease both;
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
    z-index: 80;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 0 calc(0.8rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: rise 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
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
    margin: 0.4rem auto 0.65rem;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.1rem 0.5rem;
  }
  .head h2 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .head-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .edit-toggle {
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
  .edit-toggle.on {
    background: var(--color-accent-soft);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .close {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .close:hover {
    color: var(--color-text);
  }

  .search-wrap {
    padding: 0 1.1rem 0.6rem;
  }
  .search {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 0.55rem 0.75rem;
    font-size: 0.92rem;
    color: var(--color-text);
  }
  .search:focus {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-surface);
  }

  .body {
    overflow-y: auto;
    padding: 0 0.8rem 0.4rem;
    flex: 1;
  }

  .section-head {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0.7rem 0.3rem 0.4rem;
  }
  .section-head.muted {
    color: var(--color-muted);
  }

  .row {
    display: flex;
    align-items: center;
    width: 100%;
    border-radius: 12px;
    background: transparent;
    color: var(--color-text);
    transition: background-color 0.14s ease;
  }
  .row:hover {
    background: var(--color-elevated);
  }
  .row.selected {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
  .row-main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0.7rem 0.55rem;
    text-align: left;
    cursor: pointer;
  }
  .row-main:disabled {
    cursor: default;
    opacity: 0.75;
  }
  .row .icon {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .dot-icon .dot {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    display: inline-block;
  }
  .row .name {
    flex: 1;
    font-size: 0.93rem;
    font-weight: 500;
    line-height: 1;
  }
  .row .name.muted {
    color: var(--color-muted);
  }

  .star,
  .star-placeholder,
  .trash {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: none;
    border: 0;
    color: var(--color-muted);
    font-size: 1.1rem;
    cursor: pointer;
    border-radius: 999px;
    transition:
      background-color 0.14s ease,
      color 0.14s ease;
  }
  .star:hover,
  .trash:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
  .star.starred {
    color: var(--color-accent);
  }
  .star-placeholder {
    pointer-events: none;
  }
  .trash {
    color: var(--color-danger);
    margin-right: 0.3rem;
  }
  .trash:hover {
    background: color-mix(in oklab, var(--color-danger) 14%, transparent);
    color: var(--color-danger);
  }

  .empty {
    text-align: center;
    color: var(--color-muted);
    font-size: 0.85rem;
    padding: 1.4rem 0.8rem;
  }
  .create {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    border: 0;
    border-top: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-accent);
    padding: 0.85rem 0.55rem;
    text-align: left;
    cursor: pointer;
    font-weight: 600;
    margin-top: 0.3rem;
  }
  .create:hover {
    background: var(--color-elevated);
  }
  .create .icon {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 1.1rem;
  }
  .create .name {
    flex: 1;
    font-size: 0.93rem;
    line-height: 1;
  }

  /* ── Confirm-delete sub-sheet (z-index above the picker) ───────── */
  .cd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(15, 20, 28, 0.55);
    border: 0;
    cursor: pointer;
    animation: fade 0.16s ease both;
  }
  .cd-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 100;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .cd-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .cd-body {
    font-size: 0.88rem;
    color: var(--color-muted);
    line-height: 1.45;
  }
  .cd-body strong {
    color: var(--color-text);
  }
  .cd-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .cd-cancel,
  .cd-confirm {
    padding: 0.75rem;
    border-radius: 12px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--color-border);
  }
  .cd-cancel {
    background: var(--color-elevated);
    color: var(--color-text);
  }
  .cd-confirm {
    background: var(--color-danger);
    color: var(--color-accent-fg);
    border-color: var(--color-danger);
  }
</style>
