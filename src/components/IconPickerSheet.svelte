<script lang="ts">
  // Searchable icon picker. Shows EVERY glyph — generic icons, dish icons, and
  // brand logos — so the user can browse/search all of them, not just whatever
  // the category name auto-matched. Stacks above whatever opened it; lifts above
  // the soft keyboard via --kb-inset-bottom.
  import {
    ALL_GLYPH_OPTIONS,
    categoryIconName,
    type GlyphKey,
    type GlyphOption
  } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';

  let {
    open,
    value = '',
    name = '',
    color = 'var(--color-muted)',
    onPick,
    onClose
  }: {
    open: boolean;
    /** Current override ('' = Auto / name-derived). */
    value?: string;
    /** Category name, for the Auto tile's live preview. */
    name?: string;
    color?: string;
    onPick: (glyph: string) => void;
    onClose: () => void;
  } = $props();

  let query = $state('');
  let wasOpen = false;

  // Reset the query each time the sheet opens. Deliberately DO NOT auto-focus the
  // search field — the user browses/taps icons by default and the keyboard would
  // cover the grid (Hemanth: "only open the keyboard when I tap search").
  $effect(() => {
    if (open && !wasOpen) query = '';
    wasOpen = open;
  });

  const autoGlyph = $derived<GlyphKey>(categoryIconName(name || 'x'));
  const filtered = $derived.by<GlyphOption[]>(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return ALL_GLYPH_OPTIONS as GlyphOption[];
    return (ALL_GLYPH_OPTIONS as GlyphOption[]).filter(
      (o) => o.label.toLowerCase().includes(q) || o.glyph.toLowerCase().includes(q)
    );
  });
  const groups = $derived.by(() => {
    const g: Record<string, GlyphOption[]> = { General: [], Food: [], Brands: [] };
    for (const o of filtered) g[o.group]!.push(o);
    return g;
  });

  function choose(glyph: string): void {
    onPick(glyph);
    onClose();
  }
</script>

{#if open}
  <button type="button" class="ip-backdrop" aria-label="Close icon picker" onclick={onClose}
  ></button>
  <div class="ip-sheet" role="dialog" aria-modal="true" aria-label="Choose an icon">
    <div class="ip-grab"></div>
    <div class="ip-head">
      <h3>Choose an icon</h3>
      <button type="button" class="ip-close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="ip-search-wrap">
      <input
        type="search"
        class="ip-search"
        placeholder="Search icons & logos (e.g. dosa, netflix, fuel)…"
        bind:value={query}
        aria-label="Search icons"
      />
    </div>

    <div class="ip-body">
      <!-- Auto / name-derived option, always first when not searching. -->
      {#if query.trim() === ''}
        <div class="ip-section">Suggested</div>
        <div class="ip-grid">
          <button
            type="button"
            class="ip-tile"
            class:selected={value === ''}
            onclick={() => choose('')}
            aria-label="Auto-pick from the name"
          >
            <CategoryIcon icon={autoGlyph} {color} tint size={24} />
            <span class="ip-lbl">Auto</span>
          </button>
        </div>
      {/if}

      {#each ['General', 'Food', 'Brands'] as grp (grp)}
        {#if groups[grp] && groups[grp].length > 0}
          <div class="ip-section">{grp}</div>
          <div class="ip-grid">
            {#each groups[grp] as o (o.glyph)}
              <button
                type="button"
                class="ip-tile"
                class:selected={value === o.glyph}
                onclick={() => choose(o.glyph)}
                aria-label={o.label}
                title={o.label}
              >
                <CategoryIcon icon={o.glyph} {color} tint size={24} />
                <span class="ip-lbl">{o.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}

      {#if filtered.length === 0}
        <p class="ip-empty">No icons match “{query}”.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ip-backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    background: rgba(15, 20, 28, 0.5);
    border: 0;
    cursor: pointer;
  }
  .ip-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 120;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 0 calc(0.8rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-height: calc(78dvh - var(--kb-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    max-width: 640px;
    margin: 0 auto;
    animation: ip-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes ip-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .ip-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.6rem;
  }
  .ip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.1rem 0.4rem;
  }
  .ip-head h3 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .ip-close {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    cursor: pointer;
  }
  .ip-search-wrap {
    padding: 0 1.1rem 0.5rem;
  }
  .ip-search {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 0.55rem 0.75rem;
    font-size: 0.92rem;
    color: var(--color-text);
  }
  .ip-search:focus {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-surface);
  }
  .ip-body {
    overflow-y: auto;
    padding: 0 0.9rem 0.5rem;
    flex: 1;
  }
  .ip-section {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0.6rem 0.2rem 0.4rem;
  }
  .ip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 0.5rem;
  }
  .ip-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.2rem;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    cursor: pointer;
    color: var(--color-text);
  }
  .ip-tile:hover {
    background: var(--color-elevated);
  }
  .ip-tile.selected {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }
  .ip-lbl {
    font-size: 0.62rem;
    line-height: 1.1;
    text-align: center;
    color: var(--color-muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ip-empty {
    text-align: center;
    color: var(--color-muted);
    font-size: 0.85rem;
    padding: 1.4rem 0.8rem;
  }
</style>
