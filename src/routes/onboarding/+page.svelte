<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import BrandMark from '$components/BrandMark.svelte';
  import IosInstallNudge from '$components/IosInstallNudge.svelte';
  import { needsIosInstall } from '$lib/app/platform';
  import { signIn, isSyncConfigured } from '$lib/sync/drive-auth';
  import { initSyncIfReady, triggerSync } from '$lib/sync/sync-controller';
  import { loadState } from '$lib/db/store';
  import { CURRENCIES, setCurrencyPref, applyPrefs, type CurrencyCode } from '$lib/app/prefs';

  type Step = 'install' | 'signin' | 'currency' | 'ready';
  let step = $state<Step>('signin');
  let error = $state('');
  let signingIn = $state(false);
  const syncAvailable = isSyncConfigured();

  onMount(() => {
    if (needsIosInstall()) step = 'install';
  });

  async function handleSignIn() {
    error = '';
    signingIn = true;
    try {
      await signIn();
      // Pull from Drive first. A returning user signing in on a new device gets
      // their data back and goes straight to the app, skipping the setup steps.
      initSyncIfReady();
      await triggerSync().catch(() => {});
      // The pull may have brought this account's saved currency (USD/INR) down
      // from another device — apply it before we render any money.
      applyPrefs();
      const s = await loadState();
      if (s.imports.length > 0) {
        try {
          localStorage.setItem('mtrb.onboarded', '1');
        } catch {
          /* ignore */
        }
        await goto(`${base}/today`);
        return;
      }
      step = 'currency';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      signingIn = false;
    }
  }

  function recheckInstall() {
    if (!needsIosInstall()) step = 'signin';
  }

  function chooseCurrency(code: CurrencyCode) {
    setCurrencyPref(code);
    try {
      localStorage.setItem('mtrb.onboarded', '1');
    } catch {
      /* ignore */
    }
    step = 'ready';
  }

  // Apple-style scroll reveal: fade + rise as each block enters the viewport.
  function reveal(node: HTMLElement) {
    const reduce =
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      node.classList.add('in');
      return;
    }
    // Arm the hidden state ONLY now that JS is running, so the content is never
    // stuck invisible if scripts/observer fail (progressive enhancement).
    node.classList.add('reveal-armed');
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add('in');
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    obs.observe(node);
    return { destroy: () => obs.disconnect() };
  }

  const showcases = [
    {
      kicker: 'Spending by category',
      title: 'See exactly where it went.',
      body: 'One tap turns your spending into a clear, color-coded picture: every category ranked, with its share and total. Tap any slice to drill into its sub-categories and the transactions behind it.',
      img: 'shot-categories.png',
      alt: 'Spending-by-category donut chart with each category color-coded, ranked by amount'
    },
    {
      kicker: 'Bills & subscriptions',
      title: 'Never miss a bill again.',
      body: 'Every subscription and bill in one place. trackcents spots recurring charges from your statements, you add your own, mark each one paid, and see what is still due this month.',
      img: 'shot-recurring.png',
      alt: 'Recurring bills and subscriptions for the month with paid and due amounts'
    },
    {
      kicker: 'Every paycheck',
      title: 'Follow every paycheck.',
      body: 'Get paid, then see exactly where it goes. Each paycheck and every other deposit is split into simple pockets that count down what you have left to spend.',
      img: 'shot-today.png',
      alt: 'Income split into paychecks, extra, and savings pockets with what is left to spend'
    },
    {
      kicker: 'Every transaction, sorted',
      title: 'Every statement, sorted in seconds.',
      body: 'Drop in a bank or card PDF and every transaction is parsed on your device, grouped by day, and auto-categorized. Rename, split, or re-tag any of them.',
      img: 'shot-transactions.png',
      alt: 'Transactions grouped by day with categories, amounts, and merchant icons'
    }
  ];

  const featureGroups = [
    {
      title: 'Import & understand',
      items: [
        ['Multi-bank PDF import', 'Chase, Amex, Discover, Bank of America, Robinhood and more.'],
        ['Smart categories', 'Auto-sorted, with sub-categories you can drill into.'],
        ['Search & filter', 'Find any transaction across every statement in seconds.'],
        ['Spending trends', 'Watch each category move month to month.']
      ]
    },
    {
      title: 'Get the numbers right',
      items: [
        ['Card reconciliation', 'See exactly what each card payment paid for.'],
        ['Refunds matched', 'Returns linked to the original purchase, never double-counted.'],
        ['Transfers excluded', 'Money moved between your own accounts is left out of spending.'],
        ['Budgets & goals', 'Per-category limits and savings goals you can track.']
      ]
    },
    {
      title: 'Yours, everywhere',
      items: [
        ['Google Drive sync', 'Your data syncs across devices through your own Drive.'],
        ['Multi-currency', 'Built for dollars and rupees out of the box.'],
        ['CSV in and out', 'Import any bank we do not parse yet, export anytime.'],
        ['Offline & installable', 'Add it to your home screen and use it anywhere.']
      ]
    }
  ];
</script>

<svelte:head><title>trackcents · See where every cent goes</title></svelte:head>

{#if step === 'signin'}
  <!-- ──────────────────────────  LANDING  ────────────────────────── -->
  <div class="landing">
    {#if error}
      <div class="err">{error}</div>
    {/if}

    <!-- HERO -->
    <section class="hero">
      <div class="glow" aria-hidden="true"></div>
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="brandrow"><BrandMark size={34} wordmark={true} /></div>
          <h1>
            Finally, see where<br class="br" />
            your <span class="accent">money</span> goes.
          </h1>
          <p class="lede">
            Import a bank or card statement and trackcents sorts every transaction, tracks your
            bills, and shows you exactly what is left. Private to you.
          </p>
          <p class="cta-prompt">
            {#if syncAvailable}
              Sign in with Google to start tracking your money, free.
            {:else}
              Start tracking your money, free.
            {/if}
          </p>
          <div class="cta">
            {#if syncAvailable}
              {@render googleBtn(handleSignIn, signingIn)}
            {:else}
              <button type="button" class="btn btn-primary big" onclick={() => (step = 'currency')}>
                Get started
              </button>
            {/if}
          </div>
          <p class="microtrust">
            {#if syncAvailable}
              Open source. No ads. Your data stays in your own Google Drive.
            {:else}
              Open source. No ads. Everything stays on your device.
            {/if}
          </p>
        </div>

        <div class="hero-art" aria-hidden="true">
          <div class="phone tilt">
            <img src="{base}/shot-cashflow.png" alt="" />
          </div>
        </div>
      </div>
    </section>

    <!-- SHOWCASE SECTIONS -->
    {#each showcases as s, i (s.title)}
      <section class="showcase" class:flip={i % 2 === 1} use:reveal>
        <div class="show-copy">
          <span class="kicker">{s.kicker}</span>
          <h2>{s.title}</h2>
          <p>{s.body}</p>
        </div>
        <div class="show-art">
          <div class="phone">
            <img src="{base}/{s.img}" alt={s.alt} loading="lazy" />
          </div>
        </div>
      </section>
    {/each}

    <!-- FEATURE BENTO -->
    <section class="features" use:reveal>
      <h2 class="features-title">Everything in one private app.</h2>
      <div class="groups">
        {#each featureGroups as g (g.title)}
          <div class="group">
            <h3>{g.title}</h3>
            <ul>
              {#each g.items as [name, desc] (name)}
                <li>
                  <span class="dot" aria-hidden="true"></span>
                  <span class="li-text"><strong>{name}.</strong> {desc}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </section>

    <!-- PRIVACY -->
    <section class="privacy" use:reveal>
      <h2>Your money, your device, your Drive.</h2>
      <p>
        trackcents has no servers of its own and no accounts to create. Statements are parsed right
        in your browser, and your data is stored in a folder this app creates in your own Google
        Drive. No ads, no tracking, no selling your data. The whole thing is open source, so anyone
        can check.
      </p>
    </section>

    <!-- FINAL CTA -->
    <section class="finale" use:reveal>
      <div class="glow soft" aria-hidden="true"></div>
      <h2>Start tracking in two minutes.</h2>
      <div class="cta center">
        {#if syncAvailable}
          {@render googleBtn(handleSignIn, signingIn)}
        {:else}
          <button type="button" class="btn btn-primary big" onclick={() => (step = 'currency')}>
            Get started
          </button>
        {/if}
      </div>
    </section>

    <footer class="foot">
      <BrandMark size={22} wordmark={true} />
      <span>See where every cent goes.</span>
    </footer>
  </div>
{:else}
  <!-- ──────────────  SETUP STEPS (after sign-in / local)  ────────────── -->
  <main class="setup">
    <div class="glow" aria-hidden="true"></div>
    <div class="setup-inner">
      {#if error}<div class="err">{error}</div>{/if}

      {#if step === 'install'}
        <div class="rise w-full max-w-md"><IosInstallNudge oncomplete={recheckInstall} /></div>
      {:else if step === 'currency'}
        <div class="card rise w-full max-w-md p-6">
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
      {:else}
        <div class="card rise w-full max-w-md p-7 text-center">
          <div class="mb-3 flex justify-center"><BrandMark size={40} wordmark={false} /></div>
          <h2 class="text-xl font-semibold">You're all set</h2>
          <p class="mt-2 text-sm" style:color="var(--color-muted)">
            Import a statement to see your spending, or add a transaction by hand.
          </p>
          <a href="{base}/today" class="btn btn-primary mt-5 w-full py-3">Open my budget</a>
        </div>
      {/if}
    </div>
  </main>
{/if}

{#snippet googleBtn(onclick: () => void, busy: boolean)}
  <button type="button" class="gbtn" {onclick} disabled={busy}>
    {#if busy}
      <span class="spin" aria-hidden="true"></span>
      Signing in…
    {:else}
      <span class="gwrap" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
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
      </span>
      Sign in with Google
    {/if}
  </button>
{/snippet}

<style>
  .landing {
    --maxw: 72rem;
    overflow-x: clip;
  }
  .err {
    margin: 1rem auto 0;
    max-width: 30rem;
    border-radius: 12px;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    background-color: var(--color-danger-soft);
    color: var(--color-danger);
  }

  /* ── Shared warm glow ── */
  .glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(
        58% 46% at 50% -6%,
        color-mix(in oklab, var(--color-accent) 24%, transparent),
        transparent 72%
      ),
      radial-gradient(
        42% 38% at 96% 8%,
        color-mix(in oklab, var(--color-accent-2) 18%, transparent),
        transparent 70%
      );
    animation: drift 14s ease-in-out infinite alternate;
  }
  .glow.soft {
    background: radial-gradient(
      60% 60% at 50% 30%,
      color-mix(in oklab, var(--color-accent) 18%, transparent),
      transparent 72%
    );
  }
  @keyframes drift {
    from {
      transform: translate3d(0, 0, 0) scale(1);
      opacity: 0.9;
    }
    to {
      transform: translate3d(-2%, 1.5%, 0) scale(1.06);
      opacity: 1;
    }
  }

  /* ── HERO ── */
  .hero {
    position: relative;
    overflow: hidden;
  }
  .hero-inner {
    position: relative;
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 3.5rem 1.25rem 2.5rem;
    display: grid;
    gap: 2.5rem;
    align-items: center;
  }
  .brandrow {
    margin-bottom: 1.4rem;
    display: flex;
    justify-content: center;
  }
  .hero-copy {
    text-align: center;
  }
  .hero h1 {
    font-size: clamp(2.1rem, 7vw, 3.4rem);
    line-height: 1.05;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .accent {
    color: var(--color-accent);
  }
  .lede {
    margin: 1.1rem auto 0;
    max-width: 34rem;
    font-size: clamp(0.95rem, 2.6vw, 1.075rem);
    line-height: 1.6;
    color: var(--color-muted);
  }
  .cta-prompt {
    margin-top: 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
  }
  .cta {
    margin-top: 0.9rem;
    display: flex;
  }
  .cta.center {
    justify-content: center;
  }
  .hero-copy .cta {
    justify-content: center;
  }
  .microtrust {
    margin-top: 0.9rem;
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .hero-art {
    display: flex;
    justify-content: center;
  }
  .br {
    display: none;
  }

  /* Hero entrance: copy rises in (staggered), the chart slides up, then floats. */
  .hero-copy > * {
    animation: heroRise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .hero-copy > *:nth-child(2) {
    animation-delay: 0.08s;
  }
  .hero-copy > *:nth-child(3) {
    animation-delay: 0.16s;
  }
  .hero-copy > *:nth-child(4) {
    animation-delay: 0.24s;
  }
  .hero-copy > *:nth-child(5) {
    animation-delay: 0.32s;
  }
  .hero-copy > *:nth-child(6) {
    animation-delay: 0.4s;
  }
  @keyframes heroRise {
    from {
      opacity: 0;
      transform: translateY(18px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .hero-art {
    animation: artIn 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 0.22s;
  }
  @keyframes artIn {
    from {
      opacity: 0;
      transform: translateY(26px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .hero-art .phone {
    animation: float 5.5s ease-in-out 1.1s infinite;
  }
  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-9px);
    }
  }

  /* Phone frame */
  .phone {
    position: relative;
    width: 100%;
    max-width: 268px;
    padding: 7px;
    border-radius: 30px;
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-md);
  }
  .phone img {
    display: block;
    width: 100%;
    border-radius: 23px;
  }
  .phone.tilt {
    box-shadow:
      var(--shadow-md),
      0 40px 80px -30px color-mix(in oklab, var(--color-accent) 45%, transparent);
  }

  /* ── SHOWCASE ── */
  .showcase {
    position: relative;
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 3rem 1.25rem;
    display: grid;
    gap: 2rem;
    align-items: center;
  }
  .show-copy {
    text-align: center;
  }
  .kicker {
    display: inline-block;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--color-accent);
    margin-bottom: 0.5rem;
  }
  .showcase h2 {
    font-size: clamp(1.55rem, 4.8vw, 2.1rem);
    line-height: 1.12;
    font-weight: 700;
    letter-spacing: -0.015em;
  }
  .showcase p {
    margin: 0.85rem auto 0;
    max-width: 30rem;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--color-muted);
  }
  .show-art {
    display: flex;
    justify-content: center;
  }

  /* ── FEATURES BENTO ── */
  .features {
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 3rem 1.25rem;
  }
  .features-title {
    text-align: center;
    font-size: clamp(1.6rem, 5vw, 2.15rem);
    font-weight: 700;
    letter-spacing: -0.015em;
    margin-bottom: 2rem;
  }
  .groups {
    display: grid;
    gap: 1rem;
  }
  .group {
    border-radius: var(--radius);
    border: 1px solid var(--color-border);
    background-color: var(--color-surface);
    box-shadow: var(--shadow-sm);
    padding: 1.4rem 1.3rem;
  }
  .group:nth-child(2) {
    background-color: var(--color-elevated);
  }
  .group h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 0.9rem;
  }
  .group ul {
    display: grid;
    gap: 0.85rem;
  }
  .group li {
    display: flex;
    gap: 0.6rem;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--color-muted);
  }
  .group li strong {
    color: var(--color-text);
    font-weight: 600;
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    margin-top: 0.45rem;
    border-radius: 999px;
    background-image: var(--grad-primary);
  }

  /* ── PRIVACY ── */
  .privacy {
    max-width: 44rem;
    margin: 0 auto;
    padding: 3rem 1.5rem;
    text-align: center;
  }
  .privacy h2 {
    font-size: clamp(1.5rem, 4.6vw, 2rem);
    font-weight: 700;
    letter-spacing: -0.015em;
  }
  .privacy p {
    margin-top: 1rem;
    font-size: 1rem;
    line-height: 1.65;
    color: var(--color-muted);
  }

  /* ── FINALE ── */
  .finale {
    position: relative;
    overflow: hidden;
    text-align: center;
    padding: 3.5rem 1.5rem 4rem;
  }
  .finale h2 {
    position: relative;
    font-size: clamp(1.7rem, 5.4vw, 2.4rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: 1.5rem;
  }
  .finale .cta {
    position: relative;
  }

  .foot {
    border-top: 1px solid var(--color-border);
    padding: 1.6rem 1.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--color-muted);
  }

  /* ── Google sign-in button — brand-coloured so it is the unmissable CTA, with
     the Google G in a white chip so the mark stays recognizable. ── */
  .gbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    border-radius: var(--radius-sm);
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    border: none;
    box-shadow: var(--shadow-primary);
    font-weight: 600;
    font-size: 1.05rem;
    padding: 0.5rem 1.6rem 0.5rem 0.5rem;
    cursor: pointer;
    transition:
      transform 0.16s ease,
      box-shadow 0.16s ease,
      filter 0.16s ease;
  }
  .gbtn:hover:not(:disabled) {
    transform: translateY(-2px);
    filter: brightness(1.05);
    box-shadow: var(--shadow-md), var(--shadow-primary);
  }
  .gbtn:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }
  .gbtn:disabled {
    opacity: 0.8;
    cursor: default;
    gap: 0.55rem;
    padding: 0.8rem 1.6rem;
  }
  .gwrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background-color: #fff;
    flex: none;
  }
  .btn.big {
    padding: 0.85rem 1.75rem;
    font-size: 1rem;
  }
  .spin {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.45);
    border-top-color: #fff;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Scroll reveal (progressive enhancement: only hidden once JS arms it) ── */
  :global(.reveal-armed) {
    opacity: 0;
    transform: translateY(46px) scale(0.965);
    transition:
      opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    will-change: opacity, transform;
  }
  :global(.reveal-armed.in) {
    opacity: 1;
    transform: none;
  }

  /* ── SETUP steps ── */
  .setup {
    position: relative;
    min-height: 100dvh;
    overflow: hidden;
  }
  .setup-inner {
    position: relative;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2.5rem 1.25rem;
  }

  /* ── Desktop layout ── */
  @media (min-width: 880px) {
    .br {
      display: block;
    }
    .hero-inner {
      grid-template-columns: 1.05fr 0.95fr;
      padding: 5rem 2rem 4rem;
      gap: 3rem;
    }
    .brandrow {
      justify-content: flex-start;
    }
    .hero-copy {
      text-align: left;
    }
    .lede {
      margin-left: 0;
    }
    .hero-copy .cta {
      justify-content: flex-start;
    }
    .hero-art {
      justify-content: flex-end;
    }
    .phone.tilt {
      transform: perspective(1400px) rotateY(-12deg) rotateX(3deg);
    }
    .hero-art .phone.tilt {
      animation: floatTilt 5.5s ease-in-out 1.1s infinite;
    }
    @keyframes floatTilt {
      0%,
      100% {
        transform: perspective(1400px) rotateY(-12deg) rotateX(3deg) translateY(0);
      }
      50% {
        transform: perspective(1400px) rotateY(-12deg) rotateX(3deg) translateY(-12px);
      }
    }
    .phone {
      max-width: 300px;
    }

    .showcase {
      grid-template-columns: 1fr 1fr;
      padding: 4.5rem 2rem;
      gap: 4rem;
    }
    .show-copy {
      text-align: left;
    }
    .showcase p {
      margin-left: 0;
    }
    .show-art {
      justify-content: flex-start;
    }
    .showcase.flip .show-copy {
      order: 2;
    }
    .showcase.flip .show-art {
      order: 1;
      justify-content: flex-end;
    }

    .groups {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
