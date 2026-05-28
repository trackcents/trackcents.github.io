<script lang="ts">
  // Category picker — opens as a popover from the QuickAddSheet's "Category ▾"
  // button.  Shows ★ favorites first, then all categories grouped alphabetically.
  // A search field at the top filters by name.  Each row has a star icon the
  // user can tap to favorite / unfavorite without leaving the picker.
  //
  // Used inside the compact QuickAddSheet so the form fits on one screen and
  // the category list lives in a focused popover.

  import type { Category } from '$lib/app/categorization';
  import { loadFavoriteCategoryIds, toggleFavoriteCategory } from '$lib/app/favorites';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';

  interface Props {
    open: boolean;
    categories: Category[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onClose: () => void;
  }

  const { open, categories, selectedId, onSelect, onClose }: Props = $props();

  let query = $state('');
  let favIds = $state<string[]>([]);
  $effect(() => {
    if (open) {
      favIds = loadFavoriteCategoryIds();
      query = '';
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

  function pick(id: string | null): void {
    onSelect(id);
    onClose();
  }
  function toggleFav(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    favIds = toggleFavoriteCategory(id);
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick a category">
    <div class="grab"></div>

    <div class="head">
      <h2>Pick a category</h2>
      <button type="button" class="close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="search-wrap">
      <input
        type="search"
        placeholder="Search category…"
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
            <button type="button" class="row-main" onclick={() => pick(c.id)}>
              <span class="icon">
                <CategoryIcon icon={categoryIconName(c.name)} color={categoryColor(c.id)} tint />
              </span>
              <span class="name">{c.name}</span>
            </button>
            <button
              type="button"
              class="star starred"
              aria-label="Unfavorite {c.name}"
              onclick={(ev) => toggleFav(c.id, ev)}
            >
              ★
            </button>
          </div>
        {/each}
      {/if}

      {#if others.length > 0 && favs.length > 0}
        <div class="section-head muted">All categories</div>
      {/if}

      <div class="row" class:selected={selectedId === null}>
        <button type="button" class="row-main" onclick={() => pick(null)}>
          <span class="icon dot-icon">
            <span class="dot" style:background-color="var(--color-muted)"></span>
          </span>
          <span class="name muted">Uncategorized</span>
        </button>
        <span class="star-placeholder"></span>
      </div>

      {#each others as c (c.id)}
        <div class="row" class:selected={c.id === selectedId}>
          <button type="button" class="row-main" onclick={() => pick(c.id)}>
            <span class="icon">
              <CategoryIcon icon={categoryIconName(c.name)} color={categoryColor(c.id)} tint />
            </span>
            <span class="name">{c.name}</span>
          </button>
          <button
            type="button"
            class="star"
            aria-label="Favorite {c.name}"
            onclick={(ev) => toggleFav(c.id, ev)}
          >
            ☆
          </button>
        </div>
      {/each}

      {#if filtered.length === 0}
        <p class="empty">No categories match “{query}”.</p>
      {/if}
    </div>
  </div>
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
  .star-placeholder {
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
  .star:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
  .star.starred {
    color: var(--color-accent);
  }
  .star-placeholder {
    pointer-events: none;
  }

  .empty {
    text-align: center;
    color: var(--color-muted);
    font-size: 0.85rem;
    padding: 1.4rem 0.8rem;
  }
</style>
