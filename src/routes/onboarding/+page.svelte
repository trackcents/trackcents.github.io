<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import BrandMark from '$components/BrandMark.svelte';
  import IosInstallNudge from '$components/IosInstallNudge.svelte';
  import { needsIosInstall } from '$lib/app/platform';
  import { signIn, isSyncConfigured } from '$lib/sync/drive-auth';
  import { initSyncIfReady, triggerSync } from '$lib/sync/sync-controller';
  import { CURRENCIES, setCurrencyPref, type CurrencyCode } from '$lib/app/prefs';
  import { getDisplayCurrency } from '$lib/util/money';

  // Adapt the local-only tagline to the user's currency once chosen.
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

<svelte:head><title>trackcents · See where every cent goes</title></svelte:head>

<main class="welcome relative min-h-dvh overflow-hidden">
  <div class="glow" aria-hidden="true"></div>

  <div class="relative mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-5 py-10 sm:px-8">
    {#if error}
      <div
        class="mx-auto mb-6 w-full max-w-md rounded-xl px-4 py-3 text-sm"
        style="background-color: var(--color-danger-soft); color: var(--color-danger);"
      >
        {error}
      </div>
    {/if}

    {#if step === 'install'}
      <div class="rise mx-auto w-full max-w-md">
        <IosInstallNudge oncomplete={recheckInstall} />
      </div>
    {:else if step === 'signin'}
      <div class="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <!-- Left: brand, value prop, CTAs -->
        <div class="stagger text-center lg:text-left">
          <div class="rise mb-7 flex justify-center lg:justify-start">
            <BrandMark size={38} wordmark={true} />
          </div>

          {#if syncAvailable}
            <h1
              class="rise text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-4xl lg:text-[2.7rem]"
            >
              See exactly where<br class="hidden sm:block" />
              your <span style:color="var(--color-accent)">money</span> goes.
            </h1>
            <p
              class="rise mx-auto mt-4 max-w-md text-[15px] leading-relaxed lg:mx-0"
              style:color="var(--color-muted)"
            >
              Drop in a bank or card statement and trackcents sorts every transaction into clear
              categories you can actually read.
            </p>
            <div
              class="rise mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start"
            >
              <button type="button" class="gbtn" onclick={handleSignIn}>
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
                  />
                  <path
                    fill="#34A853"
                    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"
                  />
                  <path
                    fill="#EA4335"
                    d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
                  />
                </svg>
                Sign in with Google
              </button>
              <button
                type="button"
                class="btn btn-ghost px-5 py-3"
                onclick={() => (step = 'currency')}
              >
                Continue without sync
              </button>
            </div>
          {:else}
            <h1
              class="rise text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-4xl lg:text-[2.7rem]"
            >
              See exactly where<br class="hidden sm:block" />
              your <span style:color="var(--color-accent)">money</span> goes.
            </h1>
            <p
              class="rise mx-auto mt-4 max-w-md text-[15px] leading-relaxed lg:mx-0"
              style:color="var(--color-muted)"
            >
              trackcents runs right in your browser. Drop in a statement and see where every {taglineUnit}
              went, privately on this device.
            </p>
            <div class="rise mt-8 flex justify-center lg:justify-start">
              <button
                type="button"
                class="btn btn-primary px-6 py-3 text-[0.95rem]"
                onclick={() => (step = 'currency')}
              >
                Get started
              </button>
            </div>
          {/if}
        </div>

        <!-- Right: a real preview of the app -->
        <div class="rise flex justify-center lg:justify-end">
          <div class="phone" aria-hidden="true">
            <img
              src="{base}/preview-app.png"
              alt="trackcents showing transactions grouped by day with categories and amounts"
            />
            <div class="phone-fade"></div>
          </div>
        </div>
      </div>

      <p class="rise mt-10 text-center text-xs lg:text-left" style:color="var(--color-muted)">
        {#if syncAvailable}
          Your data lives in your own Google Drive, never on a server we run.
        {:else}
          Everything stays on this device. Nothing is uploaded.
        {/if}
      </p>
    {:else if step === 'currency'}
      <div class="rise mx-auto w-full max-w-md">
        <div class="card p-6">
          <h2 class="text-lg font-semibold">Choose your currency</h2>
          <p class="mt-2 text-sm" style:color="var(--color-muted)">
            Amounts will show in this currency. You can change it anytime in Settings.
          </p>
          <div class="mt-4 grid gap-2">
            {#each CURRENCIES as c (c.code)}
              <button
                type="button"
                class="btn btn-ghost w-full justify-between py-3"
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
      </div>
    {:else}
      <div class="rise mx-auto w-full max-w-md">
        <div class="card p-7 text-center">
          <div class="mb-3 flex justify-center"><BrandMark size={40} wordmark={false} /></div>
          <h2 class="text-xl font-semibold">You're all set</h2>
          <p class="mt-2 text-sm" style:color="var(--color-muted)">
            Import a statement to see your spending, or add a transaction by hand.
          </p>
          <a href="/today" class="btn btn-primary mt-5 w-full py-3">Open my budget</a>
        </div>
      </div>
    {/if}
  </div>
</main>

<style>
  /* Warm terracotta brand glow behind the hero (on-brand, not a generic AI wash). */
  .glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(
        62% 48% at 50% -8%,
        color-mix(in oklab, var(--color-accent) 22%, transparent),
        transparent 72%
      ),
      radial-gradient(
        46% 40% at 100% 4%,
        color-mix(in oklab, var(--color-accent-2) 16%, transparent),
        transparent 70%
      );
  }

  /* White, Google-branded primary sign-in button (credible + high contrast). */
  .gbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    border-radius: var(--radius-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow);
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0.75rem 1.25rem;
    cursor: pointer;
    transition:
      transform 0.16s ease,
      box-shadow 0.16s ease,
      background-color 0.16s ease;
  }
  .gbtn:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }
  .gbtn:active {
    transform: translateY(0) scale(0.98);
  }

  /* Real app screenshot in a soft device frame, height-capped so the hero never
     overflows the viewport; the bottom fade implies "more inside". */
  .phone {
    position: relative;
    width: 100%;
    max-width: 290px;
    height: clamp(340px, 56vh, 560px);
    padding: 8px;
    border-radius: 30px;
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }
  .phone img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 22px;
    object-fit: cover;
    object-position: top;
  }
  .phone-fade {
    position: absolute;
    inset: auto 8px 8px 8px;
    height: 22%;
    border-radius: 0 0 22px 22px;
    background: linear-gradient(to bottom, transparent, var(--color-bg) 92%);
  }
</style>
