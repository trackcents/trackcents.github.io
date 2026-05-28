<script lang="ts">
  // Responsive primary navigation (the app shell chrome).
  //   • Desktop (≥768px): a fixed left icon rail with all destinations.
  //   • Phone (<768px): a fixed bottom tab bar (4 primary tabs + "More"),
  //     where "More" opens a bottom sheet with the rest.
  // Rendered once by +layout.svelte; pages no longer carry their own nav.
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import BrandMark from '$components/BrandMark.svelte';
  import SyncStatusIndicator from '$components/SyncStatusIndicator.svelte';
  import ThemeToggle from '$components/ThemeToggle.svelte';

  interface Item {
    href: string;
    label: string;
    icon: string;
  }

  const items: Item[] = [
    { href: '/today', label: 'Home', icon: 'home' },
    { href: '/transactions', label: 'Transactions', icon: 'list' },
    { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
    { href: '/recurring', label: 'Recurring', icon: 'repeat' },
    { href: '/trends', label: 'Trends', icon: 'trends' },
    { href: '/', label: 'Statements', icon: 'upload' },
    { href: '/categories', label: 'Categories', icon: 'tag' },
    { href: '/budget', label: 'Budget', icon: 'target' },
    { href: '/goals', label: 'Goals', icon: 'flag' },
    { href: '/settings', label: 'Settings', icon: 'gear' }
  ];

  // Bottom-bar layout: Home · Transactions · [+] · Statements · More.
  // The "+" is the universal entry point for adding a transaction (locked
  // design v1).  Recurring moves into More because it's glance-only.
  const primaryHrefsLeft = ['/today', '/transactions'];
  const primaryHrefsRight = ['/'];
  const byHref = new Map(items.map((i) => [i.href, i]));
  const bottomLeft = primaryHrefsLeft.map((h) => byHref.get(h)).filter((i) => i !== undefined);
  const bottomRight = primaryHrefsRight.map((h) => byHref.get(h)).filter((i) => i !== undefined);
  const moreItems = items.filter(
    (i) => !primaryHrefsLeft.includes(i.href) && !primaryHrefsRight.includes(i.href)
  );

  let moreOpen = $state(false);

  /** "+" tab handler — the intermediate AddSheet (Expense/Income/Transfer
   *  chooser) was killed in Batch A per Hemanth: "remove that layer
   *  directly open it and I will select which I want to add in that
   *  menu".  QuickAddSheet's segmented control at the top is enough. */
  async function openQuickAdd(): Promise<void> {
    await goto(`${base}/today?add=expense`);
  }

  function isActive(href: string, path: string): boolean {
    if (href === '/') return path === '/';
    return path === href || path.startsWith(href + '/');
  }

  // Close the "More" sheet whenever the route changes.
  $effect(() => {
    if ($page.url.pathname) moreOpen = false;
  });
</script>

{#snippet navIcon(name: string)}
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if name === 'home'}
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    {:else if name === 'list'}
      <path d="M8 6h12" /><path d="M8 12h12" /><path d="M8 18h12" /><circle cx="3.6" cy="6" r="1" />
      <circle cx="3.6" cy="12" r="1" /><circle cx="3.6" cy="18" r="1" />
    {:else if name === 'grid'}
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1.5"
      /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1.5"
      />
    {:else if name === 'repeat'}
      <path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path
        d="M7 22l-3-3 3-3"
      /><path d="M20 13v2a4 4 0 0 1-4 4H4" />
    {:else if name === 'trends'}
      <path d="M4 4v16h16" /><path d="M7 14l4-4 3 3 5-6" />
    {:else if name === 'upload'}
      <path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M5 20h14" />
    {:else if name === 'tag'}
      <path d="M3 3h8l9 9-8 8-9-9V3z" /><circle cx="7.5" cy="7.5" r="1.3" />
    {:else if name === 'target'}
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle
        cx="12"
        cy="12"
        r="1"
      />
    {:else if name === 'flag'}
      <path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" />
    {:else if name === 'gear'}
      <circle cx="12" cy="12" r="3" /><path
        d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z"
      />
    {:else if name === 'menu'}
      <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
    {/if}
  </svg>
{/snippet}

<!-- Desktop: left icon rail -->
<nav class="nav-rail" aria-label="Primary">
  <a href="/today" class="mb-2" aria-label="trackcents home">
    <BrandMark size={34} wordmark={false} />
  </a>
  {#each items as it (it.href)}
    {@const active = isActive(it.href, $page.url.pathname)}
    <a href={it.href} class="rail-item" class:active aria-current={active ? 'page' : undefined}>
      {@render navIcon(it.icon)}
      <span class="rail-label">{it.label}</span>
    </a>
  {/each}
  <div class="mt-auto flex flex-col items-center gap-2 pt-2">
    <SyncStatusIndicator />
    <ThemeToggle />
  </div>
</nav>

<!-- Phone: bottom tab bar (Home · Trans · [+] · Statements · More) -->
<nav class="nav-bar" aria-label="Primary">
  {#each bottomLeft as it (it.href)}
    {@const active = isActive(it.href, $page.url.pathname)}
    <a href={it.href} class="tab-item" class:active aria-current={active ? 'page' : undefined}>
      {@render navIcon(it.icon)}
      <span>{it.label}</span>
    </a>
  {/each}

  <!-- Center "+" — the universal Add affordance.  Larger, accent-coloured,
       slightly raised so it reads as the visual anchor of the tab bar
       (Instagram / Cash App / Robinhood pattern). -->
  <button type="button" class="add-tab" onclick={openQuickAdd} aria-label="Add a transaction">
    <span class="add-disc">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </svg>
    </span>
  </button>

  {#each bottomRight as it (it.href)}
    {@const active = isActive(it.href, $page.url.pathname)}
    <a href={it.href} class="tab-item" class:active aria-current={active ? 'page' : undefined}>
      {@render navIcon(it.icon)}
      <span>{it.label}</span>
    </a>
  {/each}
  <button type="button" class="tab-item" class:active={moreOpen} onclick={() => (moreOpen = true)}>
    {@render navIcon('menu')}
    <span>More</span>
  </button>
</nav>

<!-- Phone: "More" bottom sheet -->
{#if moreOpen}
  <button
    type="button"
    class="more-backdrop"
    aria-label="Close menu"
    onclick={() => (moreOpen = false)}
  ></button>
  <div class="more-sheet" role="dialog" aria-modal="true" aria-label="More menu">
    <div class="mb-4 flex items-center justify-between">
      <BrandMark size={28} />
      <div class="flex items-center gap-2">
        <SyncStatusIndicator />
        <ThemeToggle />
      </div>
    </div>
    <div class="grid grid-cols-3 gap-2">
      {#each moreItems as it (it.href)}
        <a href={it.href} class="sheet-item" class:active={isActive(it.href, $page.url.pathname)}>
          {@render navIcon(it.icon)}
          <span>{it.label}</span>
        </a>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* ── Desktop rail (≥768px) ── */
  .nav-rail {
    display: none;
  }
  @media (min-width: 768px) {
    .nav-rail {
      position: fixed;
      inset-block: 0;
      left: 0;
      width: 5rem;
      z-index: 30;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      overflow-y: auto;
      padding: 0.85rem 0.4rem;
      border-right: 1px solid var(--color-border);
      background: var(--color-surface);
    }
  }
  .rail-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    width: 100%;
    padding: 0.5rem 0.2rem;
    border-radius: 12px;
    color: var(--color-muted);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.15;
    text-align: center;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .rail-item:hover {
    color: var(--color-text);
    background: var(--color-elevated);
  }
  .rail-item.active {
    color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  /* ── Phone bottom bar (<768px) ── */
  .nav-bar {
    display: none;
  }
  @media (max-width: 767.98px) {
    .nav-bar {
      position: fixed;
      inset-inline: 0;
      bottom: 0;
      z-index: 30;
      display: flex;
      align-items: stretch;
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
      padding-bottom: env(safe-area-inset-bottom);
      box-shadow: 0 -2px 12px rgba(20, 30, 40, 0.05);
    }
  }
  .tab-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    padding: 0.5rem 0.25rem 0.6rem;
    color: var(--color-muted);
    font-size: 10px;
    font-weight: 500;
    background: none;
    cursor: pointer;
  }
  .tab-item.active {
    color: var(--color-accent);
  }

  /* ── Center "+" Add tab ── */
  .add-tab {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0 0.4rem;
    margin: 0 0.25rem;
  }
  .add-disc {
    width: 54px;
    height: 54px;
    border-radius: 18px;
    background-image: var(
      --grad-primary,
      linear-gradient(
        135deg,
        var(--color-accent),
        color-mix(in oklab, var(--color-accent) 80%, #d99474)
      )
    );
    background-color: var(--color-accent);
    color: var(--color-accent-fg, white);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 6px 16px color-mix(in oklab, var(--color-accent) 38%, transparent),
      0 1px 3px rgba(0, 0, 0, 0.12);
    margin-top: -16px;
    transition:
      transform 0.16s ease,
      box-shadow 0.16s ease;
  }
  .add-tab:hover .add-disc {
    transform: translateY(-1px);
    box-shadow:
      0 8px 20px color-mix(in oklab, var(--color-accent) 45%, transparent),
      0 1px 4px rgba(0, 0, 0, 0.14);
  }
  .add-tab:active .add-disc {
    transform: scale(0.96);
  }

  /* ── "More" sheet ── */
  .more-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: 0;
    background: rgba(15, 20, 28, 0.4);
    cursor: pointer;
  }
  .more-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 50;
    background: var(--color-surface);
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    padding: 1.1rem 1.1rem calc(1.1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
  }
  .sheet-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.9rem 0.4rem;
    border-radius: 14px;
    background: var(--color-elevated);
    color: var(--color-text);
    font-size: 11px;
    font-weight: 500;
    text-align: center;
  }
  .sheet-item.active {
    color: var(--color-accent);
  }
</style>
