<script lang="ts">
  import { onMount } from 'svelte';
  import BrandMark from '$components/BrandMark.svelte';
  import PassphraseSetup from '$components/PassphraseSetup.svelte';
  import IosInstallNudge from '$components/IosInstallNudge.svelte';
  import { needsIosInstall } from '$lib/app/platform';
  import { signIn, isSyncConfigured } from '$lib/sync/drive-auth';
  import { deriveKey } from '$lib/crypto/kdf';
  import { generateSalt, saltToBase64 } from '$lib/crypto/salt';
  import { setSessionKey } from '$lib/crypto/session';
  import { SALT_STORAGE_KEY } from '$lib/app/unlock';
  import { CURRENCIES, setCurrencyPref, type CurrencyCode } from '$lib/app/prefs';

  type Step = 'install' | 'signin' | 'currency' | 'passphrase' | 'securing' | 'ready';
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
      step = 'currency';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function handlePassphrase(passphrase: string) {
    step = 'securing';
    error = '';
    try {
      const salt = generateSalt();
      const key = await deriveKey(passphrase, salt);
      setSessionKey(key); // held in memory only (constitution X)
      localStorage.setItem(SALT_STORAGE_KEY, saltToBase64(salt));
      step = 'ready';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      step = 'passphrase';
    }
  }

  function recheckInstall() {
    if (!needsIosInstall()) step = 'signin';
  }

  function chooseCurrency(code: CurrencyCode) {
    setCurrencyPref(code);
    step = 'passphrase';
  }
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
  <div class="rise mb-6 flex flex-col items-center text-center">
    <div class="mb-3"><BrandMark size={46} wordmark={false} /></div>
    <h1 class="text-2xl font-semibold tracking-tight">Welcome to trackcents</h1>
    <p class="mt-1 text-sm" style:color="var(--color-muted)">
      See where every cent goes — privately, on your device.
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
          Sign in so your <em>encrypted</em> backup can sync to your own Google Drive. The app only ever
          touches files it creates — it can't read your data.
        </p>
        <button type="button" class="btn btn-primary mt-4 w-full" onclick={handleSignIn}>
          Sign in with Google
        </button>
        <button
          type="button"
          class="mt-3 block w-full text-center text-xs"
          style:color="var(--color-muted)"
          onclick={() => (step = 'currency')}
        >
          Continue without sync
        </button>
      {:else}
        <h2 class="text-lg font-semibold">Set up on this device</h2>
        <p class="mt-2 text-sm" style:color="var(--color-muted)">
          trackcents runs entirely on your device — your statements never leave the browser. Next,
          pick a passphrase to encrypt everything you import.
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
  {:else if step === 'passphrase'}
    <div class="card rise p-6">
      <PassphraseSetup onComplete={handlePassphrase} />
    </div>
  {:else if step === 'securing'}
    <div class="card rise p-6 text-center">
      <p class="text-sm" style:color="var(--color-muted)">Securing your data…</p>
    </div>
  {:else}
    <div class="card rise p-6 text-center">
      <h2 class="text-lg font-semibold">You're all set</h2>
      <p class="mt-2 text-sm" style:color="var(--color-muted)">
        Your passphrase is set and your data will be encrypted on this device.
      </p>
      <a href="/" class="btn btn-primary mt-4 w-full">Start importing</a>
    </div>
  {/if}
</main>
