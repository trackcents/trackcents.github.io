<script lang="ts">
  // Thin top bar for the installed (home-screen) app, which has no browser
  // address bar / reload button. Holds the brand + a Refresh control. When a new
  // version has been deployed it turns into an "Update" button. Also shown in a
  // browser tab WHEN an update is available, so browser users get the prompt too.
  import { base } from '$app/paths';
  import BrandMark from '$components/BrandMark.svelte';
  import {
    updateAvailable,
    updateApplying,
    applyUpdate,
    reloadApp
  } from '$lib/app/app-update.svelte';

  const available = $derived(updateAvailable());
  const applying = $derived(updateApplying());

  function onClick(): void {
    if (available) applyUpdate();
    else reloadApp();
  }
</script>

<div class="topbar" style="border-color: var(--color-border); background: var(--color-surface);">
  <a href="{base}/today" class="brand" aria-label="trackcents home">
    <BrandMark size={22} />
  </a>

  {#if available}
    <span class="hint">New version ready</span>
  {/if}

  <button
    type="button"
    class="action"
    class:update={available}
    onclick={onClick}
    disabled={applying}
    aria-label={available ? 'Update to the new version' : 'Refresh the app'}
  >
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class:spin={applying}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
    </svg>
    <span>{applying ? 'Updating…' : available ? 'Update' : 'Refresh'}</span>
  </button>
</div>

<style>
  .topbar {
    position: fixed;
    inset-inline: 0;
    top: 0;
    z-index: 35;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: calc(2.85rem + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) 0.9rem 0;
    border-bottom: 1px solid;
    /* Sit to the RIGHT of the desktop rail; full width on phones. */
  }
  @media (min-width: 768px) {
    .topbar {
      left: 5rem;
    }
  }
  .brand {
    display: inline-flex;
    align-items: center;
  }
  .hint {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--color-muted);
  }
  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    /* Pushed to the far right; `.hint` (when present) already took margin-left:auto. */
    margin-left: auto;
    padding: 0.32rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      filter 0.15s ease;
  }
  /* When the hint is present it owns margin-left:auto, so the button must not
     also push — neutralise it so they sit together on the right. */
  .hint + .action {
    margin-left: 0;
  }
  .action:not(:disabled):active {
    transform: scale(0.97);
  }
  .action:disabled {
    opacity: 0.7;
    cursor: default;
  }
  .action.update {
    background-image: var(--grad-primary);
    border-color: transparent;
    color: var(--color-accent-fg);
    box-shadow: var(--shadow-primary);
  }
  .spin {
    animation: topbar-spin 0.9s linear infinite;
  }
  @keyframes topbar-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
