<script lang="ts">
  // Animated Share → Add-to-Home-Screen guide for iOS Safari (T112 / FR-001).
  // Self-dismissing: when the app is relaunched in standalone (home-screen) mode,
  // it auto-detects and fires `oncomplete` — no need for the user to confirm.
  import { onMount } from 'svelte';
  import { isStandalone } from '$lib/app/platform';

  let { oncomplete }: { oncomplete?: () => void } = $props();

  onMount(() => {
    // iOS relaunches a home-screen install in standalone display mode and fires
    // visibilitychange when the user returns from the Share sheet — watch both.
    const check = (): void => {
      if (isStandalone()) oncomplete?.();
    };
    const mq =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null;
    mq?.addEventListener?.('change', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      mq?.removeEventListener?.('change', check);
      document.removeEventListener('visibilitychange', check);
    };
  });

  const steps = [
    { n: 1, text: 'Tap the Share button in Safari’s toolbar' },
    { n: 2, text: 'Scroll down and choose “Add to Home Screen”' },
    { n: 3, text: 'Open trackcents from your home screen' }
  ];
</script>

<div class="rounded-lg border p-4" style="border-color: var(--color-border);">
  <div class="flex items-center gap-3">
    <span class="share-pulse inline-flex h-10 w-10 items-center justify-center rounded-full">
      <!-- iOS Share glyph: box with an up arrow -->
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-accent)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12" />
        <path d="M8 7l4-4 4 4" />
        <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
      </svg>
    </span>
    <h2 class="text-lg font-semibold">Install to your home screen first</h2>
  </div>

  <p class="mt-2 text-sm" style:color="var(--color-muted)">
    On iPhone/iPad, Safari clears web-app data after about a week. Installing to your home screen
    keeps your encrypted data safe between visits.
  </p>

  <ol class="mt-4 space-y-2">
    {#each steps as s (s.n)}
      <li class="flex items-start gap-2 text-sm">
        <span
          class="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-medium"
          style="background-color: color-mix(in oklab, var(--color-accent) 16%, transparent); color: var(--color-accent);"
        >
          {s.n}
        </span>
        <span>{s.text}</span>
      </li>
    {/each}
  </ol>

  <p class="mt-4 text-xs" style:color="var(--color-muted)">
    We’ll continue automatically once you reopen the installed app. If it doesn’t,
  </p>
  <button type="button" class="mt-1 text-sm underline" onclick={() => oncomplete?.()}>
    I’ve installed it — continue
  </button>
</div>

<style>
  .share-pulse {
    background-color: color-mix(in oklab, var(--color-accent) 14%, transparent);
    animation: share-pulse 1.8s ease-in-out infinite;
  }
  @keyframes share-pulse {
    0%,
    100% {
      transform: translateY(0);
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--color-accent) 35%, transparent);
    }
    50% {
      transform: translateY(-3px);
      box-shadow: 0 0 0 6px color-mix(in oklab, var(--color-accent) 0%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .share-pulse {
      animation: none;
    }
  }
</style>
