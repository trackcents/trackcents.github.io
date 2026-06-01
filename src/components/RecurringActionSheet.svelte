<script lang="ts">
  // Per-row "more actions" sheet for a recurring bill/subscription, opened by the
  // trailing ⋮ on each row. This is the DISCOVERABLE home for Edit + Delete
  // (replacing the old invisible "tap the name to edit" and the misleading global
  // Edit/Done delete-mode). Self-identifying header + explicitly LABELLED actions
  // so a first-time user never has to guess. Pay stays one-tap on the row circle;
  // it's repeated here as the first item for anyone who opens the menu first.
  import { formatMoney } from '$lib/util/money';
  import type { RecurringItem } from '$lib/app/recurring-items';

  interface Props {
    open: boolean;
    item: RecurringItem | null;
    /** Label for the pay action, e.g. "Mark paid for Jun 2026…" (page computes it). */
    payLabel: string;
    onMarkPaid: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onClose: () => void;
  }
  const { open, item, payLabel, onMarkPaid, onEdit, onDelete, onClose }: Props = $props();

  function onKey(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open && item !== null}
  <button type="button" class="as-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="as-sheet" role="dialog" aria-modal="true" aria-label="Actions for {item.name}">
    <div class="as-grab"></div>
    <p class="as-head">
      <span class="as-name">{item.name}</span>
      <span class="as-amt">{formatMoney(item.amount_minor)}</span>
    </p>

    <button type="button" class="as-item" onclick={onMarkPaid}>
      <span class="as-ic">✓</span>
      <span>{payLabel}</span>
    </button>
    <button type="button" class="as-item" onclick={onEdit}>
      <span class="as-ic">✎</span>
      <span>Edit bill</span>
    </button>
    <button type="button" class="as-item danger" onclick={onDelete}>
      <span class="as-ic">🗑</span>
      <span>Delete bill</span>
    </button>

    <button type="button" class="as-cancel" onclick={onClose}>Cancel</button>
  </div>
{/if}

<style>
  .as-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .as-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 1rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    animation: as-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes as-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .as-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.7rem;
  }
  .as-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0 0.25rem 0.7rem;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 0.45rem;
  }
  .as-name {
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .as-amt {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-muted);
    flex: none;
  }
  .as-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.95rem 0.5rem;
    background: none;
    border: 0;
    border-radius: 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    text-align: left;
  }
  .as-item:active {
    background: var(--color-elevated);
  }
  .as-item.danger {
    color: var(--color-danger);
  }
  .as-ic {
    width: 24px;
    text-align: center;
    font-size: 1.05rem;
    flex: none;
  }
  .as-cancel {
    width: 100%;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.9rem;
    margin-top: 0.6rem;
    padding: 0.5rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
</style>
