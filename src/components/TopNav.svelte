<script lang="ts">
  import { page } from '$app/stores';

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

<nav class="mb-7 flex items-center justify-between gap-4">
  <a href="/" class="flex items-center gap-2" aria-label="Money Tracker home">
    <span
      class="flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold"
      style="background-image: var(--grad-primary); color: var(--color-accent-fg); box-shadow: var(--shadow-primary);"
    >
      ₥
    </span>
    <span class="text-[15px] font-semibold tracking-tight">Money Tracker</span>
  </a>

  <div
    class="flex items-center gap-0.5 rounded-full border p-1"
    style="border-color: var(--color-border); background-color: var(--color-surface); box-shadow: var(--shadow-sm);"
  >
    {#each links as link (link.href)}
      {@const active = isActive(link.href, $page.url.pathname)}
      <a
        href={link.href}
        class="rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors"
        style:color={active ? 'var(--color-accent-fg)' : 'var(--color-muted)'}
        style:background-image={active ? 'var(--grad-primary)' : 'none'}
        aria-current={active ? 'page' : undefined}
      >
        {link.label}
      </a>
    {/each}
  </div>
</nav>
