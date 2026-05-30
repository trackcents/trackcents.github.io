<script lang="ts">
  // Settings (US-PW-C + US-P4-D) — JSON backup export/import (offline escape
  // hatch, cousin's pricewatch cue), CSV export, and clear-all-data. Theme lives
  // in the header toggle.
  import { onMount } from 'svelte';
  import { loadState, saveState, clearState, getLastUsedBackend, addImport } from '$lib/db/store';
  import {
    loadCategorization,
    saveCategorization,
    type CategorizationState
  } from '$lib/db/categorization-store';
  import { exportBackup, importBackup } from '$lib/app/backup';
  import { loadBudgets, saveBudgets } from '$lib/db/budget-store';
  import { loadGoals, saveGoals } from '$lib/db/goals-store';
  import { exportTransactionsCsv, type CsvExportRow } from '$lib/app/export-csv';
  import { importCsv, CsvImportError } from '$lib/app/csv-import';
  import { newManualId } from '$lib/app/manual-entry';
  import { detailedRowsFromImports } from '$lib/app/categorization-glue';
  import { CURRENCIES, loadPrefs, setCurrencyPref, type CurrencyCode } from '$lib/app/prefs';

  let backend = $state<string>('');
  let txnCount = $state(0);
  let busy = $state(false);
  let message = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
  let currency = $state<CurrencyCode>('USD');

  onMount(async () => {
    const state = await loadState();
    backend = getLastUsedBackend();
    txnCount = state.imports.reduce((n, i) => n + i.transactions.length, 0);
    currency = loadPrefs().currency;
  });

  function changeCurrency(code: CurrencyCode): void {
    if (code === currency) return;
    setCurrencyPref(code);
    currency = code;
    // formatMoney reads a module-level default; reload to re-render every page
    // in the new currency.
    location.reload();
  }

  function nowIso(): string {
    return new Date().toISOString();
  }
  function download(filename: string, text: string, mime: string): void {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  function stamp(): string {
    return nowIso().slice(0, 10);
  }

  async function exportJson(): Promise<void> {
    message = null;
    const state = await loadState();
    const cat = await loadCategorization();
    const budgets = await loadBudgets();
    const goals = await loadGoals();
    download(
      `money-tracker-backup-${stamp()}.json`,
      exportBackup(state, cat, nowIso(), { budgets, goals }),
      'application/json'
    );
    message = { kind: 'ok', text: 'Backup downloaded.' };
  }

  async function exportCsv(): Promise<void> {
    message = null;
    const state = await loadState();
    const cat = await loadCategorization();
    const catName = (id: string | null) =>
      id === null ? '' : (cat.categories.find((c) => c.id === id)?.name ?? id);
    // CSV currency should track the user's display preference — hard-coding USD
    // mis-labels every row when an INR/EUR/GBP user opens the file in Excel.
    // (Per-statement `r.currency` would be even better for multi-currency
    // imports, but our DetailedRow doesn't surface it today; the display
    // pref matches what's already shown in the UI for every row.)
    const rows: CsvExportRow[] = detailedRowsFromImports(state.imports, cat.annotations).map(
      (r) => ({
        posted_date: r.posted_date,
        description: r.description,
        amount_minor: r.amount_minor,
        currency,
        account: r.bank_name,
        category: catName(r.category_id)
      })
    );
    if (rows.length === 0) {
      message = { kind: 'err', text: 'No transactions to export yet.' };
      return;
    }
    download(`money-tracker-transactions-${stamp()}.csv`, exportTransactionsCsv(rows), 'text/csv');
    message = { kind: 'ok', text: `Exported ${rows.length} transactions to CSV.` };
  }

  async function importJson(ev: Event): Promise<void> {
    message = null;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      const bundle = importBackup(await file.text());
      await saveState(bundle.state);
      await saveCategorization(bundle.categorization as CategorizationState);
      await saveBudgets(bundle.budgets);
      await saveGoals(bundle.goals);
      const n = bundle.state.imports.reduce((c, i) => c + i.transactions.length, 0);
      txnCount = n;
      message = {
        kind: 'ok',
        text: `Restored ${n} transactions (+ categories, budgets, goals) from backup. Reload to see them.`
      };
    } catch (err) {
      message = { kind: 'err', text: err instanceof Error ? err.message : String(err) };
    } finally {
      busy = false;
      input.value = '';
    }
  }

  let csvAccount = $state('Imported CSV');

  async function importCsvFile(ev: Event): Promise<void> {
    message = null;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      const rec = importCsv(await file.text(), {
        account_name: csvAccount,
        source_id: newManualId(),
        imported_at: new Date().toISOString()
      });
      await addImport(rec);
      txnCount += rec.transactions.length;
      message = {
        kind: 'ok',
        text: `Imported ${rec.transactions.length} transactions from CSV (not checksum-verified — reload to see them).`
      };
    } catch (err) {
      message = {
        kind: 'err',
        text:
          err instanceof CsvImportError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err)
      };
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function wipe(): Promise<void> {
    if (
      !confirm(
        'Erase ALL imported statements and categories from this device? This cannot be undone (restore from a backup file if you have one).'
      )
    ) {
      return;
    }
    await clearState();
    await saveCategorization({ categories: [], rules: [], annotations: {} });
    txnCount = 0;
    message = { kind: 'ok', text: 'All local data erased.' };
  }
</script>

<svelte:head><title>Settings · trackcents</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 sm:px-6 py-8">
  <header class="mb-5">
    <h1 class="text-2xl font-semibold text-[var(--color-text)]">Settings</h1>
    <p class="mt-1 text-sm text-[var(--color-muted)]">
      Backup, restore, export, and manage your data. Everything stays on your device.
    </p>
  </header>

  {#if message}
    <div
      class="mb-4 rounded-xl border p-3 text-sm"
      style:border-color={message.kind === 'ok' ? 'var(--color-accent)' : 'var(--color-danger)'}
      style:background-color={message.kind === 'ok'
        ? 'color-mix(in oklab, var(--color-accent) 12%, transparent)'
        : 'color-mix(in oklab, var(--color-danger) 12%, transparent)'}
      style:color={message.kind === 'ok' ? 'var(--color-text)' : 'var(--color-danger)'}
    >
      {message.text}
    </div>
  {/if}

  <div class="space-y-5">
    <section class="card p-5">
      <h2 class="text-base font-semibold">Currency</h2>
      <p class="mt-1 text-sm text-[var(--color-muted)]">Amounts are shown in this currency.</p>
      <div class="mt-3 flex gap-2">
        {#each CURRENCIES as c (c.code)}
          {@const active = currency === c.code}
          <button
            type="button"
            class="btn flex-1 justify-center"
            class:btn-primary={active}
            class:btn-ghost={!active}
            onclick={() => changeCurrency(c.code)}
          >
            {c.symbol}&nbsp;{c.label}
          </button>
        {/each}
      </div>
    </section>

    <section class="card p-5">
      <h2 class="text-base font-semibold">Backup &amp; restore</h2>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Download a complete JSON backup of all your data, or restore from one. Useful for moving to
        a new device or keeping a safety copy.
      </p>
      <div
        class="mt-3 rounded-lg border p-3 text-xs"
        style="border-color: var(--color-border); background-color: color-mix(in oklab, var(--color-accent) 6%, transparent);"
      >
        ⚠ The backup file is <strong>not encrypted</strong> — it's your raw data on your own disk. Store
        it somewhere safe (it contains your transactions).
      </div>
      <div class="mt-4 flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary" onclick={exportJson}
          >Export backup (JSON)</button
        >
        <label class="btn btn-ghost cursor-pointer">
          {busy ? 'Restoring…' : 'Restore from backup'}
          <input
            type="file"
            accept="application/json,.json"
            class="hidden"
            onchange={importJson}
            disabled={busy}
          />
        </label>
      </div>
    </section>

    <section class="card p-5">
      <h2 class="text-base font-semibold">Export to CSV</h2>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Export every transaction as a spreadsheet-friendly CSV (for taxes or your own analysis).
      </p>
      <button type="button" class="btn btn-ghost mt-4" onclick={exportCsv}
        >Export transactions (CSV)</button
      >
    </section>

    <section class="card p-5">
      <h2 class="text-base font-semibold">Import a CSV</h2>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Import transactions from a CSV (for a bank we don't yet parse, or your own export). The file
        needs a header row with <code>date</code> (ISO YYYY-MM-DD), <code>description</code>, and an
        <code>amount</code> column (or a <code>debit</code>/<code>credit</code> pair). Unlike PDF imports,
        a CSV isn't checksum-verified.
      </p>
      <div class="mt-4 flex flex-wrap items-end gap-3">
        <label class="block text-sm">
          <span class="mb-1 block text-[var(--color-muted)]">Account name</span>
          <input
            type="text"
            bind:value={csvAccount}
            class="rounded-lg border px-3 py-2"
            style="border-color: var(--color-border); background-color: var(--color-bg);"
          />
        </label>
        <label class="btn btn-ghost cursor-pointer">
          {busy ? 'Importing…' : 'Choose CSV file'}
          <input
            type="file"
            accept=".csv,text/csv"
            class="hidden"
            onchange={importCsvFile}
            disabled={busy}
          />
        </label>
      </div>
    </section>

    <section class="card p-5">
      <h2 class="text-base font-semibold">This device</h2>
      <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt class="text-[var(--color-muted)]">Stored transactions</dt>
        <dd class="num text-right">{txnCount}</dd>
        <dt class="text-[var(--color-muted)]">Storage backend</dt>
        <dd class="text-right">{backend}</dd>
      </dl>
    </section>

    <section
      class="card p-5"
      style="border-color: color-mix(in oklab, var(--color-danger) 30%, var(--color-border));"
    >
      <h2 class="text-base font-semibold text-[var(--color-danger)]">Danger zone</h2>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Erase all imported statements, manual entries, and categories from this device.
      </p>
      <button
        type="button"
        class="btn mt-4"
        style="background-color: var(--color-danger); color: white;"
        onclick={wipe}
      >
        Erase all data
      </button>
    </section>
  </div>
</main>
