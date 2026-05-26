<script lang="ts">
  // Circular progress ring (Rocket-Money signature). Shows value/max as an arc,
  // with a centred label. Clamps to [0,100]% and animates the arc on change.
  let {
    value,
    max,
    size = 132,
    stroke = 12,
    color = 'var(--color-accent)',
    label = '',
    sublabel = ''
  }: {
    value: number;
    max: number;
    size?: number;
    stroke?: number;
    color?: string;
    label?: string;
    sublabel?: string;
  } = $props();

  const pct = $derived(max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100)));
  const r = $derived((size - stroke) / 2);
  const circ = $derived(2 * Math.PI * r);
  const offset = $derived(circ * (1 - pct / 100));
</script>

<div
  class="relative inline-flex items-center justify-center"
  style="width: {size}px; height: {size}px;"
>
  <svg width={size} height={size} style="transform: rotate(-90deg);" aria-hidden="true">
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="var(--color-border)"
      stroke-width={stroke}
    />
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke={color}
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={circ}
      stroke-dashoffset={offset}
      style="transition: stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1);"
    />
  </svg>
  <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
    {#if label}<span class="num text-lg font-semibold">{label}</span>{/if}
    {#if sublabel}<span class="text-xs" style:color="var(--color-muted)">{sublabel}</span>{/if}
  </div>
</div>
