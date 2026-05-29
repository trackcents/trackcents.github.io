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
    // ── Batch B: new icons so Entertainment / Education / Gifts / etc.
    //    don't all fall through to 'tag' ──────────────────────────────────
    film: {
      // Film reel with sprocket holes — modern outlined.
      p: ['M3 3h18v18H3z', 'M3 8h18', 'M3 16h18', 'M8 3v18', 'M16 3v18'],
      c: [
        [5.5, 5.5, 0.6],
        [18.5, 5.5, 0.6],
        [5.5, 18.5, 0.6],
        [18.5, 18.5, 0.6]
      ]
    },
    book: {
      // Open book.
      p: [
        'M3 4h6a3 3 0 0 1 3 3v13',
        'M21 4h-6a3 3 0 0 0-3 3v13',
        'M3 4v15a1 1 0 0 0 1 1h7',
        'M21 4v15a1 1 0 0 0-1 1h-7'
      ]
    },
    gift: {
      // Wrapped gift box with ribbon.
      p: [
        'M3 8h18v4H3z',
        'M5 12v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9',
        'M12 8v14',
        'M12 8c-2-3-6-3-6 0 0 2 6 0 6 0z',
        'M12 8c2-3 6-3 6 0 0 2-6 0-6 0z'
      ]
    },
    shield: {
      // Shield with check.
      p: ['M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z', 'M9 12l2 2 4-4']
    },
    card: {
      // Credit card.
      p: [
        'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        'M3 10h18',
        'M7 15h4'
      ]
    },
    'chart-up': {
      // Bar chart trending up.
      p: ['M4 4v16h16', 'M8 16v-4', 'M12 16v-8', 'M16 16v-6', 'M9 8l3-3 3 3 4-4']
    },
    undo: {
      // Curved arrow back (refund).
      p: ['M9 14l-4-4 4-4', 'M5 10h9a5 5 0 0 1 0 10h-1']
    },
    percent: {
      // Percent symbol.
      p: ['M5 19L19 5'],
      c: [
        [7, 7, 2],
        [17, 17, 2]
      ]
    },
    banknote: {
      // Stylised banknote.
      p: ['M3 6h18v12H3z', 'M6 9v6', 'M18 9v6'],
      c: [[12, 12, 2.5]]
    },
    piggy: {
      // Piggy bank.
      p: [
        'M19 11c0-4-3-7-7-7s-7 3-7 7v1a3 3 0 0 0 3 3v2h3v-2h2v2h3v-2a3 3 0 0 0 3-3v-1z',
        'M5 12h-1',
        'M15 9h1'
      ],
      c: [[8, 10, 0.6]]
    },
    tag: { p: ['M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9z'], c: [[7.5, 7.5, 1.5]] },
    // ── New food / drink icons ──────────────────────────────────────
    pizza: {
      // Triangular slice + crust + 2 toppings.
      p: ['M2 9l10-7 10 7-10 13z', 'M2 9l20 0'],
      c: [
        [10, 11, 1.2],
        [13, 14, 1.2]
      ]
    },
    coffee: {
      // Coffee cup with handle + 2 steam wisps.
      p: [
        'M4 9h13v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z',
        'M17 11h2a2 2 0 0 1 0 4h-2',
        'M8 2c0 2 2 2 2 4',
        'M13 2c0 2 2 2 2 4'
      ]
    },
    cup: {
      // Tall glass/milkshake with straw.
      p: ['M6 4h12l-1 16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z', 'M14 3l-1 7', 'M6 9h12']
    },
    icecream: {
      // Cone + scoop with sprinkle drip.
      p: ['M8 9a4 4 0 0 1 8 0H8z', 'M8 11l4 11 4-11', 'M11 14h2'],
      c: [[12, 5, 0.8]]
    },
    bowl: {
      // Bowl of curry/biryani with steam.
      p: [
        'M3 12h18a0 0 0 0 1 0 0c0 4-3 8-9 8s-9-4-9-8a0 0 0 0 1 0 0z',
        'M9 4c0 2-1 3-1 5',
        'M14 4c0 2-1 3-1 5',
        'M18 4c0 2-1 3-1 5'
      ]
    },
    salad: {
      // Bowl with greens + tomato.
      p: ['M3 10h18a0 0 0 0 1 0 0c0 4-3 8-9 8s-9-4-9-8a0 0 0 0 1 0 0z', 'M8 7l3 3', 'M16 7l-3 3'],
      c: [[12, 13, 1.2]]
    },
    sushi: {
      // Roll cross-section: outer rice + filling + inner core.
      c: [
        [12, 12, 6],
        [12, 12, 2]
      ],
      p: ['M6 12h12', 'M12 6v12']
    },
    cake: {
      // Layered cake with candle.
      p: ['M3 19h18', 'M4 13h16v6H4z', 'M6 9h12v4H6z', 'M12 4v5'],
      c: [[12, 3, 0.6]]
    },
    donut: {
      // Donut ring with sprinkles.
      c: [
        [12, 12, 8],
        [12, 12, 3]
      ],
      p: ['M7 7l1 1', 'M16 8l1 -1', 'M16 16l1 1', 'M7 16l1 1']
    },
    bus: {
      // School-bus side view.
      p: [
        'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10H4z',
        'M4 16v3',
        'M20 16v3',
        'M4 11h16',
        'M7 7h3',
        'M14 7h3'
      ],
      c: [
        [7.5, 17, 1.2],
        [16.5, 17, 1.2]
      ]
    },
    train: {
      // Metro/train car.
      p: [
        'M5 4h14a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2z',
        'M3 12h18',
        'M7 22l-2-3',
        'M17 22l2-3'
      ],
      c: [
        [8, 16, 0.7],
        [16, 16, 0.7]
      ]
    },
    medical: {
      // Pill capsule split + sparkle.
      p: ['M10 4 4 10a4 4 0 0 0 5.6 5.6L14 11', 'M14 11l4-4a4 4 0 0 0-5.6-5.6L8 6', 'M9 9l5 5']
    }
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
