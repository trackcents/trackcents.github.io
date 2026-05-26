<script lang="ts">
  let { onUnlock }: { onUnlock: (passphrase: string) => Promise<boolean> } = $props();

  let passphrase = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit() {
    if (passphrase.length === 0 || busy) return;
    busy = true;
    error = '';
    const ok = await onUnlock(passphrase);
    busy = false;
    if (!ok) {
      error = 'Wrong passphrase. Please try again.';
      passphrase = '';
    }
  }
</script>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
  <h1 class="text-xl font-bold">Unlock your data</h1>
  <p class="text-sm" style:color="var(--color-muted)">
    Your data on this device is encrypted. Enter your passphrase to unlock it.
  </p>
  <input
    type="password"
    bind:value={passphrase}
    autocomplete="current-password"
    onkeydown={(e) => {
      if (e.key === 'Enter') submit();
    }}
    class="rounded-md border px-3 py-2"
    style:border-color="var(--color-border)"
  />
  {#if error}
    <p class="text-sm" style:color="#dc2626">{error}</p>
  {/if}
  <button
    type="button"
    onclick={submit}
    disabled={busy || passphrase.length === 0}
    class="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
    style:background-color="var(--color-accent)"
    style:color="white"
  >
    {busy ? 'Unlocking…' : 'Unlock'}
  </button>
</main>
