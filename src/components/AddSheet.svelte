<script lang="ts">
  // Add Sheet — locked design v1 (2026-05-28).
  // Spec: reports/design/home-budgetbox-v1-LOCKED.md > Add Sheet section.
  //
  // Opened when the user taps the center "+" tab in the bottom nav bar.
  // Three rows: Expense / Income / Transfer.  Tapping a row CLOSES this
  // sheet and signals the parent to open the QuickAddSheet preset to that
  // type.

  export type AddKind = 'expense' | 'income' | 'transfer';

  interface Props {
    open: boolean;
    onPick: (kind: AddKind) => void;
    onClose: () => void;
  }

  const { open, onPick, onClose }: Props = $props();

  function pick(kind: AddKind): void {
    onPick(kind);
    onClose();
  }
</script>

{#if open}
  <button type="button" class="backdrop" aria-label="Close add menu" onclick={onClose}></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Add a transaction">
    <div class="grabber"></div>
    <h2>Add a transaction</h2>

    <div class="rows">
      <button type="button" class="row expense" onclick={() => pick('expense')}>
        <span class="ico" aria-hidden="true">↓</span>
        <span class="meta">
          <strong>Expense</strong>
          <span>Money you spent — counts toward your budget</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>

      <button type="button" class="row income" onclick={() => pick('income')}>
        <span class="ico" aria-hidden="true">↑</span>
        <span class="meta">
          <strong>Income</strong>
          <span>Salary, refund, gift, freelance</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>

      <button type="button" class="row transfer" onclick={() => pick('transfer')}>
        <span class="ico" aria-hidden="true">↔</span>
        <span class="meta">
          <strong>Transfer</strong>
          <span>Between your own accounts — NOT spending</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
    animation: fade 0.2s ease both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 50;
    background: var(--color-bg);
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    padding: 0.6rem 1.1rem calc(1.4rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    animation: rise 0.28s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .grabber {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: rgba(42, 38, 34, 0.2);
    margin: 0 auto 0.85rem;
  }
  h2 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
    text-align: center;
    margin-bottom: 1rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 16px;
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition:
      background-color 0.16s ease,
      transform 0.16s ease;
  }
  .row:hover {
    background: var(--color-surface-hover);
  }
  .row:active {
    transform: scale(0.99);
  }

  .ico {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
    flex-shrink: 0;
  }
  .row.expense .ico {
    background: color-mix(in oklab, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
  }
  .row.income .ico {
    background: color-mix(in oklab, var(--color-success) 18%, transparent);
    color: var(--color-success);
  }
  .row.transfer .ico {
    background: color-mix(in oklab, #5b8aa3 18%, transparent);
    color: #5b8aa3;
  }

  .meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .meta strong {
    font-size: 0.96rem;
    font-weight: 700;
    color: var(--color-text);
  }
  .meta span {
    font-size: 0.78rem;
    color: var(--color-muted);
  }
  .chev {
    color: var(--color-muted);
    font-size: 1.1rem;
  }
</style>
