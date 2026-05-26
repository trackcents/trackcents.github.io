<script lang="ts">
  import { estimatePassphraseStrength } from '$lib/crypto/passphrase-strength';

  let { onComplete }: { onComplete: (passphrase: string) => void } = $props();

  let passphrase = $state('');
  let confirm = $state('');
  let reveal = $state(false);

  const strength = $derived(estimatePassphraseStrength(passphrase));
  const matches = $derived(confirm.length > 0 && passphrase === confirm);
  const canContinue = $derived(strength.meetsMinimum && matches);

  // 0..4 → red, red, amber, green, green
  const BAR_COLORS = ['#dc2626', '#dc2626', '#d97706', '#16a34a', '#16a34a'];

  function submit() {
    if (canContinue) onComplete(passphrase);
  }
</script>

<div class="mx-auto flex max-w-md flex-col gap-4">
  <h2 class="text-lg font-semibold">Set your encryption passphrase</h2>

  <p
    class="rounded-md p-3 text-sm"
    style:background-color="color-mix(in oklab, #d97706 14%, transparent)"
  >
    ⚠️ Your data is encrypted with this passphrase. If you forget it,
    <strong>no one — not even the developer — can recover it.</strong> Pick something strong you won't
    lose.
  </p>

  <label class="flex flex-col gap-1 text-sm">
    Passphrase
    <input
      type={reveal ? 'text' : 'password'}
      bind:value={passphrase}
      autocomplete="new-password"
      class="rounded-md border px-3 py-2"
      style:border-color="var(--color-border)"
    />
  </label>

  <div>
    <div
      class="h-1.5 w-full overflow-hidden rounded-full"
      style:background-color="var(--color-border)"
    >
      <div
        class="h-full transition-all"
        style:width={`${(strength.score + 1) * 20}%`}
        style:background-color={BAR_COLORS[strength.score] ?? '#dc2626'}
      ></div>
    </div>
    <span class="text-xs" style:color="var(--color-muted)">Strength: {strength.label}</span>
    {#if strength.suggestions.length > 0}
      <ul class="mt-1 list-disc pl-5 text-xs" style:color="var(--color-muted)">
        {#each strength.suggestions as s (s)}
          <li>{s}</li>
        {/each}
      </ul>
    {/if}
  </div>

  <label class="flex flex-col gap-1 text-sm">
    Confirm passphrase
    <input
      type={reveal ? 'text' : 'password'}
      bind:value={confirm}
      autocomplete="new-password"
      class="rounded-md border px-3 py-2"
      style:border-color="var(--color-border)"
    />
  </label>
  {#if confirm.length > 0 && !matches}
    <span class="text-xs" style:color="#dc2626">Passphrases don't match.</span>
  {/if}

  <div class="flex items-center justify-between">
    <button type="button" class="text-xs underline" onclick={() => (reveal = !reveal)}>
      {reveal ? 'Hide' : 'Show'} passphrases
    </button>
    <button
      type="button"
      onclick={submit}
      disabled={!canContinue}
      class="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-40"
      style:background-color="var(--color-accent)"
      style:color="white"
    >
      Continue
    </button>
  </div>
</div>
