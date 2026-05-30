<script lang="ts">
  // Renders a merchant/service logo. Two kinds:
  //  - 'mark'   : the real official Simple-Icons mark, filled in the brand colour.
  //  - 'letter' : a brand-coloured tile with short text — our own approximation
  //               for logos we can't ship. Recognized by colour + the adjacent
  //               category name. Brand names/logos are trademarks of their
  //               owners; used only to identify the service (see NOTICE-brands.md).
  import { BRAND_LOGOS, type BrandKey } from '$lib/app/brand-logos';

  let {
    brand,
    size = 18,
    tint = false
  }: { brand: BrandKey; size?: number; tint?: boolean } = $props();

  const logo = $derived(BRAND_LOGOS[brand]);
  const box = $derived(tint ? size + 16 : size); // match CategoryIcon footprint
  // Auto-fit lettermark text: fewer chars -> bigger.
  const fontPx = $derived.by(() => {
    if (logo.kind !== 'letter') return 0;
    const n = logo.text.length;
    const factor = n <= 1 ? 0.56 : n === 2 ? 0.46 : n === 3 ? 0.36 : 0.28;
    return Math.round(box * factor);
  });
</script>

{#if logo.kind === 'mark'}
  {#if tint}
    <span
      class="inline-flex items-center justify-center rounded-lg"
      style="width: {box}px; height: {box}px; background-color: color-mix(in oklab, {logo.hex} 16%, transparent);"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={logo.hex} aria-hidden="true">
        <path d={logo.path} />
      </svg>
    </span>
  {:else}
    <svg width={size} height={size} viewBox="0 0 24 24" fill={logo.hex} aria-hidden="true">
      <path d={logo.path} />
    </svg>
  {/if}
{:else}
  <!-- lettermark tile: the tile IS the logo, so always solid brand colour -->
  <span
    class="inline-flex items-center justify-center rounded-lg font-extrabold"
    style="width: {box}px; height: {box}px; background-color: {logo.hex}; color: {logo.fg}; font-size: {fontPx}px; line-height: 1; letter-spacing: -0.03em;"
    aria-label={logo.title}
  >
    {logo.text}
  </span>
{/if}
