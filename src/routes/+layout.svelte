<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { dev } from '$app/environment';
  import { loadState, isStoreLocked } from '$lib/db/store';
  import { attemptUnlock, hasStoredSalt } from '$lib/app/unlock';
  import { initSyncIfReady } from '$lib/sync/sync-controller';
  import { initTheme } from '$lib/app/theme.svelte';
  import { page } from '$app/stores';
  import PassphraseUnlock from '$components/PassphraseUnlock.svelte';
  import Nav from '$components/Nav.svelte';

  let { children } = $props();
  let locked = $state(false);
  let checking = $state(true);

  // Onboarding is a full-screen setup flow — no rail / tab-bar chrome there.
  const onOnboarding = $derived($page.url.pathname.startsWith('/onboarding'));

  onMount(async () => {
    initTheme(); // apply persisted light/dark choice ASAP
    // Probe storage; loadState sets the locked flag if data is encrypted and no key is loaded.
    const state = await loadState();
    locked = isStoreLocked();

    // First-run gate (US-P1-A): a brand-new user — never set a passphrase (no
    // stored salt) AND no imported data — is sent through onboarding (Google
    // sign-in + passphrase) instead of landing straight on the statements page.
    // Without this the onboarding/sign-in flow was unreachable. We DON'T redirect
    // an existing local-only user who already has data, and we stay put once on
    // /onboarding (no redirect loop).
    const isFreshUser = !locked && !hasStoredSalt() && state.imports.length === 0;
    if (
      isFreshUser &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/onboarding')
    ) {
      await goto('/onboarding');
    } else if (
      !locked &&
      state.imports.length > 0 &&
      typeof window !== 'undefined' &&
      window.location.pathname === '/'
    ) {
      // Returning user with data: Home ("Today") is the default landing (Rocket
      // Money model). The import/Statements page stays reachable via the nav.
      await goto('/today');
    }

    checking = false;
    if (!locked) initSyncIfReady();

    // Register the offline app-shell service worker (SC-006 / FR-054). SvelteKit's
    // auto-register is off (svelte.config serviceWorker.register=false) so we do it
    // here, manually + base-path-aware. Production only — a SW in dev fights HMR.
    // The SW (src/service-worker.ts) precaches build+files and serves them cache-first
    // when offline; it never caches cross-origin (Google auth/sync stays live).
    if (!dev && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register(`${base}/service-worker.js`, { type: 'module' });
      } catch {
        // A registration failure must never block the app — offline is an enhancement.
      }
    }
  });

  async function handleUnlock(passphrase: string): Promise<boolean> {
    const ok = await attemptUnlock(passphrase);
    if (ok) {
      locked = false;
      initSyncIfReady(); // key is now in memory — wire up sync if a Drive client is configured
    }
    return ok;
  }
</script>

<div class="min-h-dvh">
  {#if checking}
    <div class="p-6 text-sm" style:color="var(--color-muted)">Loading…</div>
  {:else if locked}
    <PassphraseUnlock onUnlock={handleUnlock} />
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
