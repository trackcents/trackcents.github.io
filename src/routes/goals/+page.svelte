<script lang="ts">
  // Savings goals (US-P4-B) — create goals, track saved-vs-target with a ring.
  // Manual progress (the user updates "saved"), consistent with the app's no-
  // inference philosophy. Local, encrypted-at-rest store.
  import { onMount } from 'svelte';
  import ProgressRing from '$components/ProgressRing.svelte';
  import {
    goalProgress,
    goalsTotals,
    makeGoal,
    SavingsGoalError,
    type SavingsGoal
  } from '$lib/app/savings-goal';
  import { loadGoals, saveGoals } from '$lib/db/goals-store';
  import { newManualId } from '$lib/app/manual-entry';
  import { parseAmountToCents } from '$lib/app/csv-import';
  import { centsToDecimal } from '$lib/app/export-csv';
  import { formatMoney, getDisplayCurrencySymbol } from '$lib/util/money';
  const currencySymbol = getDisplayCurrencySymbol();

  const toN = (m: bigint): number => Number(m) / 100;

  let loading = $state(true);
  let goals = $state<SavingsGoal[]>([]);
  let showAdd = $state(false);
  let addError = $state<string | null>(null);
  let gName = $state('');
  let gTarget = $state('');
  let gDeadline = $state('');

  onMount(async () => {
    goals = await loadGoals();
    loading = false;
  });

  const totals = $derived(goalsTotals(goals));

  async function persist(): Promise<void> {
    await saveGoals(goals);
  }

  function resetAdd(): void {
    gName = '';
    gTarget = '';
    gDeadline = '';
    addError = null;
  }

  async function addGoal(): Promise<void> {
    addError = null;
    try {
      const target = parseAmountToCents(gTarget, 0);
      const mag = target < 0n ? -target : target;
      const goal = makeGoal(
        {
          name: gName,
          target_minor: mag,
          ...(gDeadline.trim() !== '' ? { deadline: gDeadline } : {})
        },
        newManualId()
      );
      goals = [...goals, goal];
      await persist();
      showAdd = false;
      resetAdd();
    } catch (err) {
      addError =
        err instanceof SavingsGoalError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    }
  }

  async function updateSaved(id: string, raw: string): Promise<void> {
    let cents = 0n;
    const trimmed = raw.trim();
    if (trimmed !== '') {
      try {
        const c = parseAmountToCents(trimmed, 0);
        cents = c < 0n ? 0n : c;
      } catch {
        return; // ignore unparseable input
      }
    }
    goals = goals.map((g) => (g.id === id ? { ...g, saved_minor: cents } : g));
    await persist();
  }

  async function removeGoal(id: string): Promise<void> {
    goals = goals.filter((g) => g.id !== id);
    await persist();
  }
</script>

<svelte:head><title>Goals · trackcents</title></svelte:head>

<main class="mx-auto max-w-3xl px-6 py-8">
  <header class="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold text-[var(--color-text)]">Savings goals</h1>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Set a target, track what you've put aside. {#if totals.target_minor > 0n}Across all goals:
          {formatMoney(totals.saved_minor)} of {formatMoney(totals.target_minor)} saved.{/if}
      </p>
    </div>
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => {
        showAdd = !showAdd;
        addError = null;
      }}
    >
      {showAdd ? 'Close' : '+ New goal'}
    </button>
  </header>

  {#if showAdd}
    <section class="card rise mb-5 p-5">
      <h2 class="mb-3 text-base font-semibold">New savings goal</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-sm sm:col-span-2">
          <span class="mb-1 block text-[var(--color-muted)]">Name</span>
          <input
            type="text"
            bind:value={gName}
            placeholder="e.g. Emergency fund"
            class="w-full rounded-lg border px-3 py-2"
            style="border-color: var(--color-border); background-color: var(--color-bg);"
          />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-[var(--color-muted)]">Target amount</span>
          <input
            type="text"
            inputmode="decimal"
            bind:value={gTarget}
            placeholder="5000.00"
            class="num w-full rounded-lg border px-3 py-2"
            style="border-color: var(--color-border); background-color: var(--color-bg);"
          />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-[var(--color-muted)]">Target date (optional)</span>
          <input
            type="date"
            bind:value={gDeadline}
            class="w-full rounded-lg border px-3 py-2"
            style="border-color: var(--color-border); background-color: var(--color-bg);"
          />
        </label>
      </div>
      {#if addError}
        <p class="mt-3 text-sm text-[var(--color-danger)]">{addError}</p>
      {/if}
      <div class="mt-4 flex gap-3">
        <button type="button" class="btn btn-primary" onclick={addGoal}>Create goal</button>
        <button
          type="button"
          class="btn btn-ghost"
          onclick={() => {
            showAdd = false;
            resetAdd();
          }}>Cancel</button
        >
      </div>
    </section>
  {/if}

  {#if loading}
    <p class="text-sm text-[var(--color-muted)]">Loading…</p>
  {:else if goals.length === 0}
    <div class="card p-8 text-center">
      <p class="text-sm text-[var(--color-muted)]">
        No goals yet. Create one to start tracking what you're saving toward.
      </p>
    </div>
  {:else}
    <div class="stagger grid gap-4 sm:grid-cols-2">
      {#each goals as g (g.id)}
        {@const p = goalProgress(g)}
        <div class="card rise flex items-center gap-4 p-5">
          <ProgressRing
            value={toN(g.saved_minor)}
            max={toN(g.target_minor)}
            size={96}
            stroke={10}
            color={p.complete ? 'var(--color-success)' : 'var(--color-accent)'}
            label={`${Math.round(p.pct)}%`}
            sublabel={p.complete ? 'reached' : 'saved'}
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-semibold">{g.name}</span>
              <button
                type="button"
                class="text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                onclick={() => removeGoal(g.id)}
                aria-label="Delete goal">✕</button
              >
            </div>
            <p class="num mt-0.5 text-sm text-[var(--color-muted)]">
              {formatMoney(g.saved_minor)} of {formatMoney(g.target_minor)}
              {#if !p.complete}
                · {formatMoney(p.remaining_minor)} to go{/if}
            </p>
            {#if g.deadline}
              <p class="text-xs text-[var(--color-muted)]">by {g.deadline}</p>
            {/if}
            <label class="mt-2 flex items-center gap-1 text-sm">
              <span class="text-[var(--color-muted)]">Saved {currencySymbol}</span>
              <input
                type="text"
                inputmode="decimal"
                value={centsToDecimal(g.saved_minor)}
                class="num w-24 rounded-md border px-2 py-1 text-right text-sm"
                style="border-color: var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
                onchange={(e) => updateSaved(g.id, e.currentTarget.value)}
              />
            </label>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</main>
