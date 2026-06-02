<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { dev } from '$app/environment';
  import { loadState } from '$lib/db/store';
  import { initSyncIfReady } from '$lib/sync/sync-controller';
  import { initTheme } from '$lib/app/theme.svelte';
  import { applyPrefs } from '$lib/app/prefs';
  import { installKeyboardInsetTracker } from '$lib/app/keyboard-inset';
  import { page } from '$app/stores';
  import Nav from '$components/Nav.svelte';

  let { children } = $props();

  // Apply the saved display currency (USD/INR) before any child renders money.
  if (typeof window !== 'undefined') applyPrefs();

  let checking = $state(true);

  // Onboarding is a full-screen setup flow — no rail / tab-bar chrome there.
  const onOnboarding = $derived($page.url.pathname.startsWith('/onboarding'));

  function hasOnboarded(): boolean {
    return typeof localStorage !== 'undefined' && localStorage.getItem('mtrb.onboarded') !== null;
  }

  onMount(async () => {
    initTheme(); // apply persisted light/dark choice ASAP
    // Bottom-sheet pickers (CategoryPicker / AccountPicker) need to lift
    // above the soft keyboard.  Installs a global visualViewport listener
    // that drives --kb-inset-bottom on <html>.  Safe to call multiple times.
    installKeyboardInsetTracker();
    const state = await loadState();

    // First-run gate (US-P1-A): a brand-new user — has never finished onboarding
    // AND has no imported data — is sent through onboarding (Google sign-in /
    // currency) instead of landing straight on the statements page. We stay put
    // once on /onboarding (no redirect loop), and don't redirect a returning user.
    const isFreshUser = !hasOnboarded() && state.imports.length === 0;
    if (
      isFreshUser &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/onboarding')
    ) {
      await goto('/onboarding');
    } else if (
      state.imports.length > 0 &&
      typeof window !== 'undefined' &&
      window.location.pathname === '/'
    ) {
      // Returning user with data: Home ("Today") is the default landing (Rocket
      // Money model). The import/Statements page stays reachable via the nav.
      await goto('/today');
    }

    checking = false;
    initSyncIfReady(); // activate Drive sync if a client ID is configured + signed in

    // Register the offline app-shell service worker (SC-006 / FR-054). SvelteKit's
    // auto-register is off (svelte.config serviceWorker.register=false) so we do it
    // here, manually + base-path-aware. Production only — a SW in dev fights HMR.
    // The SW (src/service-worker.ts) precaches build+files and serves them cache-first
    // when offline; it never caches cross-origin (Google auth/sync stays live).
    if (!dev && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      // Auto-update: when a new deployed version takes control, reload once so
      // the latest code reaches the user — including an installed (home-screen)
      // PWA, which otherwise keeps serving the cached old version. Guarded to the
      // already-controlled case so a first install doesn't trigger a reload loop.
      if (navigator.serviceWorker.controller) {
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });
      }
      try {
        await navigator.serviceWorker.register(`${base}/service-worker.js`, { type: 'module' });
      } catch {
        // A registration failure must never block the app — offline is an enhancement.
      }
    }
  });
</script>

<div class="min-h-dvh">
  {#if checking}
    <div class="p-6 text-sm" style:color="var(--color-muted)">Loading…</div>
  {:else if onOnboarding}
    {@render children?.()}
  {:else}
    <Nav />
    <div class="md:pl-20">
      <div class="pb-24 md:pb-2">
        {@render children?.()}
      </div>
    </div>
  {/if}
</div>
