<script lang="ts">
  import { page } from '$app/stores';
  import BrandMark from '$components/BrandMark.svelte';
</script>

<svelte:head><title>{$page.status} · trackcents</title></svelte:head>

<main class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
  <div class="rise mb-5"><BrandMark size={40} wordmark={false} /></div>
  <p class="num text-5xl font-semibold tracking-tight">{$page.status}</p>
  <h1 class="mt-2 text-lg font-semibold">
    {$page.status === 404 ? "We couldn't find that page" : 'Something went wrong'}
  </h1>
  <p class="mt-1 text-sm" style:color="var(--color-muted)">
    {$page.error?.message ?? "The page you were looking for isn't here."}
  </p>
  <a href="/today" class="btn btn-primary mt-6">Back to home</a>
</main>
