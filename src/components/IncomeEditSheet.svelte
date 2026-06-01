<script lang="ts">
  // Edit one income deposit (spec 002-income-pockets §3) — the redesigned sheet
  // that replaced the cramped old popup. Clean, roomy actions:
  //   Name · What kind (+ add your own) · Move to another box · ✂️ Split ·
  //   Save · Remove (with confirm).
  // "What kind" is purely a label (never changes the math). "Move to another box"
  // sets income_pocket. "Split" reuses the income-cap engine. "Remove" excludes
  // the deposit from income. All amounts bigint cents.
  import { untrack } from 'svelte';
  import { formatMoney, parseMoney } from '$lib/util/money';
  import { centsToDecimal } from '$lib/app/export-csv';
  import type { IncomeRow } from '$lib/app/categorization-glue';
  import type { TransactionAnnotation } from '$lib/app/categorization';
  import type { FlowIntent } from '$lib/app/flow-intent';
  import type { Pocket } from '$lib/app/pockets';

  interface Props {
    open: boolean;
    row: IncomeRow | null;
    annotation: TransactionAnnotation | undefined;
    pockets: Pocket[];
    onUpdate: (key: string, patch: Partial<TransactionAnnotation>) => void;
    onRemove: (key: string) => void;
    onClose: () => void;
  }
  const { open, row, annotation, pockets, onUpdate, onRemove, onClose }: Props = $props();

  const PRESET_KINDS = ['From a person', 'Bonus', 'Gift', 'Refund', 'Interest'];
  function defaultKind(intent: FlowIntent): string {
    if (intent === 'salary') return 'Paycheck';
    if (intent === 'interest_earned') return 'Interest';
    if (intent === 'cash_in') return 'Cash / check';
    return 'From a person';
  }

  let name = $state('');
  let kind = $state('');
  let addingKind = $state(false);
  let customKind = $state('');
  let splitOpen = $state(false);
  let capStr = $state('');
  let capDest = $state<'investment_out' | 'transfer_self'>('investment_out');
  let confirmRemove = $state(false);

  let wasOpen = false;
  $effect(() => {
    const isOpen = open && row !== null;
    if (isOpen && !wasOpen) {
      untrack(() => {
        const r = row as IncomeRow;
        name = r.description;
        kind = annotation?.income_kind ?? defaultKind(r.flow_intent);
        addingKind = false;
        customKind = '';
        splitOpen = false;
        capStr = centsToDecimal(r.income_minor);
        capDest = 'investment_out';
        confirmRemove = false;
      });
    }
    wasOpen = isOpen;
  });

  const ordered = $derived([...pockets].sort((a, b) => a.order - b.order));
  const otherPockets = $derived(ordered.filter((p) => p.id !== (row?.pocketId ?? '')));

  function save(): void {
    if (row === null) return;
    const patch: Partial<TransactionAnnotation> = {};
    patch.custom_name = name.trim();
    patch.income_kind = kind.trim();
    onUpdate(row.key, patch);
    onClose();
  }
  function moveTo(pocketId: string): void {
    if (row === null) return;
    onUpdate(row.key, {
      custom_name: name.trim(),
      income_kind: kind.trim(),
      income_pocket: pocketId
    });
    onClose();
  }
  function applySplit(): void {
    if (row === null) return;
    let cap: bigint;
    try {
      cap = parseMoney(capStr);
    } catch {
      return;
    }
    const full = row.amount_minor;
    if (cap >= full) {
      // Nothing carved out — clear any split.
      onUpdate(row.key, { split: [] });
      onClose();
      return;
    }
    const leftover = full - cap;
    onUpdate(row.key, {
      split: [
        { category_id: null, amount_minor: cap },
        { category_id: null, amount_minor: leftover, flow_intent: capDest }
      ]
    });
    onClose();
  }
  function doRemove(): void {
    if (row === null) return;
    onRemove(row.key);
    onClose();
  }

  function prettyDate(iso: string): string {
    const [, m, d] = iso.split('-');
    const months = [
      '',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return `${months[Number(m)]} ${Number(d)}`;
  }
</script>

{#if open && row !== null}
  <button type="button" class="ie-backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="ie-sheet" role="dialog" aria-modal="true" aria-label="Edit {row.description}">
    <div class="ie-grab"></div>

    {#if confirmRemove}
      <div class="ie-confirm">
        <div class="ie-cic">🗑</div>
        <h2>Remove this income?</h2>
        <p>
          <b>{name || row.description} · {formatMoney(row.amount_minor)}</b><br />
          This takes {formatMoney(row.income_minor)} out of your income total. You can add it back later
          from <b>＋ Add income</b>.
        </p>
        <div class="ie-cbtns">
          <button type="button" class="ie-btn cancel" onclick={() => (confirmRemove = false)}
            >Cancel</button
          >
          <button type="button" class="ie-btn del" onclick={doRemove}>Remove</button>
        </div>
      </div>
    {:else}
      <div class="ie-top">
        <div class="ie-chip">{row.flow_intent === 'salary' ? '💵' : '🧑'}</div>
        <div>
          <h2>{row.description}</h2>
          <div class="ie-sub">
            {formatMoney(row.amount_minor)} · received {prettyDate(row.posted_date)}
          </div>
        </div>
      </div>

      <div class="ie-field">
        <span class="ie-lbl">Name</span>
        <input class="ie-in" bind:value={name} />
      </div>

      <div class="ie-field">
        <span class="ie-lbl">What kind of income?</span>
        <div class="ie-chips">
          {#each PRESET_KINDS as k (k)}
            <button type="button" class="ie-c" class:on={kind === k} onclick={() => (kind = k)}
              >{k}</button
            >
          {/each}
          {#if !PRESET_KINDS.includes(kind) && kind !== ''}
            <button type="button" class="ie-c on">{kind}</button>
          {/if}
          {#if addingKind}
            <input
              class="ie-kindin"
              bind:value={customKind}
              placeholder="Your label"
              onkeydown={(e) => {
                if (e.key === 'Enter' && customKind.trim() !== '') {
                  kind = customKind.trim();
                  addingKind = false;
                }
              }}
            />
          {:else}
            <button type="button" class="ie-c add" onclick={() => (addingKind = true)}
              >＋ Add</button
            >
          {/if}
        </div>
      </div>

      {#if otherPockets.length > 0}
        <div class="ie-field">
          <span class="ie-lbl">Move to another box</span>
          <div class="ie-boxes">
            {#each otherPockets as p (p.id)}
              <button type="button" class="ie-bx" onclick={() => moveTo(p.id)}
                >{p.logo} {p.name}</button
              >
            {/each}
          </div>
        </div>
      {/if}

      <div class="ie-field">
        <span class="ie-lbl">Or</span>
        <button type="button" class="ie-splitbtn" onclick={() => (splitOpen = !splitOpen)}>
          <span style="font-size:18px">✂️</span> Split — count only part as income
          <span class="ie-ar">{splitOpen ? '▾' : '›'}</span>
        </button>
        {#if splitOpen}
          <div class="ie-split">
            <div class="ie-srow">
              <span>Counts as income</span>
              <input
                class="ie-samt"
                inputmode="decimal"
                bind:value={capStr}
                aria-label="Amount that counts as income"
              />
            </div>
            <div class="ie-dest">
              <button
                type="button"
                class="ie-d"
                class:on={capDest === 'investment_out'}
                onclick={() => (capDest = 'investment_out')}>💰 Set aside</button
              >
              <button
                type="button"
                class="ie-d"
                class:on={capDest === 'transfer_self'}
                onclick={() => (capDest = 'transfer_self')}>🚫 Exclude rest</button
              >
            </div>
            <button type="button" class="ie-apply" onclick={applySplit}>Apply split</button>
          </div>
        {/if}
      </div>

      <button type="button" class="ie-save" onclick={save}>Save</button>
      <button type="button" class="ie-remove" onclick={() => (confirmRemove = true)}
        >🗑 Remove from income</button
      >
    {/if}
  </div>
{/if}

<style>
  .ie-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(15, 20, 28, 0.5);
    border: 0;
    cursor: pointer;
  }
  .ie-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 110;
    background: var(--color-surface);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 0.5rem 1.25rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: calc(90dvh - var(--kb-inset-bottom, 0px));
    overflow-y: auto;
    animation: ie-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes ie-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .ie-grab {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.9rem;
  }
  .ie-top {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 1rem;
  }
  .ie-chip {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    font-size: 23px;
    background: color-mix(in oklab, var(--color-success) 14%, transparent);
    flex: none;
  }
  .ie-top h2 {
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--color-text);
  }
  .ie-sub {
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .ie-field {
    margin-bottom: 0.9rem;
  }
  .ie-lbl {
    display: block;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin-bottom: 0.4rem;
  }
  .ie-in {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 13px;
    padding: 0.75rem 0.9rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-surface);
    font-family: inherit;
  }
  .ie-in:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .ie-chips,
  .ie-boxes {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .ie-c,
  .ie-bx {
    padding: 0.5rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--color-muted);
    background: var(--color-surface);
    cursor: pointer;
    font-family: inherit;
  }
  .ie-c.on {
    background: color-mix(in oklab, var(--color-success) 14%, transparent);
    border-color: var(--color-success);
    color: var(--color-success);
  }
  .ie-c.add {
    color: var(--color-accent);
    border-style: dashed;
    border-color: var(--color-accent);
  }
  .ie-bx {
    border-radius: 13px;
    color: var(--color-text);
    background: var(--color-elevated);
    font-weight: 700;
  }
  .ie-kindin {
    border: 1px solid var(--color-accent);
    border-radius: 999px;
    padding: 0.45rem 0.8rem;
    font-size: 0.83rem;
    font-family: inherit;
    width: 8rem;
  }
  .ie-splitbtn {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 0.75rem 0.9rem;
    font-weight: 700;
    font-size: 0.92rem;
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    font-family: inherit;
  }
  .ie-ar {
    margin-left: auto;
    color: var(--color-muted);
  }
  .ie-split {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 0.8rem;
    margin-top: 0.5rem;
  }
  .ie-srow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.88rem;
    font-weight: 600;
    margin-bottom: 0.6rem;
  }
  .ie-samt {
    width: 7rem;
    border: 1px solid var(--color-border);
    border-radius: 11px;
    padding: 0.55rem 0.7rem;
    font-weight: 800;
    font-size: 1rem;
    text-align: right;
    font-family: inherit;
  }
  .ie-dest {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .ie-d {
    flex: 1;
    padding: 0.55rem;
    border-radius: 11px;
    border: 1px solid var(--color-border);
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--color-muted);
    background: var(--color-surface);
    cursor: pointer;
    font-family: inherit;
  }
  .ie-d.on {
    background: color-mix(in oklab, var(--color-accent) 12%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .ie-apply {
    width: 100%;
    padding: 0.65rem;
    border-radius: 12px;
    border: 0;
    background: color-mix(in oklab, var(--color-accent) 16%, transparent);
    color: var(--color-accent);
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .ie-save {
    width: 100%;
    padding: 0.9rem;
    border-radius: 15px;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 800;
    font-size: 1rem;
    border: 0;
    cursor: pointer;
    margin-top: 0.5rem;
    font-family: inherit;
  }
  .ie-remove {
    width: 100%;
    text-align: center;
    color: var(--color-danger);
    font-weight: 600;
    font-size: 0.88rem;
    margin-top: 0.8rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ie-confirm {
    text-align: center;
    padding: 0.5rem 0.5rem 1rem;
  }
  .ie-cic {
    width: 56px;
    height: 56px;
    border-radius: 16px;
    display: grid;
    place-items: center;
    font-size: 28px;
    background: color-mix(in oklab, var(--color-danger) 12%, transparent);
    margin: 0 auto 0.9rem;
  }
  .ie-confirm h2 {
    font-size: 1.2rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
  }
  .ie-confirm p {
    font-size: 0.9rem;
    color: var(--color-muted);
    line-height: 1.5;
    margin-bottom: 1.3rem;
  }
  .ie-confirm p b {
    color: var(--color-text);
  }
  .ie-cbtns {
    display: flex;
    gap: 0.7rem;
  }
  .ie-btn {
    flex: 1;
    padding: 0.8rem;
    border-radius: 14px;
    font-weight: 700;
    font-size: 0.98rem;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ie-btn.cancel {
    background: var(--color-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }
  .ie-btn.del {
    background: var(--color-danger);
    color: #fff;
  }
</style>
