<script lang="ts">
  import { page } from '$app/stores';
  import BrandMark from '$components/BrandMark.svelte';

  const links: Array<{ href: string; label: string }> = [
    { href: '/today', label: 'Home' },
    { href: '/', label: 'Statements' },
    { href: '/transactions', label: 'Transactions' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/recurring', label: 'Recurring' },
    { href: '/trends', label: 'Trends' },
    { href: '/categories', label: 'Categories' },
    { href: '/budget', label: 'Budget' },
    { href: '/goals', label: 'Goals' },
    { href: '/settings', label: 'Settings' }
  ];

  function isActive(href: string, currentPath: string): boolean {
    if (href === '/') return currentPath === '/';
    return currentPath === href || currentPath.startsWith(href + '/');
  }
</script>

<nav class="mb-7 flex items-center gap-3">
  <a href="/" class="flex-none" aria-label="trackcents home">
    <BrandMark size={30} />
  </a>

  <!-- On a phone the 10 links can't fit, so the pill scrolls horizontally
       (scrollbar hidden) rather than wrapping or pushing the page sideways.
       On desktop it right-aligns and fits without scrolling. -->
  <div class="no-scrollbar -my-1 min-w-0 flex-1 overflow-x-auto py-1 md:flex md:justify-end">
    <div
      class="flex w-max items-center gap-0.5 rounded-full border p-1"
      style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow-sm);"
    >
      {#each links as link (link.href)}
        {@const active = isActive(link.href, $page.url.pathname)}
        <a
          href={link.href}
          class="nav-link flex-none rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors"
          class:active
          style:color={active ? 'var(--color-accent-fg)' : 'var(--color-muted)'}
          style:background-image={active ? 'var(--grad-primary)' : 'none'}
          aria-current={active ? 'page' : undefined}
        >
          {link.label}
        </a>
      {/each}
    </div>
  </div>
</nav>

<style>
  .nav-link:not(.active):hover {
    color: var(--color-text);
    background-color: var(--color-elevated);
  }
</style>
