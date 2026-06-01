<script lang="ts">
  // Renders a recurring SECTION's icon. A section icon is either a rich glyph key
  // (the same set bills use — 'car', 'brand:netflix', 'food:dosa', … picked via
  // IconPickerSheet) or, for the built-ins / legacy data, a plain emoji ('📋').
  // '' = auto-derive from the name. This keeps old emoji sections working while
  // new ones get the full icon library.
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import { categoryColor, categoryIconName, type GlyphKey } from '$lib/app/category-visuals';

  let {
    icon = '',
    name = '',
    size = 18,
    tint = true
  }: { icon?: string; name?: string; size?: number; tint?: boolean } = $props();

  // Glyph keys are ASCII (letters/digits/':'/'-'); emoji are not.
  const isGlyph = (s: string): boolean => /^[a-z0-9][a-z0-9:_-]*$/i.test(s);
  const color = $derived(categoryColor(name || 'section'));
  const glyph = $derived<GlyphKey | null>(
    icon === '' ? categoryIconName(name || 'section') : isGlyph(icon) ? (icon as GlyphKey) : null
  );
</script>

{#if glyph !== null}
  <CategoryIcon icon={glyph} {color} {tint} {size} />
{:else if tint}
  <span
    class="se-badge"
    style="width:{size + 16}px;height:{size + 16}px;font-size:{size -
      1}px;background-color: color-mix(in oklab, {color} 16%, transparent);">{icon}</span
  >
{:else}
  <span style="font-size:{size}px; line-height:1;">{icon}</span>
{/if}

<style>
  .se-badge {
    display: inline-grid;
    place-items: center;
    border-radius: 0.5rem;
    flex: none;
  }
</style>
