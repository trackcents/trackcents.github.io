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

  import { tick, untrack } from 'svelte';
  import type { Category } from '$lib/app/categorization';
  import { loadFavoriteCategoryIds, toggleFavoriteCategory } from '$lib/app/favorites';
  import { categoryColor, categoryIconName, type GlyphKey } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import CategoryRenameSheet from '$components/CategoryRenameSheet.svelte';
  import IconPickerSheet from '$components/IconPickerSheet.svelte';

  interface Props {
    open: boolean;
    categories: Category[];
    selectedId: string | null;
    /** Existing annotations — used to count "X transactions" before delete. */
    txCountByCategoryId?: Map<string, number> | undefined;
    onSelect: (id: string | null) => void;
    /** Create a new category with the given name; caller persists.  When
     *  parentId is provided, the new category is a SUB of that parent. */
    onCreate?: ((name: string, parentId?: string, icon?: string) => void) | undefined;
    /** Delete a category; caller persists.  Picker only calls this after
     *  the user confirms in the sub-sheet. */
    onDelete?: ((id: string) => void) | undefined;
    /** Rename / re-icon a category; caller persists.  Picker opens the
     *  CategoryRenameSheet to collect the new values. */
    onRename?: ((id: string, patch: { name: string; icon: string }) => void) | undefined;
    /** When set, the picker only shows categories whose parent_id matches
     *  this id.  Top-level categories are hidden, the "+ Create" row
     *  creates a SUB under this parent.  Used by QuickAddSheet for its
     *  Sub-category field. */
    restrictToParent?: string | undefined;
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
    onRename,
    restrictToParent,
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
  /** When non-null, render the rename / icon-edit sub-sheet. */
  let renameId = $state<string | null>(null);
  /** Ref for the search field so we can auto-focus when the picker opens —
   *  Hemanth's ask: "when I want to search or add new category if I type
   *  there".  Without auto-focus, mobile users must tap twice (open the
   *  sheet, then tap the input). */
  let searchInputEl = $state<HTMLInputElement | null>(null);
  /** Which parent categories are expanded to reveal their sub-categories.
   *  Collapsed by DEFAULT so a parent with ~10 subs doesn't clutter the list
   *  (Hemanth: "if I add 10 different sub categories ... that would clutter").
   *  Tapping a parent row toggles it — see onRowTap. */
  let expandedIds = $state<Set<string>>(new Set());

  /** Init ONLY on the rising edge of `open` (false→true). The reads inside are
   *  untracked so that adding/renaming a category (which mutates `categories`)
   *  does NOT re-run this and wipe the user's transient UI state — that bug
   *  collapsed the parent and scrolled away the instant a sub was added
   *  (Hemanth: "as soon as I added a sub and clicked OK it minimized the
   *  category... user wonders what just happened"). */
  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) {
      untrack(() => {
        favIds = loadFavoriteCategoryIds();
        query = '';
        editMode = false;
        confirmDeleteId = null;
        renameId = null;
        addSubParentId = null;
        // Re-open with the currently-selected sub's parent expanded, so the user
        // sees their current pick in context (Apple Recents / Notion keep-context).
        const sel = categories.find((c) => c.id === selectedId);
        expandedIds =
          sel !== undefined && sel.parent_id !== undefined && sel.parent_id !== ''
            ? new Set([sel.parent_id])
            : new Set();
        // Deliberately DO NOT auto-focus the search input — Hemanth's feedback:
        // "when clicked on categories why to open keyboard? only when we click
        // on search or add new then it need to open".
      });
    }
    wasOpen = isOpen;
  });

  /** Base list — when `restrictToParent` is set, only that parent's
   *  children are eligible.  Otherwise every category is in scope and
   *  the existing parent-then-children rendering takes care of layout. */
  const inScope = $derived.by<Category[]>(() => {
    if (restrictToParent === undefined) return categories;
    return categories.filter((c) => c.parent_id === restrictToParent);
  });
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return inScope;
    return inScope.filter((c) => c.name.toLowerCase().includes(q));
  });

  const favSet = $derived(new Set(favIds));
  const favs = $derived(filtered.filter((c) => favSet.has(c.id)));
  /** Does the user have ANY sub-category yet?  Drives a small "tap Edit
   *  to add sub-categories" hint at the bottom of the picker — shown
   *  ONLY when the user has none yet, so it teaches the feature once
   *  and then disappears.  Skip in restrictToParent mode (the user is
   *  already inside the sub-flow). */
  const hasAnySub = $derived(
    categories.some((c) => c.parent_id !== undefined && c.parent_id !== '')
  );
  /** Sub-category count per parent id — a parent only gets an expand caret
   *  (and a collapse gate) when it actually has children. */
  const childCountByParent = $derived.by<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const c of categories) {
      if (c.parent_id !== undefined && c.parent_id !== '') {
        m.set(c.parent_id, (m.get(c.parent_id) ?? 0) + 1);
      }
    }
    return m;
  });
  /** While searching, force every parent open so matched subs aren't hidden
   *  behind a closed caret (YNAB search-to-filter composes with the accordion). */
  const searching = $derived(query.trim().length > 0);
  function isExpanded(parentId: string): boolean {
    return searching || expandedIds.has(parentId);
  }
  /** The parent Category of a sub (for "Food › Biryani" context on a favorite). */
  function parentOf(c: Category): Category | null {
    if (c.parent_id === undefined || c.parent_id === '') return null;
    return categories.find((p) => p.id === c.parent_id) ?? null;
  }
  /** Non-favourite categories laid out as a DEPTH-aware tree (DFS): each parent
   *  followed by its (expanded) children, recursively — so nesting works at any
   *  level (Food › Breakfast › Idli). Collapsed parents hide their whole subtree.
   *  Orphans (parent filtered out / deleted) appear at depth 0 so they stay
   *  tappable. `kidCount` is the real child count (drives the caret). */
  interface Row {
    c: Category;
    depth: number;
    kidCount: number;
  }
  const others = $derived.by<Row[]>(() => {
    const nonFav = filtered.filter((c) => !favSet.has(c.id));
    const idSet = new Set(nonFav.map((c) => c.id));
    const childrenByParent = new Map<string, Category[]>();
    for (const c of nonFav) {
      const pid = c.parent_id ?? '';
      const arr = childrenByParent.get(pid);
      if (arr) arr.push(c);
      else childrenByParent.set(pid, [c]);
    }
    const out: Row[] = [];
    const seen = new Set<string>();
    const walk = (c: Category, depth: number): void => {
      if (seen.has(c.id)) return; // cycle / re-entry guard
      seen.add(c.id);
      const kidCount = childCountByParent.get(c.id) ?? 0;
      out.push({ c, depth, kidCount });
      if (kidCount > 0 && isExpanded(c.id)) {
        for (const k of childrenByParent.get(c.id) ?? []) walk(k, depth + 1);
      }
    };
    // Roots = top-level, plus orphans whose parent isn't in the visible set.
    // Children of a COLLAPSED (but present) parent are intentionally left unseen
    // here — they stay hidden until the parent is expanded. We deliberately do
    // NOT append "unseen" items, or a collapsed parent's children would leak to
    // the bottom of the list (caught in live testing: Biryani showed under no
    // parent while Food was collapsed).
    for (const c of nonFav) {
      const pid = c.parent_id ?? '';
      if (pid === '' || !idSet.has(pid)) walk(c, 0);
    }
    return out;
  });

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
  function toggleExpand(id: string): void {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }
  /** Row tap. A parent that HAS sub-categories expands to reveal them (and is
   *  tentatively selected) WITHOUT closing — Hemanth: "tapping food should
   *  also open subs". A leaf (a sub, or a parent with no subs) selects + closes. */
  function onRowTap(c: Category): void {
    if (editMode) return;
    // Any category that HAS children expands (incl. a sub with sub-subs —
    // Food › Breakfast › Idli). A leaf selects + closes.
    const hasKids = (childCountByParent.get(c.id) ?? 0) > 0;
    if (hasKids) {
      onSelect(c.id);
      toggleExpand(c.id);
      return;
    }
    pick(c.id);
  }
  function toggleFav(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    favIds = toggleFavoriteCategory(id);
  }
  function startDelete(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    confirmDeleteId = id;
  }
  function startRename(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    renameId = id;
  }
  /** Per-row inline "+ Sub" state — when set, the parent row reveals an
   *  input where the user types the sub-category name.  Submit creates
   *  the sub via onCreate(name, parentId). */
  let addSubParentId = $state<string | null>(null);
  let addSubName = $state('');
  let addSubIcon = $state(''); // '' = auto-pick from the typed name
  let addSubIconPickerOpen = $state(false);
  let addSubInputEl = $state<HTMLInputElement | null>(null);
  function startAddSub(parentId: string, ev: MouseEvent): void {
    ev.stopPropagation();
    addSubParentId = parentId;
    addSubName = '';
    addSubIcon = '';
    // Expand the parent so the new sub appears under it once created.
    expandedIds = new Set(expandedIds).add(parentId);
    tick().then(() => {
      try {
        addSubInputEl?.focus();
      } catch {
        /* noop */
      }
    });
  }
  function cancelAddSub(): void {
    addSubParentId = null;
    addSubName = '';
    addSubIcon = '';
  }
  /** Create the sub and KEEP the input open + focused so the user can add
   *  several in a row (Breakfast, Lunch, Dinner, Snacks) without re-tapping.
   *  The parent stays expanded so the just-added sub appears immediately under
   *  it — fixing "after adding, the category minimized / I can't see what
   *  happened". Tap ✕ / Done to finish. */
  function submitAddSub(): void {
    if (onCreate === undefined || addSubParentId === null) return;
    const name = addSubName.trim();
    if (name.length === 0) return;
    const parentId = addSubParentId;
    onCreate(name, parentId, addSubIcon === '' ? undefined : addSubIcon);
    addSubName = '';
    addSubIcon = '';
    expandedIds = new Set(expandedIds).add(parentId);
    tick().then(() => {
      try {
        addSubInputEl?.focus();
      } catch {
        /* noop */
      }
    });
  }
  const renameTarget = $derived(
    renameId === null ? null : (categories.find((c) => c.id === renameId) ?? null)
  );
  function handleRenameSave(patch: { name: string; icon: string }): void {
    if (renameId === null || onRename === undefined) return;
    onRename(renameId, patch);
    renameId = null;
  }
  /** Resolve a category's display icon: respect explicit override; else
   *  auto-map by name.  Single source of truth used by every row + the
   *  rename preview. */
  function iconFor(c: Category): GlyphKey {
    return c.icon && c.icon.length > 0 ? (c.icon as GlyphKey) : categoryIconName(c.name);
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
    // When picker is in sub-category mode, "+ Create" makes a child of
    // the restricted parent — not a new top-level category.
    onCreate(q, restrictToParent);
    query = '';
    onClose();
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Pick a category">
    <div class="grab"></div>

    <div class="head">
      <h2>
        {#if restrictToParent !== undefined}
          {editMode ? 'Edit sub-categories' : 'Pick a sub-category'}
        {:else}
          {editMode ? 'Edit categories' : 'Pick a category'}
        {/if}
      </h2>
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
        bind:this={searchInputEl}
        aria-label="Search categories"
      />
    </div>

    <div class="body">
      {#if restrictToParent !== undefined && !editMode}
        <!-- Sub-category mode offers a "(no sub)" row so the user can
             clear the sub without closing the sheet. -->
        <div class="row" class:selected={selectedId === null}>
          <button type="button" class="row-main" onclick={() => pick(null)}>
            <span class="icon dot-icon">
              <span class="dot" style:background-color="var(--color-muted)"></span>
            </span>
            <span class="name muted">(no sub-category)</span>
          </button>
          <span class="star-placeholder"></span>
        </div>
      {/if}

      {#if favs.length > 0 && restrictToParent === undefined}
        <div class="section-head">★ Favorites</div>
        {#each favs as c (c.id)}
          {@const fp = parentOf(c)}
          <div class="row" class:selected={c.id === selectedId}>
            <button type="button" class="row-main" onclick={() => pick(c.id)} disabled={editMode}>
              <span class="icon">
                <CategoryIcon icon={iconFor(c)} color={categoryColor(fp ? fp.id : c.id)} tint />
              </span>
              {#if fp}
                <span class="name"><span class="crumb">{fp.name} ›</span> {c.name}</span>
              {:else}
                <span class="name">{c.name}</span>
              {/if}
            </button>
            {#if editMode}
              {#if onRename !== undefined}
                <button
                  type="button"
                  class="pencil"
                  aria-label="Rename {c.name}"
                  onclick={(ev) => startRename(c.id, ev)}
                >
                  ✏
                </button>
              {/if}
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

      {#if others.length > 0 && favs.length > 0 && restrictToParent === undefined}
        <div class="section-head muted">All categories</div>
      {/if}

      {#if !editMode && restrictToParent === undefined}
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

      {#each others as row (row.c.id)}
        {@const c = row.c}
        {@const depth = row.depth}
        {@const kidCount = row.kidCount}
        {@const isChild = depth > 0}
        <div class="row" class:selected={c.id === selectedId} class:child={isChild}>
          <button
            type="button"
            class="row-main"
            style:padding-left={`${0.55 + depth * 1.05}rem`}
            onclick={() => onRowTap(c)}
            disabled={editMode}
            aria-expanded={kidCount > 0 ? isExpanded(c.id) : undefined}
          >
            {#if isChild}
              <span class="indent-rail" aria-hidden="true"></span>
            {/if}
            <span class="icon">
              <CategoryIcon
                icon={iconFor(c)}
                color={categoryColor(isChild ? (c.parent_id ?? c.id) : c.id)}
                tint
              />
            </span>
            <span class="name">{c.name}</span>
            {#if kidCount > 0}
              <span class="caret" aria-hidden="true">{isExpanded(c.id) ? '▾' : '▸'}</span>
            {/if}
          </button>
          {#if editMode}
            {#if onCreate !== undefined}
              <button
                type="button"
                class="addsub"
                aria-label="Add sub-category under {c.name}"
                onclick={(ev) => startAddSub(c.id, ev)}
              >
                ＋
              </button>
            {/if}
            {#if onRename !== undefined}
              <button
                type="button"
                class="pencil"
                aria-label="Rename {c.name}"
                onclick={(ev) => startRename(c.id, ev)}
              >
                ✏
              </button>
            {/if}
            <button
              type="button"
              class="trash"
              aria-label="Delete {c.name}"
              onclick={(ev) => startDelete(c.id, ev)}
            >
              🗑
            </button>
          {:else}
            {#if onCreate !== undefined}
              <button
                type="button"
                class="addsub-pill"
                aria-label="Add a sub-category under {c.name}"
                onclick={(ev) => startAddSub(c.id, ev)}
              >
                ＋ sub
              </button>
            {/if}
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
        {#if addSubParentId === c.id}
          <!-- Inline input + icon chip for a new sub under this row. Stays open
               after each Add so several subs can be added in a row. -->
          <div class="addsub-row" style:padding-left={`${0.4 + (depth + 1) * 1.05}rem`}>
            <button
              type="button"
              class="addsub-iconchip"
              aria-label="Choose an icon for the new sub-category"
              onclick={() => (addSubIconPickerOpen = true)}
            >
              <CategoryIcon
                icon={addSubIcon !== '' ? (addSubIcon as GlyphKey) : categoryIconName(addSubName)}
                color={categoryColor(c.id)}
                tint
                size={20}
              />
            </button>
            <input
              type="text"
              bind:value={addSubName}
              bind:this={addSubInputEl}
              placeholder="Sub-category name…"
              class="addsub-input"
              autocomplete="off"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitAddSub();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelAddSub();
                }
              }}
            />
            <button
              type="button"
              class="addsub-cancel"
              onclick={cancelAddSub}
              aria-label="Done adding sub-categories">✕</button
            >
            <button
              type="button"
              class="addsub-save"
              onclick={submitAddSub}
              disabled={addSubName.trim().length === 0}
            >
              Add
            </button>
          </div>
        {/if}
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

      {#if !editMode && !hasAnySub && restrictToParent === undefined && onCreate !== undefined && query.trim().length === 0}
        <!-- One-time discoverability hint.  Disappears as soon as the user
             has at least one sub-category anywhere.  Doesn't run in
             restrictToParent mode (they're already in the sub-flow). -->
        <p class="subcat-hint">
          💡 Want sub-categories? Tap <strong>＋ sub</strong> next to any category (e.g. add “Biryani”
          under Food).
        </p>
      {/if}
    </div>
  </div>

  <!-- Rename + icon-edit sub-sheet (stacks ABOVE the picker) -->
  <CategoryRenameSheet
    open={renameTarget !== null}
    category={renameTarget}
    onSave={handleRenameSave}
    onClose={() => (renameId = null)}
  />

  <!-- Icon picker for the new sub-category being typed (stacks ABOVE the picker) -->
  <IconPickerSheet
    open={addSubIconPickerOpen}
    value={addSubIcon}
    name={addSubName}
    color={addSubParentId !== null ? categoryColor(addSubParentId) : 'var(--color-muted)'}
    onPick={(g) => (addSubIcon = g)}
    onClose={() => (addSubIconPickerOpen = false)}
  />

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
    /* Keyboard-avoid: bottom edge lifts up by the soft-keyboard height
       (--kb-inset-bottom is set by src/lib/app/keyboard-inset.ts on
       <html> via the visualViewport API).  When no keyboard is open
       the variable falls back to 0px so the sheet sits at the bottom
       as usual.  This is the standard mobile-web pattern (Slack,
       WhatsApp web, Notion) so the search input is never hidden. */
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 80;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 0 calc(0.8rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: rise 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-height: calc(80dvh - var(--kb-inset-bottom, 0px));
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
  /* Parent breadcrumb shown on a favorited sub ("Food › Biryani") so a
     favorite never loses its parent context (Hemanth's de-indent bug). */
  .row .name .crumb {
    color: var(--color-muted);
    font-weight: 600;
  }
  /* Expand/collapse caret on a parent that has sub-categories. Pushed to the
     right of the row by the flex:1 name. */
  .caret {
    flex-shrink: 0;
    color: var(--color-muted);
    font-size: 0.7rem;
    margin-left: 0.35rem;
  }

  .star,
  .star-placeholder,
  .trash,
  .pencil {
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
  .trash:hover,
  .pencil:hover {
    background: var(--color-surface-hover);
    color: var(--color-text);
  }
  .pencil {
    color: var(--color-accent);
  }
  .addsub {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: none;
    border: 0;
    color: var(--color-accent);
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
    border-radius: 999px;
  }
  .addsub:hover {
    background: var(--color-accent-soft);
  }
  /* Always-visible "+ sub" affordance on parent rows in normal mode — makes
     sub-categories discoverable without entering Edit mode (Hemanth, 2026-05-29:
     "sub categories is not visible to me"). Tapping it opens the same inline
     add-sub input the Edit-mode ＋ uses. */
  .addsub-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    height: 26px;
    padding: 0 0.5rem;
    margin-right: 0.1rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: transparent;
    color: var(--color-accent);
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .addsub-pill:hover {
    background: var(--color-accent-soft);
    border-color: var(--color-accent);
  }
  /* ── Sub-category indentation ─────────────────────────── */
  .row.child .row-main {
    padding-left: 0.3rem;
  }
  .indent-rail {
    display: inline-block;
    width: 18px;
    flex-shrink: 0;
    border-left: 2px solid var(--color-border);
    margin-left: 0.4rem;
    margin-right: 0.4rem;
    height: 18px;
    position: relative;
  }
  .indent-rail::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: 10px;
    border-top: 2px solid var(--color-border);
  }
  /* ── Inline add-sub input row ─────────────────────────── */
  .addsub-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.55rem;
    background: var(--color-accent-soft);
    border-radius: 12px;
    margin: 0.2rem 0;
  }
  .addsub-iconchip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface);
    cursor: pointer;
  }
  .addsub-iconchip:hover {
    border-color: var(--color-accent);
  }
  .addsub-input {
    flex: 1;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    color: var(--color-text);
    min-width: 0;
  }
  .addsub-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .addsub-cancel,
  .addsub-save {
    border: 0;
    border-radius: 8px;
    padding: 0.4rem 0.65rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .addsub-cancel {
    background: transparent;
    color: var(--color-muted);
  }
  .addsub-save {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
  }
  .addsub-save:disabled {
    opacity: 0.55;
    cursor: default;
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
  /* One-time discoverability hint for sub-categories — light tinted
     background so it reads as a "tip" not part of the row list. */
  .subcat-hint {
    margin: 0.5rem 0.3rem 0.2rem;
    padding: 0.55rem 0.7rem;
    background: var(--color-accent-soft);
    border-radius: 10px;
    font-size: 0.78rem;
    color: var(--color-text);
    line-height: 1.4;
  }
  .subcat-hint strong {
    color: var(--color-accent);
    font-weight: 700;
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
