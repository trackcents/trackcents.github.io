<script lang="ts">
  // Manage the user-owned Recurring sections: add, rename (name + emoji),
  // reorder (↑ ↓), and delete custom ones. Built-in sections (Bills /
  // Subscriptions) can be renamed but not deleted, so an item never orphans —
  // deleting a custom section moves its items to Bills.
  import type { RecurringSection } from '$lib/app/recurring-items';
  import IconPickerSheet from '$components/IconPickerSheet.svelte';
  import SectionIcon from '$components/SectionIcon.svelte';

  interface Props {
    open: boolean;
    sections: RecurringSection[];
    /** Item count per section id (drives the "N items move to Bills" warning). */
    counts: Record<string, number>;
    onCreate: (name: string, icon: string) => string;
    onRename: (id: string, name: string, icon: string) => void;
    onDelete: (id: string) => void;
    onMove: (id: string, dir: -1 | 1) => void;
    onClose: () => void;
  }
  const { open, sections, counts, onCreate, onRename, onDelete, onMove, onClose }: Props = $props();

  const ordered = $derived([...sections].sort((a, b) => a.order - b.order));

  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editIcon = $state('');
  let confirmingId = $state<string | null>(null);
  let creating = $state(false);
  let newName = $state('');
  let newIcon = $state('');
  // Rich icon picker (same set as bills), shared by the create + rename forms.
  let iconPickerOpen = $state(false);
  let pickerFor = $state<'new' | 'edit'>('new');

  function startRename(s: RecurringSection): void {
    editingId = s.id;
    editName = s.name;
    editIcon = s.icon;
    confirmingId = null;
  }
  function saveRename(): void {
    if (editingId !== null) onRename(editingId, editName, editIcon);
    editingId = null;
  }
  function startCreate(): void {
    creating = true;
    newName = '';
    newIcon = '';
  }
  function openIconPicker(target: 'new' | 'edit'): void {
    pickerFor = target;
    iconPickerOpen = true;
  }
  function saveCreate(): void {
    if (newName.trim() !== '') onCreate(newName, newIcon);
    creating = false;
  }
  function onKey(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <button type="button" class="ms-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="ms-sheet" role="dialog" aria-modal="true" aria-label="Manage sections">
    <div class="ms-grab"></div>
    <div class="ms-head">
      <h2>Manage sections</h2>
      <button type="button" class="ms-x" onclick={onClose} aria-label="Close">✕</button>
    </div>
    <p class="ms-note">Group your bills your way. Deleting a section moves its items to Bills.</p>

    {#each ordered as s (s.id)}
      <div class="ms-row">
        {#if editingId === s.id}
          <div class="ms-edit">
            <div class="ms-edit-row">
              <button
                type="button"
                class="ms-iconbtn"
                onclick={() => openIconPicker('edit')}
                aria-label="Choose section icon"
              >
                <SectionIcon icon={editIcon} name={editName} size={18} />
              </button>
              <input class="ms-in" bind:value={editName} aria-label="Section name" />
              <button type="button" class="ms-ok" onclick={saveRename}>Save</button>
              <button type="button" class="ms-cancel" onclick={() => (editingId = null)}>✕</button>
            </div>
          </div>
        {:else if confirmingId === s.id}
          <div class="ms-confirm">
            <span>
              Delete <b>{s.name}</b>?
              {#if (counts[s.id] ?? 0) > 0}{counts[s.id]} item{counts[s.id] === 1 ? '' : 's'} move to
                Bills.{/if}
            </span>
            <div class="ms-confirm-btns">
              <button
                type="button"
                class="ms-del-yes"
                onclick={() => {
                  onDelete(s.id);
                  confirmingId = null;
                }}>Delete</button
              >
              <button type="button" class="ms-cancel" onclick={() => (confirmingId = null)}
                >Cancel</button
              >
            </div>
          </div>
        {:else}
          <SectionIcon icon={s.icon} name={s.name} size={18} />
          <span class="ms-name">{s.name}</span>
          <span class="ms-count">{counts[s.id] ?? 0}</span>
          <div class="ms-actions">
            <button
              type="button"
              class="ms-mini"
              onclick={() => onMove(s.id, -1)}
              aria-label="Move {s.name} up">↑</button
            >
            <button
              type="button"
              class="ms-mini"
              onclick={() => onMove(s.id, 1)}
              aria-label="Move {s.name} down">↓</button
            >
            <button
              type="button"
              class="ms-mini"
              onclick={() => startRename(s)}
              aria-label="Rename {s.name}">✎</button
            >
            {#if s.builtin !== true}
              <button
                type="button"
                class="ms-mini danger"
                onclick={() => (confirmingId = s.id)}
                aria-label="Delete {s.name}">🗑</button
              >
            {/if}
          </div>
        {/if}
      </div>
    {/each}

    {#if creating}
      <div class="ms-row">
        <div class="ms-edit">
          <div class="ms-edit-row">
            <button
              type="button"
              class="ms-iconbtn"
              onclick={() => openIconPicker('new')}
              aria-label="Choose section icon"
            >
              <SectionIcon icon={newIcon} name={newName} size={18} />
            </button>
            <input
              class="ms-in"
              bind:value={newName}
              placeholder="Section name (e.g. Loans)"
              aria-label="New section name"
            />
            <button type="button" class="ms-ok" onclick={saveCreate}>Add</button>
            <button type="button" class="ms-cancel" onclick={() => (creating = false)}>✕</button>
          </div>
          <p class="ms-icon-hint">Tap the icon to choose from all logos.</p>
        </div>
      </div>
    {:else}
      <button type="button" class="ms-add" onclick={startCreate}>＋ Add section</button>
    {/if}
  </div>

  <IconPickerSheet
    open={iconPickerOpen}
    value={pickerFor === 'new' ? newIcon : editIcon}
    name={pickerFor === 'new' ? newName : editName}
    onPick={(g) => (pickerFor === 'new' ? (newIcon = g) : (editIcon = g))}
    onClose={() => (iconPickerOpen = false)}
  />
{/if}

<style>
  .ms-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .ms-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 1.1rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: calc(88dvh - var(--kb-inset-bottom, 0px));
    overflow-y: auto;
    animation: ms-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes ms-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .ms-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.7rem;
  }
  .ms-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ms-head h2 {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--color-text);
  }
  .ms-x {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    color: var(--color-muted);
    cursor: pointer;
  }
  .ms-note {
    font-size: 0.78rem;
    color: var(--color-muted);
    margin: 0.2rem 0 0.9rem;
  }
  .ms-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--color-border);
  }
  .ms-iconbtn {
    flex: none;
    width: 40px;
    height: 38px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .ms-icon-hint {
    font-size: 0.72rem;
    color: var(--color-muted);
    margin: 0.45rem 0 0;
  }
  .ms-name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ms-count {
    flex: none;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--color-muted);
    background: var(--color-elevated);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }
  .ms-actions {
    display: flex;
    gap: 0.2rem;
    flex: none;
  }
  .ms-mini {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .ms-mini.danger {
    color: var(--color-danger);
  }
  .ms-mini:active {
    background: var(--color-elevated);
  }
  .ms-edit,
  .ms-confirm {
    flex: 1;
    min-width: 0;
  }
  .ms-edit-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .ms-in {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    font-size: 0.95rem;
    font-family: inherit;
    background: var(--color-bg);
    color: var(--color-text);
  }
  .ms-in:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .ms-ok {
    flex: none;
    border: 0;
    border-radius: 10px;
    padding: 0.55rem 0.9rem;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }
  .ms-cancel {
    flex: none;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    background: var(--color-surface);
    color: var(--color-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
  }
  .ms-confirm {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--color-text);
  }
  .ms-confirm-btns {
    display: flex;
    gap: 0.4rem;
  }
  .ms-del-yes {
    flex: none;
    border: 0;
    border-radius: 10px;
    padding: 0.5rem 0.9rem;
    background: var(--color-danger);
    color: #fff;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }
  .ms-add {
    width: 100%;
    border: 1.5px dashed var(--color-border);
    border-radius: 14px;
    padding: 0.8rem;
    text-align: center;
    color: var(--color-accent);
    font-weight: 700;
    font-size: 0.9rem;
    background: transparent;
    cursor: pointer;
    margin-top: 0.7rem;
    font-family: inherit;
  }
</style>
