<script lang="ts">
  import { onMount } from 'svelte';
  import BrandMark from '$components/BrandMark.svelte';
  import IosInstallNudge from '$components/IosInstallNudge.svelte';
  import { needsIosInstall } from '$lib/app/platform';
  import { signIn, isSyncConfigured } from '$lib/sync/drive-auth';
  import { initSyncIfReady, triggerSync } from '$lib/sync/sync-controller';
  import { CURRENCIES, setCurrencyPref, type CurrencyCode } from '$lib/app/prefs';
  import { getDisplayCurrency } from '$lib/util/money';

  // Adapt the welcome tagline to the user's currency once chosen.  Until then
  // (first launch, before the currency step) we use the neutral default.
  const displayCurrencyHere = $derived(getDisplayCurrency());
  const taglineUnit = $derived(displayCurrencyHere === 'INR' ? 'rupee' : 'cent');

  type Step = 'install' | 'signin' | 'currency' | 'ready';
  let step = $state<Step>('signin');
  let error = $state('');
  const syncAvailable = isSyncConfigured();

  onMount(() => {
    if (needsIosInstall()) step = 'install';
  });

  async function handleSignIn() {
    error = '';
    try {
      await signIn();
      // Configure the engine and kick a first sync in the background so the
      // user's Drive backup folder is created right away (no-op if nothing to
      // sync yet). Failures here never block onboarding.
      initSyncIfReady();
      void triggerSync().catch(() => {});
      step = 'currency';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function recheckInstall() {
    if (!needsIosInstall()) step = 'signin';
  }

  function chooseCurrency(code: CurrencyCode) {
    setCurrencyPref(code);
    // Mark onboarding complete so the layout doesn't redirect a user who finished
    // setup but hasn't imported a statement yet back into onboarding on reload.
    try {
      localStorage.setItem('mtrb.onboarded', '1');
    } catch {
      /* ignore */
    }
    step = 'ready';
  }
</script>

<svelte:head><title>Welcome · trackcents</title></svelte:head>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
  <div class="rise mb-6 flex flex-col items-center text-center">
    <div class="mb-3"><BrandMark size={46} wordmark={false} /></div>
    <h1 class="text-2xl font-semibold tracking-tight">Welcome to trackcents</h1>
    <p class="mt-1 text-sm" style:color="var(--color-muted)">
      See where every {taglineUnit} goes.
    </p>
  </div>

  {#if error}
    <p
      class="mb-4 rounded-lg p-3 text-sm"
      style="background-color: var(--color-danger-soft); color: var(--color-danger);"
    >
      {error}
    </p>
  {/if}

  {#if step === 'install'}
    <IosInstallNudge oncomplete={recheckInstall} />
  {:else if step === 'signin'}
    <div class="card rise p-6">
      {#if syncAvailable}
        <h2 class="text-lg font-semibold">Sign in with Google</h2>
        <p class="mt-2 text-sm" style:color="var(--color-muted)">
          Sign in to back up and sync your data to your own Google Drive, so it's there on every
          device. The app only ever touches files it creates in your Drive.
        </p>
        <button type="button" class="btn btn-primary mt-4 w-full" onclick={handleSignIn}>
          Sign in with Google
        </button>
        <button type="button" class="btn btn-ghost mt-3 w-full" onclick={() => (step = 'currency')}>
          Continue without sync
        </button>
        <p class="mt-2 text-center text-xs" style:color="var(--color-muted)">
          Sync is optional — you can sign in later from Settings.
        </p>
      {:else}
        <h2 class="text-lg font-semibold">Set up on this device</h2>
        <p class="mt-2 text-sm" style:color="var(--color-muted)">
          trackcents runs in your browser — import a statement and see exactly where your money
          goes. Your data stays on this device.
        </p>
        <button
          type="button"
          class="btn btn-primary mt-4 w-full"
          onclick={() => (step = 'currency')}
        >
          Get started
        </button>
        <p class="mt-3 text-center text-xs" style:color="var(--color-muted)">
          This build is local-only — Google Drive sync isn't enabled.
        </p>
      {/if}
    </div>
  {:else if step === 'currency'}
    <div class="card rise p-6">
      <h2 class="text-lg font-semibold">Choose your currency</h2>
      <p class="mt-2 text-sm" style:color="var(--color-muted)">
        Amounts will show in this currency. You can change it anytime in Settings.
      </p>
      <div class="mt-4 grid gap-2">
        {#each CURRENCIES as c (c.code)}
          <button
            type="button"
            class="btn btn-ghost w-full justify-between"
            onclick={() => chooseCurrency(c.code)}
          >
            <span>{c.label}</span>
            <span class="num text-base font-semibold" style:color="var(--color-accent)"
              >{c.symbol}</span
            >
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="card rise p-6 text-center">
      <h2 class="text-lg font-semibold">You're all set</h2>
      <p class="mt-2 text-sm" style:color="var(--color-muted)">
        Import a statement to see your spending, or add a transaction by hand.
      </p>
      <a href="/today" class="btn btn-primary mt-4 w-full">Open my budget</a>
    </div>
  {/if}
</main>
