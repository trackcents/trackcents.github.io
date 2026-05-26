<script lang="ts">
  // Light/dark toggle for the header. Sun in dark mode (tap → go light),
  // moon in light mode (tap → go dark).
  import { themeMode, toggleTheme } from '$lib/app/theme.svelte';
  const dark = $derived(themeMode() === 'dark');
</script>

<button
  type="button"
  onclick={toggleTheme}
  class="flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
  style="border-color: var(--color-border); background-color: var(--color-surface); color: var(--color-muted); box-shadow: var(--shadow-sm);"
  aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
  title={dark ? 'Light mode' : 'Dark mode'}
>
  {#if dark}
    <!-- sun -->
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      />
    </svg>
  {:else}
    <!-- moon -->
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  {/if}
</button>
