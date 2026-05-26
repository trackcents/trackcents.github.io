<script lang="ts">
  // trackcents brand mark — a gradient tile holding the ¢ glyph, with an optional
  // two-tone "trackcents" wordmark. Single source of truth for the logo so the
  // nav, onboarding and error pages stay in sync. Name lives here, not scattered.
  interface Props {
    /** Tile edge length in px (the wordmark scales from this). */
    size?: number;
    /** Show the "trackcents" wordmark beside the tile. */
    wordmark?: boolean;
  }
  let { size = 30, wordmark = true }: Props = $props();
</script>

<span class="inline-flex items-center gap-2">
  <span
    class="tile"
    style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.58)}px;"
    aria-hidden="true">¢</span
  >
  {#if wordmark}
    <span class="word" style="font-size:{Math.round(size * 0.5)}px;"
      >track<span class="accent">cents</span></span
    >
  {/if}
</span>

<style>
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 700;
    line-height: 1;
    box-shadow: var(--shadow-primary);
  }
  .word {
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--color-text);
  }
  .accent {
    color: var(--color-accent);
  }
</style>
