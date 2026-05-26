<script lang="ts">
  // Pictogram for a category (Rocket-Money cue). `tint` draws it in a soft
  // rounded square filled with the category colour at low opacity. Icons are
  // rendered as real <path>/<circle> elements (no {@html}).
  import type { IconKey } from '$lib/app/category-visuals';

  let {
    icon,
    color = 'var(--color-muted)',
    size = 18,
    tint = false
  }: { icon: IconKey; color?: string; size?: number; tint?: boolean } = $props();

  type Shape = { p: string[]; c?: Array<[number, number, number]> };
  const ICONS: Record<IconKey, Shape> = {
    cart: {
      p: ['M2 3h3l2.4 12.2a1.5 1.5 0 0 0 1.5 1.3h8.3a1.5 1.5 0 0 0 1.5-1.2L21 7H6'],
      c: [
        [9, 20, 1],
        [18, 20, 1]
      ]
    },
    home: { p: ['M3 11l9-8 9 8', 'M5 10v10h14V10'] },
    fuel: {
      p: [
        'M4 22V4a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v18',
        'M4 12h9',
        'M13 8h2a2 2 0 0 1 2 2v6a2 2 0 0 0 4 0V9l-3-3'
      ]
    },
    repeat: {
      p: ['M17 2l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 22l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3']
    },
    utensils: { p: ['M4 2v8a3 3 0 0 0 3 3v9', 'M7 2v6', 'M18 2a3 3 0 0 0-3 3v7h3z', 'M18 12v10'] },
    bag: {
      p: ['M6 2 3 8v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-3-6z', 'M3 8h18', 'M16 12a4 4 0 0 1-8 0']
    },
    car: {
      p: ['M5 13l1.6-4.6A2 2 0 0 1 8.5 7h7a2 2 0 0 1 1.9 1.4L19 13', 'M5 13h14v5H5z'],
      c: [
        [7.5, 18.5, 1.5],
        [16.5, 18.5, 1.5]
      ]
    },
    wallet: {
      p: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M16 12h4']
    },
    heart: {
      p: [
        'M19 14c1.5-1.5 3-3.2 3-5.5A3.5 3.5 0 0 0 12 5 3.5 3.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z'
      ]
    },
    plane: { p: ['M2 16l20-7-20-7v6l13 1-13 1z'] },
    bolt: { p: ['M13 2 3 14h7l-1 8 10-12h-7z'] },
    tag: { p: ['M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9z'], c: [[7.5, 7.5, 1.5]] }
  };
</script>

{#snippet glyph(stroke: string)}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    {stroke}
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#each ICONS[icon].p as d (d)}
      <path {d} />
    {/each}
    {#each ICONS[icon].c ?? [] as circle (circle)}
      <circle cx={circle[0]} cy={circle[1]} r={circle[2]} />
    {/each}
  </svg>
{/snippet}

{#if tint}
  <span
    class="inline-flex items-center justify-center rounded-lg"
    style="width: {size + 16}px; height: {size +
      16}px; background-color: color-mix(in oklab, {color} 16%, transparent); color: {color};"
  >
    {@render glyph('currentColor')}
  </span>
{:else}
  {@render glyph(color)}
{/if}
