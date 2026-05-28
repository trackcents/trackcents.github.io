<script lang="ts">
  // Recurring / subscriptions (US-P3-A) — Rocket-Money "Recurring" screen, from
  // imported transactions. Upcoming charges + all detected streams, grouped by
  // money-in vs bills, with estimated yearly cost.
  import { onMount } from 'svelte';
  import { loadState } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import {
    detectRecurring,
    type RecurringStream,
    type RecurringTxn
  } from '$lib/app/recurring-detector';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';
  import { formatMoney } from '$lib/util/money';
  import { today } from '$lib/util/date';
  import CategoryIcon from '$components/CategoryIcon.svelte';

  let loading = $state(true);
  let imports = $state<ImportRecord[]>([]);

  onMount(async () => {
    imports = (await loadState()).imports;
    loading = false;
  });

  const flatTxns = $derived<RecurringTxn[]>(
    imports.flatMap((imp) =>
      imp.transactions.map((t) => ({
        posted_date: t.posted_date,
        amount_minor: t.amount_minor,
        description: t.description
      }))
    )
  );
  const streams = $derived(detectRecurring(flatTxns));
  const bills = $derived(streams.filter((s) => s.direction === 'outflow'));
  const income = $derived(streams.filter((s) => s.direction === 'inflow'));
  const upcoming = $derived(streams.filter((s) => s.next_due !== null).slice(0, 6));

  const perYearFactor: Record<RecurringStream['cadence'], number> = {
    weekly: 52,
    biweekly: 26,
    monthly: 12,
    irregular: 12
  };
  function yearly(s: RecurringStream): bigint {
    return s.typical_amount_minor * BigInt(perYearFactor[s.cadence]);
  }
  const billsPerYear = $derived(bills.reduce((acc, s) => acc + yearly(s), 0n));

  // "today" for the next-due countdown.  Use the LOCAL-time helper, not
  // toISOString() (which would tip into UTC's next day late in the evening
  // for users west of UTC — that was the date bug Hemanth reported).
  const todayIso = today();
  function inDays(due: string | null): string {
    if (due === null) return 'irregular';
    const d = Math.round(
      (Date.parse(due + 'T00:00:00Z') - Date.parse(todayIso + 'T00:00:00Z')) / 86_400_000
    );
    if (d < 0) return 'overdue';
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    return `in ${d} days`;
  }
  const cadenceLabel: Record<RecurringStream['cadence'], string> = {
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    monthly: 'Monthly',
    irregular: 'Irregular'
  };
</script>

<svelte:head><title>Recurring · trackcents</title></svelte:head>

<main class="mx-auto max-w-3xl px-6 py-8">
  <h1 class="mb-1 text-2xl font-semibold">Recurring</h1>
  <p class="mb-6 text-sm" style:color="var(--color-muted)">
    Subscriptions and bills we spotted repeating in your statements.
  </p>

  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else if streams.length === 0}
    <div class="card rise p-10 text-center">
      <p class="text-sm" style:color="var(--color-muted)">
        No recurring charges detected yet. Import a few months of statements so we can spot the
        patterns.
      </p>
    </div>
  {:else}
    {#snippet streamRow(s: RecurringStream)}
      {@const color = categoryColor(s.stream_key)}
      <div
        class="flex items-center gap-3 py-2.5"
        style="border-top: 1px solid var(--color-border);"
      >
        <CategoryIcon icon={categoryIconName(s.display_name)} {color} tint />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{s.display_name}</div>
          <div class="text-xs" style:color="var(--color-muted)">
            {cadenceLabel[s.cadence]}{#if s.next_due}
              · {inDays(s.next_due)}{/if}
          </div>
        </div>
        <span
          class="num text-sm font-medium"
          style:color={s.direction === 'inflow' ? 'var(--color-success)' : 'var(--color-text)'}
        >
          {s.direction === 'inflow' ? '+' : ''}{formatMoney(s.typical_amount_minor)}
        </span>
      </div>
    {/snippet}

    {#if upcoming.length > 0}
      <section class="card rise mb-4 p-5">
        <h2 class="mb-1 text-sm font-semibold">Coming up</h2>
        <p class="mb-1 text-xs" style:color="var(--color-muted)">Next predicted charges.</p>
        {#each upcoming as s (s.stream_key)}{@render streamRow(s)}{/each}
      </section>
    {/if}

    <section class="card rise mb-4 p-5" style="animation-delay: 60ms;">
      <div class="mb-1 flex items-baseline justify-between">
        <h2 class="text-sm font-semibold">Bills &amp; subscriptions</h2>
        <span class="text-xs" style:color="var(--color-muted)"
          >≈ {formatMoney(billsPerYear)}/yr</span
        >
      </div>
      {#if bills.length === 0}
        <p class="py-2 text-sm" style:color="var(--color-muted)">None detected.</p>
      {:else}
        {#each bills as s (s.stream_key)}{@render streamRow(s)}{/each}
      {/if}
    </section>

    {#if income.length > 0}
      <section class="card rise p-5" style="animation-delay: 120ms;">
        <h2 class="mb-1 text-sm font-semibold">Recurring income</h2>
        {#each income as s (s.stream_key)}{@render streamRow(s)}{/each}
      </section>
    {/if}

    <p class="mt-4 text-xs" style:color="var(--color-muted)">
      Detected by repetition + spacing only (never by amount). Yearly estimates assume the cadence
      holds.
    </p>
  {/if}
</main>
