<script lang="ts">
  // Horizontal month navigator wrapping the BudgetBox (or any child) — provides
  // prev/next chevrons VERTICALLY CENTERED on the card edges (per Hemanth's
  // explicit ask: "the arrow has to be in the middle of it, not at the top"),
  // plus a swipe gesture on touch devices.  Renders children for the active
  // month; the parent controls which month is active and reacts to changes.

  import type { Snippet } from 'svelte';

  interface Props {
    /** Chronologically ordered months (oldest → newest), YYYY-MM strings. */
    months: string[];
    /** The currently active month — must be in `months`. */
    currentMonth: string;
    /** Called when the user navigates to a different month. */
    onChange: (newMonth: string) => void;
    /** The content for the active month (typically <BudgetBox …/>). */
    children?: Snippet;
  }

  const { months, currentMonth, onChange, children }: Props = $props();

  const idx = $derived(months.indexOf(currentMonth));
  const hasPrev = $derived(idx > 0);
  const hasNext = $derived(idx >= 0 && idx < months.length - 1);

  function prev(): void {
    if (hasPrev) onChange(months[idx - 1]!);
  }
  function next(): void {
    if (hasNext) onChange(months[idx + 1]!);
  }

  // ── Swipe gesture (touch only; arrows handle desktop) ──────────────────────
  let startX = 0;
  let dx = 0;
  let dragging = false;
  let suppressClickUntil = 0; // prevent accidental tap-after-swipe.

  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    startX = e.touches[0]!.clientX;
    dx = 0;
    dragging = true;
  }
  function onTouchMove(e: TouchEvent): void {
    if (!dragging || e.touches.length !== 1) return;
    dx = e.touches[0]!.clientX - startX;
  }
  function onTouchEnd(): void {
    if (!dragging) return;
    dragging = false;
    const threshold = 50;
    if (dx < -threshold) {
      next();
      suppressClickUntil = Date.now() + 300;
    } else if (dx > threshold) {
      prev();
      suppressClickUntil = Date.now() + 300;
    }
    dx = 0;
  }
  function onClickCapture(e: MouseEvent): void {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<!--
  Touch + click handlers are intentional: this `<div>` is the swipe surface.
  Keyboard users navigate via the rendered arrow `<button>`s (Tab + Enter),
  which is the accessible path — no tabindex on the wrapper.
-->
<div
  class="slider"
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
  onclickcapture={onClickCapture}
  role="region"
  aria-label="Month navigator"
>
  {@render children?.()}

  {#if hasPrev}
    <button type="button" class="arrow arrow-prev" onclick={prev} aria-label="Previous month">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg
      >
    </button>
  {/if}
  {#if hasNext}
    <button type="button" class="arrow arrow-next" onclick={next} aria-label="Next month">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg
      >
    </button>
  {/if}
</div>

<style>
  .slider {
    position: relative;
    outline: none;
  }
  .arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
    color: var(--color-text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease,
      box-shadow 0.16s ease;
    z-index: 2;
  }
  .arrow:hover {
    background: var(--color-elevated);
    box-shadow: var(--shadow);
  }
  .arrow:active {
    transform: translateY(-50%) scale(0.92);
  }
  .arrow-prev {
    left: -10px;
  }
  .arrow-next {
    right: -10px;
  }
  /* On narrower screens, tuck arrows INSIDE the card edge so they don't risk
     a horizontal overflow (we have overflow-x: clip globally, but better not
     to invite clipping of the buttons themselves). */
  @media (max-width: 520px) {
    .arrow-prev {
      left: 6px;
    }
    .arrow-next {
      right: 6px;
    }
    .arrow {
      width: 32px;
      height: 32px;
    }
  }
</style>
