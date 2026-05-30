<script lang="ts">
  // CategoryRenameSheet — rename + icon picker for an existing category.
  // Opens above the CategoryPicker from the ✏ button in edit mode.
  //
  // Hemanth: "rename option for category should also give an option to edit
  // the logo for that category. Auto-suggest based on the name and also let
  // them define their own logo from the list."  Implementation:
  //   • Name input (live).
  //   • Icon grid (every IconKey in ICON_OPTIONS).  The "auto" tile sits
  //     first and tracks the name-derived suggestion in real time — pick
  //     it to clear any manual override; pick any other tile to pin it.

  import { categoryColor, categoryIconName, type GlyphKey } from '$lib/app/category-visuals';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import IconPickerSheet from '$components/IconPickerSheet.svelte';
  import type { Category } from '$lib/app/categorization';

  interface Props {
    open: boolean;
    category: Category | null;
    onSave: (patch: { name: string; icon: string }) => void;
    onClose: () => void;
  }
  const { open, category, onSave, onClose }: Props = $props();

  let name = $state('');
  // `icon` is '' when the user wants the auto-suggested icon (no override).
  // Otherwise it's a concrete IconKey the user pinned.
  let iconOverride = $state<string>('');

  $effect(() => {
    if (open && category !== null) {
      name = category.name;
      iconOverride = category.icon ?? '';
    }
  });

  /** Live-suggested icon based on the current name (used when no override). */
  const suggested = $derived<GlyphKey>(categoryIconName(name));
  /** The icon currently used to preview the saved state. */
  const effective = $derived<GlyphKey>(
    iconOverride !== '' ? (iconOverride as GlyphKey) : suggested
  );
  const color = $derived(category ? categoryColor(category.id) : 'var(--color-muted)');

  function save(): void {
    if (category === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onSave({ name: trimmed, icon: iconOverride });
    onClose();
  }
  function cancel(): void {
    onClose();
  }
  let iconPickerOpen = $state(false);
  function chooseIcon(glyph: string): void {
    iconOverride = glyph;
  }
</script>

{#if open && category !== null}
  <button type="button" class="crs-backdrop" aria-label="Cancel" onclick={cancel}></button>
  <div class="crs-sheet" role="dialog" aria-modal="true" aria-label="Rename category">
    <div class="crs-grab"></div>

    <div class="crs-head">
      <h2>Edit category</h2>
      <button type="button" class="crs-close" onclick={cancel} aria-label="Close">✕</button>
    </div>

    <!-- Preview -->
    <div class="crs-preview">
      <span class="crs-preview-icon">
        <CategoryIcon icon={effective} {color} tint size={26} />
      </span>
      <span class="crs-preview-name">{name.trim() || 'Untitled'}</span>
    </div>

    <!-- Name input -->
    <label class="crs-block">
      <span class="crs-lbl">Name</span>
      <input
        type="text"
        bind:value={name}
        class="crs-field"
        autocomplete="off"
        spellcheck="false"
        placeholder="Food, Tiffin, UPI Send…"
        maxlength="40"
      />
    </label>

    <!-- Icon: tap to open the searchable picker (all icons + dishes + brands) -->
    <div class="crs-block">
      <span class="crs-lbl">Icon</span>
      <button type="button" class="crs-icon-choose" onclick={() => (iconPickerOpen = true)}>
        <CategoryIcon icon={effective} {color} tint size={24} />
        <span class="crs-icon-choose-text">
          {iconOverride === '' ? 'Auto — picked from the name' : 'Custom icon'}
        </span>
        <span class="crs-icon-choose-cta">Change ›</span>
      </button>
    </div>

    <div class="crs-actions">
      <button type="button" class="crs-cancel" onclick={cancel}>Cancel</button>
      <button type="button" class="crs-save" onclick={save} disabled={name.trim().length === 0}>
        Save
      </button>
    </div>
  </div>

  <IconPickerSheet
    open={iconPickerOpen}
    value={iconOverride}
    {name}
    {color}
    onPick={chooseIcon}
    onClose={() => (iconPickerOpen = false)}
  />
{/if}

<style>
  .crs-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(15, 20, 28, 0.55);
    border: 0;
    cursor: pointer;
    animation: crs-fade 0.18s ease both;
  }
  @keyframes crs-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .crs-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 100;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.6rem 1.1rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: crs-rise 0.24s cubic-bezier(0.16, 1, 0.3, 1) both;
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    max-height: calc(95dvh - var(--kb-inset-bottom, 0px));
    overflow-y: auto;
  }
  @keyframes crs-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .crs-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.2rem auto 0.4rem;
  }
  .crs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .crs-head h2 {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .crs-close {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--color-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .crs-preview {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 0.9rem;
    background: var(--color-elevated);
    border-radius: 14px;
    border: 1px solid var(--color-border);
  }
  .crs-preview-icon {
    display: inline-flex;
    align-items: center;
  }
  .crs-preview-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .crs-block {
    display: flex;
    flex-direction: column;
  }
  .crs-lbl {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--color-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 0.35rem;
  }
  .crs-field {
    width: 100%;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    border-radius: 10px;
    padding: 0.6rem 0.75rem;
    font-size: 0.95rem;
    font-family: inherit;
  }
  .crs-field:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .crs-icon-choose {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.65rem 0.9rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
  }
  .crs-icon-choose:hover {
    background: var(--color-elevated);
    border-color: var(--color-accent);
  }
  .crs-icon-choose-text {
    flex: 1;
    font-size: 0.9rem;
    color: var(--color-text);
  }
  .crs-icon-choose-cta {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-accent);
  }
  .crs-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .crs-cancel,
  .crs-save {
    padding: 0.8rem;
    border-radius: 12px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--color-border);
  }
  .crs-cancel {
    background: var(--color-elevated);
    color: var(--color-text);
  }
  .crs-save {
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    border-color: transparent;
  }
  .crs-save:disabled {
    opacity: 0.6;
    cursor: default;
    filter: grayscale(0.4);
  }
</style>
