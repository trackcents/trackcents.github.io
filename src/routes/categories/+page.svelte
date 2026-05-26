<script lang="ts">
  // Categorization management (US-P2-A): create categories, define description-based
  // rules, and apply them to all imported transactions. Manual per-row assignment
  // lives on the transactions page (follow-up). Persists to the local (encrypted)
  // categorization store — separate from the synced vault for now.
  import { onMount } from 'svelte';
  import { loadState } from '$lib/db/store';
  import type { ImportRecord } from '$lib/db/store';
  import { loadCategorization, saveCategorization } from '$lib/db/categorization-store';
  import { categorizableFromImports } from '$lib/app/categorization-glue';
  import {
    applyRules,
    deleteCategory as removeCategoryFrom,
    type Category,
    type CategoryRule,
    type TransactionAnnotation
  } from '$lib/app/categorization';
  import TopNav from '$components/TopNav.svelte';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import { categoryColor, categoryIconName } from '$lib/app/category-visuals';

  let loading = $state(true);
  let categories = $state<Category[]>([]);
  let rules = $state<CategoryRule[]>([]);
  let annotations = $state<Record<string, TransactionAnnotation>>({});
  let imports = $state<ImportRecord[]>([]);
  let status = $state('');

  let newCatName = $state('');
  let newRuleContains = $state('');
  let newRuleCategory = $state('');

  onMount(async () => {
    imports = (await loadState()).imports;
    const c = await loadCategorization();
    categories = c.categories;
    rules = c.rules;
    annotations = c.annotations;
    loading = false;
  });

  const categorizedCount = $derived(
    Object.values(annotations).filter((a) => a.category_id !== null).length
  );

  async function persist(): Promise<void> {
    await saveCategorization({ categories, rules, annotations });
  }

  async function addCategory(): Promise<void> {
    const name = newCatName.trim();
    if (name === '') return;
    categories = [...categories, { id: crypto.randomUUID(), name }];
    newCatName = '';
    await persist();
  }

  async function removeCategory(id: string): Promise<void> {
    const result = removeCategoryFrom(categories, new Map(Object.entries(annotations)), id);
    categories = result.categories;
    annotations = Object.fromEntries(result.annotations);
    rules = rules.filter((r) => r.category_id !== id);
    await persist();
  }

  async function addRule(): Promise<void> {
    const contains = newRuleContains.trim();
    if (contains === '' || newRuleCategory === '') return;
    rules = [...rules, { id: crypto.randomUUID(), contains, category_id: newRuleCategory }];
    newRuleContains = '';
    await persist();
  }

  async function removeRule(id: string): Promise<void> {
    rules = rules.filter((r) => r.id !== id);
    await persist();
  }

  async function applyRulesNow(): Promise<void> {
    const txns = categorizableFromImports(imports);
    const next = applyRules(rules, txns, new Map(Object.entries(annotations)));
    annotations = Object.fromEntries(next);
    await persist();
    status = `Applied rules — ${categorizedCount} transactions now categorized.`;
  }

  function categoryName(id: string): string {
    return categories.find((c) => c.id === id)?.name ?? id;
  }
</script>

<main class="mx-auto max-w-3xl px-6 py-8">
  <TopNav />
  <div class="mb-1 flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-semibold">Categories &amp; rules</h1>
    <a href="/categories/review" class="btn btn-ghost">Review uncategorized →</a>
  </div>
  <p class="mb-6 text-sm" style:color="var(--color-muted)">
    Label your spending and let rules categorize the rest automatically.
  </p>

  {#if loading}
    <p class="text-sm" style:color="var(--color-muted)">Loading…</p>
  {:else}
    <section class="card rise mb-4 p-5">
      <h2 class="mb-3 text-sm font-semibold">Categories</h2>
      <ul class="mb-3 space-y-2">
        {#each categories as c (c.id)}
          <li class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-2.5">
              <CategoryIcon
                icon={categoryIconName(c.name)}
                color={categoryColor(c.id)}
                tint
                size={16}
              />
              <span class="text-sm font-medium">{c.name}</span>
            </span>
            <button
              type="button"
              class="text-xs"
              style:color="var(--color-muted)"
              onclick={() => removeCategory(c.id)}>Delete</button
            >
          </li>
        {:else}
          <li class="text-sm" style:color="var(--color-muted)">
            No categories yet — add one below.
          </li>
        {/each}
      </ul>
      <form
        class="flex gap-2"
        onsubmit={(e) => {
          e.preventDefault();
          void addCategory();
        }}
      >
        <input
          class="flex-1 rounded-lg border px-3 py-2 text-sm"
          style="border-color: var(--color-border); background-color: var(--color-elevated); color: var(--color-text);"
          placeholder="New category (e.g. Groceries)"
          bind:value={newCatName}
        />
        <button type="submit" class="btn btn-primary">Add</button>
      </form>
    </section>

    <section class="card rise mb-4 p-5" style="animation-delay: 60ms;">
      <h2 class="mb-1 text-sm font-semibold">Rules</h2>
      <p class="mb-3 text-xs" style:color="var(--color-muted)">
        Match on the description text — e.g. "AMAZON" → Shopping. Your manual choices always win.
      </p>
      <ul class="mb-3 space-y-2">
        {#each rules as r (r.id)}
          <li class="flex items-center justify-between gap-2 text-sm">
            <span class="flex items-center gap-2">
              <CategoryIcon
                icon={categoryIconName(categoryName(r.category_id))}
                color={categoryColor(r.category_id)}
                size={14}
              />
              <span>contains <strong>"{r.contains}"</strong> → {categoryName(r.category_id)}</span>
            </span>
            <button
              type="button"
              class="text-xs"
              style:color="var(--color-muted)"
              onclick={() => removeRule(r.id)}>Delete</button
            >
          </li>
        {:else}
          <li class="text-sm" style:color="var(--color-muted)">No rules yet.</li>
        {/each}
      </ul>
      <form
        class="flex flex-wrap gap-2"
        onsubmit={(e) => {
          e.preventDefault();
          void addRule();
        }}
      >
        <input
          class="min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm"
          style="border-color: var(--color-border); background-color: var(--color-elevated); color: var(--color-text);"
          placeholder="Description contains… (e.g. AMAZON)"
          bind:value={newRuleContains}
        />
        <select
          class="rounded-lg border px-3 py-2 text-sm"
          style="border-color: var(--color-border); background-color: var(--color-elevated); color: var(--color-text);"
          bind:value={newRuleCategory}
        >
          <option value="" disabled>Category…</option>
          {#each categories as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
        <button type="submit" class="btn btn-primary">Add rule</button>
      </form>
    </section>

    <section class="rise" style="animation-delay: 120ms;">
      <button
        type="button"
        class="btn btn-primary"
        disabled={rules.length === 0 || imports.length === 0}
        onclick={applyRulesNow}
      >
        Apply rules to all transactions
      </button>
      {#if status}<p class="mt-2 text-sm" style:color="var(--color-success)">{status}</p>{/if}
    </section>
  {/if}
</main>
