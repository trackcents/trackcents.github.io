<script lang="ts">
  // Thin ECharts wrapper. ECharts is dynamically imported inside onMount so it
  // (a) never runs during SSR/prerender (it needs the DOM) and (b) stays out of
  // the initial bundle (lazy-loaded only when a chart is shown).
  import { onMount } from 'svelte';
  import type { ECharts, EChartsCoreOption } from 'echarts';

  let {
    option,
    height = '320px',
    onItemClick
  }: {
    option: EChartsCoreOption;
    height?: string;
    /** Fired when a data item (e.g. a pie slice / bar) is clicked; gets its `name`. */
    onItemClick?: (name: string) => void;
  } = $props();

  let el: HTMLDivElement;
  let chart: ECharts | null = null;

  onMount(() => {
    let disposed = false;
    let onResize: (() => void) | null = null;
    void (async () => {
      const echarts = await import('echarts');
      if (disposed) return;
      chart = echarts.init(el);
      chart.setOption(option);
      if (onItemClick) {
        chart.on('click', (params: { name?: string }) => {
          if (typeof params.name === 'string') onItemClick(params.name);
        });
      }
      onResize = () => chart?.resize();
      window.addEventListener('resize', onResize);
    })();
    return () => {
      disposed = true;
      if (onResize) window.removeEventListener('resize', onResize);
      chart?.dispose();
      chart = null;
    };
  });

  // Re-apply when the option changes (notMerge:true so removed series clear).
  $effect(() => {
    if (chart) chart.setOption(option, true);
  });
</script>

<div bind:this={el} style:height style:width="100%"></div>
