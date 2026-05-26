<script lang="ts">
  // Review Categories quick flow (T-R6) — one uncategorized transaction at a
  // time, assign with a tap. Inspired by Rocket Money / Copilot's review queue.
  // Pure UI over the existing categorization store; no new money logic.
  import { onMount } from 'svelte';
  import { loadState } from '$lib/db/store';
  import {
    loadCategorization,
    saveCategorization,
    type CategorizationState
  } from '$lib/db/categorization-store';
  import { detailedRowsFromImports, type DetailedRow } from '$lib/app/categorization-glue';
  import { setManualCategory, setAnnotation } from '$lib/app/categorization';
  import { categoryColor } from '$lib/app/category-visuals';
  import { formatMoney } from '$lib/util/money';

  let loading = $state(true);
  let cat = $state<CategorizationState>({ categories: [], rules: [], annotations: {} });
  let queue = $state<DetailedRow[]>([]);
  let index = $state(0);
  let done = $state(0);

  onMount(async () => {
    const imports = (await loadState()).imports;
    cat = await loadCategorization();
    // Uncategorized, non-ignored rows, most recent first.
    queue = detailedRowsFromImports(imports, cat.annotations)
      .filter((r) => r.category_id === null && !r.ignored)
      .sort((a, b) => (a.posted_date < b.posted_date ? 1 : -1));
    loading = false;
  });

  const current = $derived(queue[index] ?? null);
  const total = $derived(queue.length);
  const remaining = $derived(total - index);

  async function persist(): Promise<void> {
    await saveCategorization(cat);
  }

  async function assign(categoryId: string | null): Promise<void> {
    if (!current) return;
    const next = setManualCategory(
      new Map(Object.entries(cat.annotations)),
      current.key,
      categoryId
    );
    cat = { ...cat, annotations: Object.fromEntries(next) };
    done += 1;
    index += 1;
    await persist();
  }

  async function ignoreTxn(): Promise<void> {
    if (!current) return;
    const next = setAnnotation(new Map(Object.entries(cat.annotations)), current.key, {
      ignored: true
    });
    cat = { ...cat, annotations: Object.fromEntries(next) };
    done += 1;
    index += 1;
    await persist();
  }

  function skip(): void {
    index += 1;
  }
</script>

<svelte:head><title>Review categories · trackcents</title></svelte:head>

<main class="mx-auto max-w-2xl px-6 py-8">
  <header class="mb-5">
    <h1 class="text-2xl font-semibold text-[var(--color-text)]">Review categories</h1>
    <p class="mt-1 text-sm text-[var(--color-muted)]">
      Assign a category to each uncategorized transaction, one at a time.
    </p>
  </header>

  {#if loading}
    <p class="text-sm text-[var(--color-muted)]">Loading…</p>
  {:else if cat.categories.length === 0}
    <div class="card p-8 text-center">
      <p class="text-sm text-[var(--color-muted)]">
        You don't have any categories yet. <a
          href="/categories"
          class="text-[var(--color-accent)] hover:underline">Create some first</a
        >.
      </p>
    </div>
  {:else if current === null}
    <div class="card rise p-8 text-center">
      <p class="text-3xl">🎉</p>
      <p class="mt-2 font-semibold">All caught up!</p>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        {done > 0
          ? `You reviewed ${done} transaction${done === 1 ? '' : 's'}.`
          : 'Nothing to review.'}
      </p>
      <a href="/transactions" class="btn btn-primary mt-4 inline-block">Back to transactions</a>
    </div>
  {:else}
    <!-- progress -->
    <div class="mb-4">
      <div class="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
        <span>{remaining} left</span>
        <span>{done} done</span>
      </div>
      <div
        class="h-1.5 w-full overflow-hidden rounded-full"
        style="background-color: var(--color-border);"
      >
        <div
          class="h-full rounded-full transition-all"
          style:width="{total === 0 ? 0 : (index / total) * 100}%"
          style="background-image: var(--grad-primary);"
        ></div>
      </div>
    </div>

    <!-- the transaction card -->
    <div class="card rise p-6">
      <p class="text-xs text-[var(--color-muted)]">{current.posted_date} · {current.bank_name}</p>
      <p class="mt-1 text-lg font-semibold text-[var(--color-text)]">{current.description}</p>
      <p
        class="num mt-1 text-2xl font-bold"
        style:color={current.amount_minor < 0n ? 'var(--color-text)' : 'var(--color-success)'}
      >
        {formatMoney(current.amount_minor)}
      </p>

      <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each cat.categories as c (c.id)}
          <button
            type="button"
            class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-[var(--color-accent)]"
            style="border-color: var(--color-border); background-color: var(--color-bg);"
            onclick={() => assign(c.id)}
          >
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              style:background-color={categoryColor(c.id)}
            ></span>
            <span class="truncate">{c.name}</span>
          </button>
        {/each}
      </div>

      <div
        class="mt-5 flex flex-wrap gap-3 border-t pt-4"
        style="border-color: var(--color-border);"
      >
        <button type="button" class="btn btn-ghost" onclick={skip}>Skip</button>
        <button type="button" class="btn btn-ghost" onclick={ignoreTxn}
          >Exclude from spending</button
        >
      </div>
    </div>
  {/if}
</main>
