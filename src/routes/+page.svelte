<script lang="ts">
  import PdfDropZone from '$components/PdfDropZone.svelte';
  import StatementCard from '$components/StatementCard.svelte';
  import TopNav from '$components/TopNav.svelte';
  import {
    importStatement,
    type ImportResult,
    type ImportSuccess,
    type ImportStage,
    type ImportFailure
  } from '$lib/app/import';
  import {
    reconcileImports,
    type ReconciliationLink,
    type ImportedStatement
  } from '$lib/app/reconciliation';
  import {
    addImport,
    removeImport,
    clearState,
    getLastUsedBackend,
    type ImportRecord,
    type StorageBackend
  } from '$lib/db/store';
  import { loadImports } from '$lib/app/load-store';
  import { loadDemoData } from '$lib/app/demo-data';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount, tick } from 'svelte';

  // Phase 1A persistence (OPFS JSON blob with localStorage fallback).
  // Imports are loaded from disk on mount and re-saved on every change.
  let imports = $state<ImportSuccess[]>([]);
  let lastFailure = $state<{ fileName: string; failure: ImportFailure } | null>(null);
  let stage = $state<ImportStage | null>(null);
  let busy = $state(false);
  let currentFileName = $state<string | null>(null);
  let hydrating = $state(true);

  // Multi-file batch state.  When the user drops N files we process them
  // serially (the store's write mutex requires it) and show progress as
  // "Importing 3 of 7…".
  let batchTotal = $state(0);
  let batchDone = $state(0);

  // One summary toast per BATCH (whether the batch is one file or fifty).
  // Sections: succeeded, skipped-as-duplicate, failed-to-parse.  Sticky if
  // there are failures (user dismisses); auto-dismisses after 8s otherwise.
  interface SuccessEntry {
    fileName: string;
    bankName: string;
    accountTypeLabel: string;
    accountLast4: string | null;
    monthYear: string;
    transactionCount: number;
  }
  interface FailureEntry {
    fileName: string;
    reason: 'duplicate' | 'parse' | 'no_adapter' | 'extract' | 'checksum';
    message: string;
  }
  interface BatchToast {
    id: number;
    successes: SuccessEntry[];
    duplicates: FailureEntry[];
    failures: FailureEntry[];
  }
  let toasts = $state<BatchToast[]>([]);
  let nextToastId = 0;

  const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    checking: 'Checking',
    savings: 'Savings',
    credit_card: 'Credit Card',
    loan: 'Loan',
    cash: 'Cash',
    other: 'Account'
  };

  const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  function periodEndToMonthYear(iso: string): string {
    // ISO YYYY-MM-DD → "Month YYYY"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const year = iso.slice(0, 4);
    const monthIdx = parseInt(iso.slice(5, 7), 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return iso;
    return `${MONTH_NAMES[monthIdx]} ${year}`;
  }

  function pushBatchToast(t: Omit<BatchToast, 'id'>) {
    const id = ++nextToastId;
    toasts = [...toasts, { ...t, id }];
    // Auto-dismiss only if there are no failures — keep failures visible
    // until the user explicitly closes them.
    if (t.failures.length === 0 && t.duplicates.length === 0) {
      setTimeout(() => {
        toasts = toasts.filter((x) => x.id !== id);
      }, 8000);
    }
  }

  function dismissToast(id: number) {
    toasts = toasts.filter((x) => x.id !== id);
  }

  // Diagnostic: how many statements we hydrated, which backend is in use,
  // and any persist-error message.  All shown in the header banner so a
  // failure isn't silent.
  let hydratedCount = $state<number | null>(null);
  let storageBackend = $state<StorageBackend | null>(null);
  let persistError = $state<string | null>(null);

  onMount(async () => {
    console.info('[money-tracker] onMount: loading state from persistence…');
    try {
      const loaded = await loadImports();
      imports = loaded.imports;
      hydratedCount = loaded.imports.length;
      storageBackend = getLastUsedBackend();
      console.info(
        `[money-tracker] hydrated ${loaded.imports.length} statement(s) from ${storageBackend}`
      );
    } catch (err) {
      console.error('[money-tracker] hydration failed', err);
      persistError = err instanceof Error ? err.message : String(err);
    } finally {
      hydrating = false;
      // If the user came back from /statements/[hash] with ?focus=<hash> in
      // the URL, scroll the matching card into view so they don't lose their
      // place after a drill-through.
      const focusHash = $page.url.searchParams.get('focus');
      if (focusHash) {
        const idx = imports.findIndex((i) => i.pdf_source_hash === focusHash);
        if (idx >= 0) await scrollToImport(idx);
      }
    }
  });

  // Adapt ImportSuccess[] → ImportedStatement[] for the matcher.
  function toImportedStatements(): ImportedStatement[] {
    return imports.map((imp) => ({
      statement: imp.statement,
      transactions: imp.transactions,
      bank_name: imp.bank_name,
      adapter_name: imp.adapter_name,
      pdf_source_hash: imp.pdf_source_hash
    }));
  }

  let links = $derived.by<ReconciliationLink[]>(() => {
    if (imports.length === 0) return [];
    return reconcileImports(toImportedStatements());
  });

  // Statistics for the header.
  let linkCount = $derived(links.length);
  let bankCount = $derived(
    imports.filter((i) => i.statement.account_type !== 'credit_card').length
  );
  let ccCount = $derived(imports.filter((i) => i.statement.account_type === 'credit_card').length);

  async function handleFiles(files: File[]) {
    lastFailure = null;
    busy = true;
    batchTotal = files.length;
    batchDone = 0;
    const successes: SuccessEntry[] = [];
    const duplicates: FailureEntry[] = [];
    const failures: FailureEntry[] = [];
    try {
      for (const file of files) {
        currentFileName = file.name;
        stage = { stage: 'reading' };
        await processOneFile(file, successes, duplicates, failures);
        batchDone++;
      }
      // One summary popup for the whole batch — even single-file uploads
      // get a summary; the renderer collapses to a one-line format when
      // there's exactly one success and nothing else.
      if (successes.length + duplicates.length + failures.length > 0) {
        pushBatchToast({ successes, duplicates, failures });
      }
    } finally {
      busy = false;
      stage = null;
      currentFileName = null;
      batchTotal = 0;
      batchDone = 0;
    }
  }

  async function processOneFile(
    file: File,
    successes: SuccessEntry[],
    duplicates: FailureEntry[],
    failures: FailureEntry[]
  ): Promise<void> {
    let result: ImportResult;
    try {
      result = await importStatement(file, {
        onProgress: (s) => (stage = s)
      });
    } catch (err) {
      console.error('[money-tracker] uncaught import error', err);
      failures.push({
        fileName: file.name,
        reason: 'parse',
        message:
          'Unexpected error during import: ' + (err instanceof Error ? err.message : String(err))
      });
      return;
    }

    if (!result.ok) {
      const reasonMap: Record<typeof result.reason, FailureEntry['reason']> = {
        no_adapter: 'no_adapter',
        parse_error: 'parse',
        checksum_failed: 'checksum',
        extract_failed: 'extract'
      };
      failures.push({
        fileName: file.name,
        reason: reasonMap[result.reason] ?? 'parse',
        message: result.message
      });
      // Keep the existing red banner ALSO populated for checksum failures
      // so the user can see the per-level diff (which the toast doesn't show).
      if (result.reason === 'checksum_failed') {
        lastFailure = { fileName: file.name, failure: result };
      }
      return;
    }

    // Idempotency by PDF SHA-256 hash.
    if (imports.some((i) => i.pdf_source_hash === result.pdf_source_hash)) {
      duplicates.push({
        fileName: file.name,
        reason: 'duplicate',
        message: 'Already imported (same PDF hash).'
      });
      return;
    }

    imports = [...imports, result];

    const record: ImportRecord = {
      bank_name: result.bank_name,
      adapter_name: result.adapter_name,
      adapter_version: result.adapter_version,
      pdf_source_hash: result.pdf_source_hash,
      imported_at: new Date().toISOString(),
      statement: result.statement,
      transactions: result.transactions,
      checksum_strategy_used: result.checksum.strategy_used
    };
    console.info(`[money-tracker] persisting import ${record.pdf_source_hash.slice(0, 12)}…`);
    try {
      await addImport(record);
      storageBackend = getLastUsedBackend();
      persistError = null;
      console.info(`[money-tracker] persisted ✓ (backend: ${storageBackend})`);
      successes.push({
        fileName: file.name,
        bankName: result.bank_name,
        accountTypeLabel:
          ACCOUNT_TYPE_LABELS[result.statement.account_type] ?? result.statement.account_type,
        accountLast4: result.statement.account_last_4,
        monthYear: periodEndToMonthYear(result.statement.period_end),
        transactionCount: result.transactions.length
      });
    } catch (err) {
      persistError = err instanceof Error ? err.message : String(err);
      console.error('[money-tracker] persist FAILED', err);
      failures.push({
        fileName: file.name,
        reason: 'extract',
        message: 'Persist failed: ' + (err instanceof Error ? err.message : String(err))
      });
    }
  }

  async function removeAt(idx: number) {
    const hashToRemove = imports[idx]?.pdf_source_hash;
    imports = imports.filter((_, i) => i !== idx);
    if (hashToRemove) await removeImport(hashToRemove);
  }

  let loadingDemo = $state(false);
  async function handleLoadDemo() {
    loadingDemo = true;
    await loadDemoData();
    // Re-hydrate from the stores we just populated.
    const loaded = await loadImports();
    imports = loaded.imports;
    hydratedCount = loaded.imports.length;
    storageBackend = getLastUsedBackend();
    loadingDemo = false;
  }

  async function clearAll() {
    if (
      !confirm(
        'Clear all imported statements? This wipes everything from your browser storage. Cannot be undone.'
      )
    ) {
      return;
    }
    imports = [];
    lastFailure = null;
    await clearState();
  }

  // NOTE: reconciliation links are NOT separately persisted.  They are pure-
  // function output of the matcher over `imports`, recomputed via `links`
  // ($derived) on every load.  Persisting them would create a write-write
  // race against `addImport` / `removeImport` (both do load-modify-save) that
  // can wipe the just-saved import.  Earlier symptom: drop a PDF, refresh,
  // statement gone, console showed "hydrated 0 statement(s)" even though the
  // save logged "persisted ✓".  Removing the autosave fixed it.

  async function scrollToImport(idx: number) {
    await tick();
    document
      .getElementById(`statement-${idx}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Briefly flash the target so the user sees what was matched.
    const el = document.getElementById(`statement-${idx}`);
    if (el) {
      el.classList.add('flash-highlight');
      setTimeout(() => el.classList.remove('flash-highlight'), 1500);
    }
  }

  function stageLabel(s: ImportStage): string {
    switch (s.stage) {
      case 'reading':
        return 'reading file';
      case 'extracting':
        return 'extracting PDF text';
      case 'detecting':
        return 'detecting bank';
      case 'parsing':
        return `parsing (${s.adapter_name})`;
      case 'validating':
        return 'running checksum gate';
    }
  }
</script>

<svelte:head><title>Money Tracker</title></svelte:head>

<main class="mx-auto max-w-5xl px-6 py-12">
  <TopNav />
  <header class="mb-6 flex flex-wrap items-baseline justify-between gap-4">
    <div>
      <h1 class="text-3xl font-semibold tracking-tight text-[var(--color-text)]">Money Tracker</h1>
      <p class="mt-1 text-sm text-[var(--color-muted)]">
        Phase 1A — drop bank or credit-card PDFs. Everything runs in your browser; imports survive
        reload.
      </p>
      <p class="mt-1 text-xs">
        {#if hydrating}
          <span class="text-[var(--color-muted)]">Loading saved statements…</span>
        {:else if imports.length === 0}
          <span class="text-[var(--color-muted)]">
            Storage ready ({storageBackend ?? 'unknown'}). No statements yet — drop a PDF to start.
          </span>
        {:else}
          <span class="text-[var(--color-success)]">
            ✓ {imports.length} statement{imports.length === 1 ? '' : 's'} saved to {storageBackend ??
              'storage'}.
            {#if hydratedCount !== null && hydratedCount > 0}
              <span class="text-[var(--color-muted)]"
                >({hydratedCount} restored from prior session)</span
              >
            {/if}
          </span>
        {/if}
      </p>
      {#if persistError}
        <p
          class="mt-2 rounded-md border px-3 py-1 text-xs"
          style="border-color: var(--color-danger); color: var(--color-danger); background-color: color-mix(in oklab, var(--color-danger) 12%, transparent);"
        >
          ⚠ Save failed: {persistError}
        </p>
      {/if}
    </div>
    {#if imports.length > 0}
      <div class="text-right text-xs text-[var(--color-muted)]">
        <p>
          {bankCount} bank · {ccCount} credit card ·
          {#if linkCount > 0}
            <span class="text-[var(--color-accent)]">{linkCount} matched</span>
          {:else}
            no matches yet
          {/if}
        </p>
        <button
          type="button"
          onclick={clearAll}
          class="mt-1 rounded-lg border px-3 py-1 text-xs text-[var(--color-muted)] transition-colors"
          style="border-color: var(--color-border); background-color: var(--color-surface);"
        >
          Clear all
        </button>
      </div>
    {/if}
  </header>

  <PdfDropZone onFiles={handleFiles} disabled={busy} />

  {#if busy && stage}
    <p class="mt-3 text-sm text-[var(--color-muted)]">
      {#if batchTotal > 1}
        <span class="text-[var(--color-accent)]">Importing {batchDone + 1} of {batchTotal}:</span>
        {currentFileName} — {stageLabel(stage)}…
      {:else}
        {currentFileName} — {stageLabel(stage)}…
      {/if}
    </p>
  {/if}

  {#if lastFailure}
    <div
      class="mt-4 rounded-xl border p-4"
      style="border-color: var(--color-danger); background-color: color-mix(in oklab, var(--color-danger) 12%, transparent);"
    >
      <p class="font-medium text-[var(--color-danger)]">
        <span class="font-mono">{lastFailure.fileName}</span> —
        {#if lastFailure.failure.reason === 'no_adapter'}
          Bank not supported yet
        {:else if lastFailure.failure.reason === 'parse_error'}
          Parser failed
        {:else if lastFailure.failure.reason === 'checksum_failed'}
          Checksum refused — import blocked
        {:else}
          File could not be read as a PDF
        {/if}
      </p>
      <p class="mt-2 text-sm text-[var(--color-text)]">{lastFailure.failure.message}</p>
      <button
        type="button"
        onclick={() => (lastFailure = null)}
        class="mt-3 rounded-lg border px-3 py-1 text-xs text-[var(--color-muted)]"
        style="border-color: var(--color-danger); background-color: transparent;"
      >
        Dismiss
      </button>
    </div>
  {/if}

  {#if imports.length === 0}
    <div class="mt-8 text-center text-sm text-[var(--color-muted)]">
      <p>No statements imported yet. Drop one or more PDFs above to get started.</p>
      <div class="mt-4">
        <button
          type="button"
          onclick={handleLoadDemo}
          disabled={loadingDemo}
          class="btn btn-primary"
        >
          {loadingDemo ? 'Loading…' : 'Load sample data to explore'}
        </button>
        <p class="mt-1 text-xs">It's fake data — "Clear all" wipes it anytime.</p>
      </div>
      <p class="mt-4">
        Once you import both a bank statement AND a credit-card statement, payments from your bank
        account to the card will be matched up automatically — click the
        <span class="text-[var(--color-accent)]">→ See what this paid for</span> badge to drill through.
      </p>
    </div>
  {:else}
    <div class="mt-6 space-y-6">
      {#each imports as imp, idx (imp.pdf_source_hash)}
        <div id={`statement-${idx}`}>
          <StatementCard
            import_={imp}
            importIndex={idx}
            {links}
            onLinkClick={(link) => {
              // Drill into the PAYMENT, not the statement.  The payment
              // page runs FIFO attribution across the card's full
              // transaction stream and shows the actual purchases this
              // payment paid for — which may live on a PRIOR statement,
              // not the one the matcher pointed at as the receiving
              // statement.
              const url = `/payments/${encodeURIComponent(imp.pdf_source_hash)}/${link.bank_transaction_index}`;
              goto(url);
            }}
            onRemove={() => removeAt(idx)}
          />
        </div>
      {/each}
    </div>
  {/if}

  <footer class="mt-12 text-xs text-[var(--color-muted)]">
    All parsing happens locally. Nothing is uploaded. Imports survive reload via your browser's
    storage.
  </footer>
</main>

<!--
  Batch-import summary toasts.  One toast per batch (where a batch = one
  call to handleFiles, regardless of how many files were in it).
  Auto-dismisses after 8s if everything succeeded; sticky if there are
  duplicates or failures so the user can read them at their own pace.
-->
<div
  class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
  aria-live="polite"
>
  {#each toasts as t (t.id)}
    {@const successCount = t.successes.length}
    {@const duplicateCount = t.duplicates.length}
    {@const failureCount = t.failures.length}
    {@const totalCount = successCount + duplicateCount + failureCount}
    {@const allSuccess = failureCount === 0 && duplicateCount === 0}
    <div
      class="pointer-events-auto rounded-lg border p-3 shadow-lg"
      style:border-color={allSuccess
        ? 'var(--color-success)'
        : failureCount > 0
          ? 'var(--color-danger)'
          : 'var(--color-warning)'}
      style="background-color: var(--color-surface);"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <!-- Header line — short summary -->
          <p
            class="text-sm font-medium"
            style:color={allSuccess
              ? 'var(--color-success)'
              : failureCount > 0
                ? 'var(--color-danger)'
                : 'var(--color-warning)'}
          >
            {#if totalCount === 1 && successCount === 1}
              ✓ Imported {t.successes[0]!.bankName}
              {t.successes[0]!.accountTypeLabel}{#if t.successes[0]!.accountLast4}
                <span class="font-mono text-xs text-[var(--color-muted)]">
                  •••• {t.successes[0]!.accountLast4}</span
                >
              {/if}
            {:else if allSuccess}
              ✓ Imported {successCount} statement{successCount === 1 ? '' : 's'}
            {:else}
              {successCount} of {totalCount} imported
              {#if duplicateCount > 0}
                · {duplicateCount} skipped
              {/if}
              {#if failureCount > 0}
                · {failureCount} failed
              {/if}
            {/if}
          </p>

          <!-- Single-file collapsed form: show period + count + filename -->
          {#if totalCount === 1 && successCount === 1}
            <p class="mt-0.5 text-xs text-[var(--color-text)]">
              {t.successes[0]!.monthYear} ·
              {t.successes[0]!.transactionCount} transaction{t.successes[0]!.transactionCount === 1
                ? ''
                : 's'}
            </p>
            <p
              class="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]"
              title={t.successes[0]!.fileName}
            >
              {t.successes[0]!.fileName}
            </p>
          {:else}
            <!-- Multi-file: itemized lists -->
            {#if successCount > 0}
              <div class="mt-2">
                <p class="text-xs font-medium text-[var(--color-success)]">
                  Imported ({successCount}):
                </p>
                <ul class="mt-1 space-y-0.5 text-xs text-[var(--color-text)]">
                  {#each t.successes as s, i (i)}
                    <li class="truncate" title={s.fileName}>
                      <span class="text-[var(--color-text)]">{s.bankName} {s.accountTypeLabel}</span
                      >
                      {#if s.accountLast4}
                        <span class="font-mono text-[var(--color-muted)]">••••{s.accountLast4}</span
                        >
                      {/if}
                      <span class="text-[var(--color-muted)]"
                        >— {s.monthYear} · {s.transactionCount} txns</span
                      >
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if duplicateCount > 0}
              <div class="mt-2">
                <p class="text-xs font-medium text-[var(--color-warning)]">
                  Skipped — already imported ({duplicateCount}):
                </p>
                <ul class="mt-1 space-y-0.5 text-xs text-[var(--color-muted)]">
                  {#each t.duplicates as d, i (i)}
                    <li class="truncate font-mono" title={d.fileName}>{d.fileName}</li>
                  {/each}
                </ul>
              </div>
            {/if}

            {#if failureCount > 0}
              <div class="mt-2">
                <p class="text-xs font-medium text-[var(--color-danger)]">
                  Failed ({failureCount}):
                </p>
                <ul class="mt-1 space-y-1 text-xs">
                  {#each t.failures as f, i (i)}
                    <li>
                      <p class="truncate font-mono text-[var(--color-text)]" title={f.fileName}>
                        {f.fileName}
                      </p>
                      <p class="text-[var(--color-muted)]">{f.message}</p>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}
        </div>
        <button
          type="button"
          onclick={() => dismissToast(t.id)}
          class="-mt-1 -mr-1 rounded p-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  :global(.flash-highlight) {
    animation: flash 1.5s ease-out;
  }
  @keyframes flash {
    0% {
      outline: 2px solid var(--color-accent);
      outline-offset: 4px;
    }
    100% {
      outline: 2px solid transparent;
      outline-offset: 4px;
    }
  }
</style>
