<script lang="ts">
  // Edit income boxes (spec 002-income-pockets §7.7, slice 4) — add / rename /
  // re-emoji / safe-delete. Delete is guarded: it shows how many transactions the
  // box holds and REQUIRES picking another box to move them into, so money is
  // never silently dropped. Behind an explicit "Edit" affordance (never a stray
  // tap can add or remove a box).
  import { untrack } from 'svelte';
  import type { Pocket } from '$lib/app/pockets';

  interface Props {
    open: boolean;
    pockets: Pocket[];
    /** transaction count per pocket id (paid_from + income_pocket references). */
    counts: Record<string, number>;
    onSave: (pockets: Pocket[]) => void;
    onDelete: (deleteId: string, targetId: string) => void;
    onClose: () => void;
  }
  const { open, pockets, counts, onSave, onDelete, onClose }: Props = $props();

  const EMOJI = [
    '💵',
    '🎁',
    '💰',
    '🏦',
    '👛',
    '🪙',
    '💳',
    '🏠',
    '✈️',
    '🍔',
    '🎓',
    '❤️',
    '🚗',
    '🇮🇳'
  ];
  const COLORS = ['success', 'accent', 'savings', 'danger'];

  let draft = $state<Pocket[]>([]);
  let emojiFor = $state<string | null>(null); // pocket id whose emoji picker is open
  let confirmDeleteId = $state<string | null>(null);
  let moveTarget = $state<string>('');

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      untrack(() => {
        draft = pockets.map((p) => ({ ...p }));
        emojiFor = null;
        confirmDeleteId = null;
        moveTarget = '';
      });
    }
    wasOpen = open;
  });

  function newId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      return 'pk_' + crypto.randomUUID().slice(0, 8);
    return 'pk_' + draft.length + '_' + draft.reduce((n, p) => n + p.id.length, 0);
  }
  function addBox(): void {
    const order = draft.length;
    draft = [
      ...draft,
      { id: newId(), name: 'New box', logo: '👛', color: COLORS[order % COLORS.length]!, order }
    ];
  }
  function setEmoji(id: string, emoji: string): void {
    draft = draft.map((p) => (p.id === id ? { ...p, logo: emoji } : p));
    emojiFor = null;
  }
  const deletable = $derived(draft.length > 1);
  const targetOptions = $derived(
    confirmDeleteId === null ? [] : draft.filter((p) => p.id !== confirmDeleteId)
  );

  function requestDelete(id: string): void {
    confirmDeleteId = id;
    const first = draft.find((p) => p.id !== id);
    moveTarget = first?.id ?? '';
  }
  function doDelete(): void {
    if (confirmDeleteId === null || moveTarget === '') return;
    onDelete(confirmDeleteId, moveTarget);
    draft = draft.filter((p) => p.id !== confirmDeleteId);
    confirmDeleteId = null;
  }
  function save(): void {
    // Re-number order to match the list, and drop empty names.
    onSave(draft.map((p, i) => ({ ...p, name: p.name.trim() || 'Box', order: i })));
    onClose();
  }
  function nameOf(id: string): string {
    return draft.find((p) => p.id === id)?.name ?? 'box';
  }
</script>

{#if open}
  <button type="button" class="pe-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="pe-sheet" role="dialog" aria-modal="true" aria-label="Edit income boxes">
    <div class="pe-grab"></div>
    <h2 class="pe-title">Edit income boxes</h2>

    {#if confirmDeleteId !== null}
      <div class="pe-confirm">
        <div class="pe-cic">🗑</div>
        <h3>Delete "{nameOf(confirmDeleteId)}"?</h3>
        <p>
          It holds <b>{counts[confirmDeleteId] ?? 0}</b>
          {(counts[confirmDeleteId] ?? 0) === 1 ? 'transaction' : 'transactions'}. Move them to:
        </p>
        <div class="pe-targets">
          {#each targetOptions as t (t.id)}
            <button
              type="button"
              class="pe-t"
              class:on={moveTarget === t.id}
              onclick={() => (moveTarget = t.id)}
            >
              {t.logo}
              {t.name}
            </button>
          {/each}
        </div>
        <div class="pe-cbtns">
          <button type="button" class="pe-btn cancel" onclick={() => (confirmDeleteId = null)}
            >Cancel</button
          >
          <button type="button" class="pe-btn del" onclick={doDelete} disabled={moveTarget === ''}
            >Move &amp; delete</button
          >
        </div>
      </div>
    {:else}
      {#each draft as p (p.id)}
        <div class="pe-row">
          <button
            type="button"
            class="pe-emoji"
            onclick={() => (emojiFor = emojiFor === p.id ? null : p.id)}
            aria-label="Change icon"
          >
            {p.logo}
          </button>
          <input class="pe-name" bind:value={p.name} aria-label="Box name" />
          <span class="pe-count">{counts[p.id] ?? 0}</span>
          {#if deletable}
            <button
              type="button"
              class="pe-del"
              onclick={() => requestDelete(p.id)}
              aria-label="Delete {p.name}">🗑</button
            >
          {/if}
        </div>
        {#if emojiFor === p.id}
          <div class="pe-emojis">
            {#each EMOJI as e (e)}
              <button type="button" class="pe-e" onclick={() => setEmoji(p.id, e)}>{e}</button>
            {/each}
          </div>
        {/if}
      {/each}

      <button type="button" class="pe-add" onclick={addBox}>＋ Add a box</button>
      <button type="button" class="pe-save" onclick={save}>Done</button>
    {/if}
  </div>
{/if}

<style>
  .pe-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.5);
    border: 0;
    cursor: pointer;
  }
  .pe-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 0.5rem 1.25rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: 90dvh;
    overflow-y: auto;
    animation: pe-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes pe-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .pe-grab {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.9rem;
  }
  .pe-title {
    font-size: 1.2rem;
    font-weight: 800;
    margin-bottom: 1rem;
    color: var(--color-text);
  }
  .pe-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }
  .pe-emoji {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    font-size: 20px;
    cursor: pointer;
    flex: none;
  }
  .pe-name {
    flex: 1;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
    background: var(--color-surface);
    font-family: inherit;
    min-width: 0;
  }
  .pe-name:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .pe-count {
    font-size: 0.72rem;
    color: var(--color-muted);
    font-weight: 600;
    flex: none;
    min-width: 1.5rem;
    text-align: center;
  }
  .pe-del {
    background: none;
    border: 0;
    font-size: 1rem;
    cursor: pointer;
    flex: none;
    padding: 0.3rem;
  }
  .pe-emojis {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0.5rem;
    background: var(--color-elevated);
    border-radius: 12px;
    margin-bottom: 0.6rem;
  }
  .pe-e {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 0;
    background: var(--color-surface);
    font-size: 19px;
    cursor: pointer;
  }
  .pe-add {
    width: 100%;
    border: 1.5px dashed var(--color-border);
    border-radius: 14px;
    padding: 0.8rem;
    text-align: center;
    color: var(--color-accent);
    font-weight: 700;
    background: transparent;
    cursor: pointer;
    margin: 0.4rem 0 0.8rem;
    font-family: inherit;
  }
  .pe-save {
    width: 100%;
    padding: 0.9rem;
    border-radius: 15px;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 800;
    font-size: 1rem;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .pe-confirm {
    text-align: center;
    padding: 0.5rem 0.3rem 0.6rem;
  }
  .pe-cic {
    width: 54px;
    height: 54px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    font-size: 26px;
    background: color-mix(in oklab, var(--color-danger) 12%, transparent);
    margin: 0 auto 0.8rem;
  }
  .pe-confirm h3 {
    font-size: 1.1rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
  }
  .pe-confirm p {
    font-size: 0.88rem;
    color: var(--color-muted);
    margin-bottom: 1rem;
  }
  .pe-confirm p b {
    color: var(--color-text);
  }
  .pe-targets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    margin-bottom: 1.2rem;
  }
  .pe-t {
    padding: 0.55rem 0.9rem;
    border-radius: 13px;
    border: 1px solid var(--color-border);
    background: var(--color-elevated);
    font-weight: 700;
    font-size: 0.88rem;
    color: var(--color-text);
    cursor: pointer;
    font-family: inherit;
  }
  .pe-t.on {
    background: color-mix(in oklab, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .pe-cbtns {
    display: flex;
    gap: 0.7rem;
  }
  .pe-btn {
    flex: 1;
    padding: 0.8rem;
    border-radius: 14px;
    font-weight: 700;
    font-size: 0.96rem;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .pe-btn.cancel {
    background: var(--color-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }
  .pe-btn.del {
    background: var(--color-danger);
    color: #fff;
  }
  .pe-btn.del:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
