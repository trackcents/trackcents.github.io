<script lang="ts">
  // Generic confirm bottom-sheet. Used for destructive actions (e.g. deleting a
  // recurring bill) so the action is deliberate, never a stray tap. Backdrop tap
  // and Escape both cancel; the confirm button can be styled danger-red.
  interface Props {
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onClose: () => void;
  }
  const {
    open,
    title,
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onConfirm,
    onClose
  }: Props = $props();

  function onKey(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <button type="button" class="cs-backdrop" aria-label="Cancel" onclick={onClose}></button>
  <div class="cs-sheet" role="dialog" aria-modal="true" aria-label={title}>
    <div class="cs-grab"></div>
    <h2 class="cs-title">{title}</h2>
    {#if message}<p class="cs-msg">{message}</p>{/if}
    <button type="button" class="cs-btn" class:danger onclick={onConfirm}>{confirmLabel}</button>
    <button type="button" class="cs-cancel" onclick={onClose}>{cancelLabel}</button>
  </div>
{/if}

<style>
  .cs-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .cs-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 110;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    animation: cs-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes cs-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .cs-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.9rem;
  }
  .cs-title {
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--color-text);
    margin-bottom: 0.4rem;
  }
  .cs-msg {
    font-size: 0.9rem;
    color: var(--color-muted);
    line-height: 1.45;
    margin-bottom: 1.1rem;
  }
  .cs-btn {
    width: 100%;
    padding: 0.9rem;
    border-radius: 14px;
    font-weight: 700;
    font-size: 1rem;
    border: 0;
    cursor: pointer;
    font-family: inherit;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
  }
  .cs-btn.danger {
    background-image: none;
    background: var(--color-danger);
    color: #fff;
  }
  .cs-cancel {
    width: 100%;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.9rem;
    margin-top: 0.7rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
</style>
