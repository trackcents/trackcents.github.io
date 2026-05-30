<script lang="ts">
  // Renders a distinct per-dish food illustration (idli, dosa, vada, …) from the
  // generated shape registry. Draws in its OWN appetizing palette (not the
  // category tint) so the dish stays recognizable; the optional tint square uses
  // the category colour as a soft backdrop, matching CategoryIcon.
  import { FOOD_ICONS, FOOD_PALETTE, type FoodKey } from '$lib/app/food-icons';

  let {
    food,
    color = 'var(--color-muted)',
    size = 18,
    tint = false
  }: { food: FoodKey; color?: string; size?: number; tint?: boolean } = $props();

  const def = $derived(FOOD_ICONS[food]);
  const px = (t: string | undefined): string =>
    !t || t === 'none' ? 'none' : (FOOD_PALETTE[t] ?? '#97592A');
  const pts = (p: number[][] | undefined): string =>
    (p ?? []).map((xy) => `${xy[0]},${xy[1]}`).join(' ');
</script>

{#snippet glyph()}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#each def.shapes as s, i (i)}
      {#if s.k === 'ellipse'}
        <ellipse
          cx={s.cx}
          cy={s.cy}
          rx={s.rx}
          ry={s.ry}
          fill={px(s.fill)}
          stroke={px(s.stroke)}
          stroke-width={s.sw ?? 0}
        />
      {:else if s.k === 'circle'}
        <circle
          cx={s.cx}
          cy={s.cy}
          r={s.r}
          fill={px(s.fill)}
          stroke={px(s.stroke)}
          stroke-width={s.sw ?? 0}
        />
      {:else if s.k === 'rect'}
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={s.round ?? 0}
          fill={px(s.fill)}
          stroke={px(s.stroke)}
          stroke-width={s.sw ?? 0}
        />
      {:else if s.k === 'tri' || s.k === 'poly'}
        <polygon
          points={pts(s.points)}
          fill={px(s.fill)}
          stroke={px(s.stroke)}
          stroke-width={s.sw ?? 0}
        />
      {:else if s.k === 'line'}
        <line
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={px(s.stroke)}
          stroke-width={s.sw ?? 1.5}
        />
      {/if}
    {/each}
  </svg>
{/snippet}

{#if tint}
  <span
    class="inline-flex items-center justify-center rounded-lg"
    style="width: {size + 16}px; height: {size +
      16}px; background-color: color-mix(in oklab, {color} 16%, transparent);"
  >
    {@render glyph()}
  </span>
{:else}
  {@render glyph()}
{/if}
