<script lang="ts">
  // "Add / edit bill or subscription" sheet (spec §7.10). Collects name · amount ·
  // paid-from pocket · Repeats? (one-time vs recurring) · cadence (Month / 3mo /
  // 6mo / Year / Custom "every N units") · first due date. Emits a draft item;
  // the page assigns the id/order (add) or merges onto the existing item (edit).
  //
  // EDIT mode (pass `editItem`): the user changes the bill's details WITHOUT
  // paying anything — this is the fix for "I just wanted to change the total but
  // it defaulted to paying the full amount". Paying is a separate sheet.
  import { untrack } from 'svelte';
  import { parseMoney } from '$lib/util/money';
  import { centsToDecimal } from '$lib/app/export-csv';
  import { categoryColor, categoryIconName, type GlyphKey } from '$lib/app/category-visuals';
  import type { Pocket } from '$lib/app/pockets';
  import {
    advanceDueDate,
    type Cadence,
    type CadenceUnit,
    type RecurringItem,
    type RecurringSection
  } from '$lib/app/recurring-items';
  import CategoryIcon from '$components/CategoryIcon.svelte';
  import IconPickerSheet from '$components/IconPickerSheet.svelte';
  import SectionIcon from '$components/SectionIcon.svelte';

  interface DraftItem {
    section_id: string;
    name: string;
    amount_minor: bigint;
    paid_from: string;
    cadence: Cadence;
    due_date: string;
    /** User's chosen icon override ('' = auto from the name). */
    logo: string;
  }
  interface Props {
    open: boolean;
    /** The section a NEW item lands in (the card whose ＋ Add was tapped). */
    sectionId: string;
    /** All sections, for the in-sheet Section picker. */
    sections: RecurringSection[];
    pockets: Pocket[];
    todayIso: string;
    /** When set, the sheet edits this item instead of adding a new one. */
    editItem?: RecurringItem | null;
    /** Pre-fill a NEW item's fields (e.g. from a statement suggestion) so the
     *  user can tweak the name/amount/cadence BEFORE confirming the add. */
    seed?: {
      name: string;
      amount_minor: bigint;
      cadence: Cadence;
      due_date: string;
    } | null;
    /** Pre-filled due date for a NEW item (defaults to today). Lets the page add
     *  a forgotten bill straight into the month the user is viewing. */
    defaultDueDate?: string;
    onAdd: (draft: DraftItem) => void;
    /** Create a new section inline; returns its id so we can select it. */
    onCreateSection?: (name: string, icon: string) => string;
    /** Edit-mode only: a destructive "Delete" path (page shows the confirm). */
    onDelete?: () => void;
    onClose: () => void;
  }
  const {
    open,
    sectionId,
    sections,
    pockets,
    todayIso,
    editItem = null,
    seed = null,
    defaultDueDate,
    onAdd,
    onCreateSection,
    onDelete,
    onClose
  }: Props = $props();

  const isEdit = $derived(editItem !== null && editItem !== undefined);

  /** The section this item belongs to, editable here so the user can move a row
   *  between sections (or fix a wrong auto-classification). Seeded from the
   *  `sectionId` prop / edited item on open; the draft carries this. */
  let sectionState = $state('bills');
  // Inline "＋ New section" sub-form. Its icon is a rich glyph (same picker as
  // bills); '' = auto-derive from the section name.
  let creatingSection = $state(false);
  let newSecName = $state('');
  let newSecIcon = $state('');
  let secIconPickerOpen = $state(false);
  const orderedSections = $derived([...sections].sort((a, b) => a.order - b.order));
  let name = $state('');
  let amountStr = $state('');
  let repeats = $state<'once' | 'recurring'>('recurring');
  let preset = $state<'monthly' | 'every_3_months' | 'every_6_months' | 'yearly' | 'custom'>(
    'monthly'
  );
  let customN = $state(2);
  let customUnit = $state<CadenceUnit>('weeks');
  let dueDate = $state('');
  let paidFrom = $state('paychecks');
  /** Chosen icon override; '' = auto-derive from the name. */
  let logo = $state('');
  let iconPickerOpen = $state(false);
  let err = $state('');

  /** The glyph shown on the icon button: the override, else auto from the name. */
  const currentGlyph = $derived<GlyphKey>(
    logo !== '' ? (logo as GlyphKey) : categoryIconName(name || 'bill')
  );
  const iconColor = $derived(categoryColor(name || 'bill'));

  // Spread a Cadence across the repeats/preset/custom controls.
  function applyCadence(c: Cadence): void {
    if (c === 'once') {
      repeats = 'once';
      preset = 'monthly';
      customN = 2;
      customUnit = 'weeks';
    } else if (typeof c === 'object') {
      repeats = 'recurring';
      preset = 'custom';
      customN = c.every;
      customUnit = c.unit;
    } else {
      repeats = 'recurring';
      preset = c;
      customN = 2;
      customUnit = 'weeks';
    }
  }

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      untrack(() => {
        sectionState = editItem ? editItem.section_id : sectionId;
        creatingSection = false;
        newSecName = '';
        newSecIcon = '';
        if (editItem) {
          name = editItem.name;
          amountStr = centsToDecimal(editItem.amount_minor);
          applyCadence(editItem.cadence);
          dueDate = editItem.due_date;
          paidFrom = editItem.paid_from;
          logo = editItem.logo ?? '';
        } else if (seed) {
          name = seed.name;
          amountStr = centsToDecimal(seed.amount_minor);
          applyCadence(seed.cadence);
          dueDate = seed.due_date;
          paidFrom = 'paychecks';
          logo = '';
        } else {
          name = '';
          amountStr = '';
          repeats = 'recurring';
          preset = 'monthly';
          customN = 2;
          customUnit = 'weeks';
          dueDate = defaultDueDate ?? todayIso;
          paidFrom = 'paychecks';
          logo = '';
        }
        err = '';
      });
    }
    wasOpen = open;
  });

  // Bring a just-focused field above the on-screen keyboard.
  function scrollIntoView(e: FocusEvent): void {
    const el = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  const ordered = $derived([...pockets].sort((a, b) => a.order - b.order));

  function cadence(): Cadence {
    if (repeats === 'once') return 'once';
    if (preset === 'custom') return { every: Math.max(1, customN), unit: customUnit };
    return preset;
  }
  const nextPreview = $derived.by<string | null>(() => {
    if (repeats === 'once' || dueDate === '') return null;
    try {
      return advanceDueDate(dueDate, cadence());
    } catch {
      return null;
    }
  });

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

  function submit(): void {
    if (name.trim() === '') {
      err = 'Give it a name';
      return;
    }
    let amount: bigint;
    try {
      amount = parseMoney(amountStr);
    } catch {
      err = 'Enter a valid amount';
      return;
    }
    if (dueDate === '') {
      err = 'Pick a due date';
      return;
    }
    onAdd({
      section_id: sectionState,
      name: name.trim(),
      amount_minor: amount,
      paid_from: paidFrom,
      cadence: cadence(),
      due_date: dueDate,
      logo
    });
  }

  /** Commit the inline "＋ New section" form: create it + select it. */
  function commitNewSection(): void {
    const nm = newSecName.trim();
    if (nm === '' || onCreateSection === undefined) {
      creatingSection = false;
      return;
    }
    sectionState = onCreateSection(nm, newSecIcon);
    creatingSection = false;
    newSecName = '';
    newSecIcon = '';
  }
  const currentSection = $derived(orderedSections.find((s) => s.id === sectionState) ?? null);

  const presetLabels: Array<[typeof preset, string]> = [
    ['monthly', 'Month'],
    ['every_3_months', '3 months'],
    ['every_6_months', '6 months'],
    ['yearly', 'Year'],
    ['custom', 'Custom']
  ];
  const units: CadenceUnit[] = ['days', 'weeks', 'months', 'years'];
</script>

{#if open}
  <button type="button" class="ar-backdrop" aria-label="Close" onclick={onClose}></button>
  <div
    class="ar-sheet"
    role="dialog"
    aria-modal="true"
    aria-label={isEdit ? 'Edit item' : 'Add item'}
  >
    <div class="ar-grab"></div>
    <h2 class="ar-name">
      {isEdit ? 'Edit' : 'New'}
      {#if currentSection}· {currentSection.icon} {currentSection.name}{/if}
    </h2>

    <!-- Section — which card this lives in. Move a row between sections, fix a
         wrong auto-guess, or ＋ create your own (Loans, Utilities, …). -->
    <div class="ar-field">
      <span class="ar-lbl">Section</span>
      {#if creatingSection}
        <div class="ar-newsec">
          <div class="ar-newsec-row">
            <button
              type="button"
              class="ar-secicon"
              onclick={() => (secIconPickerOpen = true)}
              aria-label="Choose section icon"
            >
              <SectionIcon icon={newSecIcon} name={newSecName} size={20} />
            </button>
            <input
              class="ar-in"
              bind:value={newSecName}
              placeholder="Section name (e.g. Loans)"
              onfocus={scrollIntoView}
            />
            <button type="button" class="ar-newsec-ok" onclick={commitNewSection}>Add</button>
            <button type="button" class="ar-newsec-x" onclick={() => (creatingSection = false)}
              >✕</button
            >
          </div>
          <p class="ar-secicon-hint">Tap the icon to choose from all logos.</p>
        </div>
      {:else}
        <div class="ar-chips">
          {#each orderedSections as s (s.id)}
            <button
              type="button"
              class="ar-chip ar-chip-sec"
              class:on={sectionState === s.id}
              onclick={() => (sectionState = s.id)}
            >
              <SectionIcon icon={s.icon} name={s.name} size={15} tint={false} />
              {s.name}
            </button>
          {/each}
          {#if onCreateSection}
            <button
              type="button"
              class="ar-chip ar-chip-new"
              onclick={() => (creatingSection = true)}>＋ New section</button
            >
          {/if}
        </div>
      {/if}
    </div>

    <div class="ar-namerow">
      <!-- Tappable icon: auto-derived from the name, or pick your own logo. -->
      <div class="ar-field ar-iconfield">
        <span class="ar-lbl">Icon</span>
        <button
          type="button"
          class="ar-iconbtn"
          onclick={() => (iconPickerOpen = true)}
          aria-label="Change icon"
        >
          <CategoryIcon icon={currentGlyph} color={iconColor} tint size={22} />
          <span class="ar-iconbtn-chev" aria-hidden="true">▾</span>
        </button>
      </div>
      <div class="ar-two ar-two-grow">
        <div class="ar-field">
          <span class="ar-lbl">Name</span>
          <input
            class="ar-in"
            bind:value={name}
            placeholder="e.g. Car EMI, Netflix"
            onfocus={scrollIntoView}
          />
        </div>
        <div class="ar-field">
          <span class="ar-lbl">Amount</span>
          <input
            class="ar-in"
            inputmode="decimal"
            bind:value={amountStr}
            placeholder="0.00"
            onfocus={scrollIntoView}
          />
        </div>
      </div>
    </div>

    <div class="ar-field">
      <span class="ar-lbl">Repeats?</span>
      <div class="ar-seg">
        <button type="button" class:on={repeats === 'once'} onclick={() => (repeats = 'once')}
          >One-time</button
        >
        <button
          type="button"
          class:on={repeats === 'recurring'}
          onclick={() => (repeats = 'recurring')}>Recurring 🔁</button
        >
      </div>
    </div>

    {#if repeats === 'recurring'}
      <div class="ar-field">
        <span class="ar-lbl">Every</span>
        <div class="ar-chips">
          {#each presetLabels as [val, label] (val)}
            <button
              type="button"
              class="ar-chip"
              class:on={preset === val}
              onclick={() => (preset = val)}
            >
              {label}
            </button>
          {/each}
        </div>
        {#if preset === 'custom'}
          <div class="ar-custom">
            <span>Every</span>
            <div class="ar-stepper">
              <button
                type="button"
                onclick={() => (customN = Math.max(1, customN - 1))}
                aria-label="Decrease">−</button
              >
              <span class="ar-val">{customN}</span>
              <button type="button" onclick={() => (customN = customN + 1)} aria-label="Increase"
                >＋</button
              >
            </div>
            <select class="ar-unit" bind:value={customUnit} aria-label="Unit">
              {#each units as u (u)}<option value={u}>{u}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Due date + Pay from are STACKED full-width (not a 2-col grid): the date
         control and a wrapping pocket-chip strip have very different heights, and
         on iOS Safari the native date picker is wider than a half-column — both
         made this row look misaligned (Pushpa's circled alignment report). -->
    <div class="ar-field">
      <span class="ar-lbl">{repeats === 'once' ? 'Due date' : 'First due date'}</span>
      <input class="ar-date" type="date" bind:value={dueDate} onfocus={scrollIntoView} />
    </div>
    <div class="ar-field">
      <span class="ar-lbl">Pay from</span>
      <div class="ar-pockets">
        {#each ordered as p (p.id)}
          <button
            type="button"
            class="ar-chip"
            class:on={paidFrom === p.id}
            onclick={() => (paidFrom = p.id)}
          >
            {p.logo}
            {p.name}
          </button>
        {/each}
      </div>
    </div>

    {#if nextPreview}
      <p class="ar-note">
        🔁 After each payment the next due auto-advances · next {prettyDate(nextPreview)}.
      </p>
    {:else if repeats === 'once'}
      <p class="ar-note">Just this once — it won't come back.</p>
    {/if}

    {#if err}<p class="ar-err">{err}</p>{/if}

    <button type="button" class="ar-btn" onclick={submit}>{isEdit ? 'Save changes' : 'Add'}</button>
    {#if isEdit && onDelete}
      <button type="button" class="ar-delete" onclick={onDelete}>🗑 Delete</button>
    {/if}
    <button type="button" class="ar-cancel" onclick={onClose}>Cancel</button>
  </div>

  <IconPickerSheet
    open={iconPickerOpen}
    value={logo}
    {name}
    color={iconColor}
    onPick={(g) => (logo = g)}
    onClose={() => (iconPickerOpen = false)}
  />

  <IconPickerSheet
    open={secIconPickerOpen}
    value={newSecIcon}
    name={newSecName}
    onPick={(g) => (newSecIcon = g)}
    onClose={() => (secIconPickerOpen = false)}
  />
{/if}

<style>
  .ar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(15, 20, 28, 0.45);
    border: 0;
    cursor: pointer;
  }
  .ar-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: var(--kb-inset-bottom, 0px);
    z-index: 90;
    background: var(--color-surface);
    border-top-left-radius: 22px;
    border-top-right-radius: 22px;
    padding: 0.5rem 1.25rem calc(1rem + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-md);
    max-width: 640px;
    margin: 0 auto;
    max-height: calc(88dvh - var(--kb-inset-bottom, 0px));
    overflow-y: auto;
    animation: ar-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes ar-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .ar-grab {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-border);
    margin: 0.4rem auto 0.7rem;
  }
  .ar-name {
    font-size: 1.25rem;
    font-weight: 800;
    margin-bottom: 1rem;
    color: var(--color-text);
  }
  .ar-two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  .ar-namerow {
    display: flex;
    align-items: flex-end;
    gap: 0.6rem;
  }
  .ar-two-grow {
    flex: 1;
    min-width: 0;
  }
  .ar-iconfield {
    flex: none;
  }
  .ar-iconbtn {
    position: relative;
    width: 52px;
    height: 46px;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-bg);
    display: grid;
    place-items: center;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-iconbtn:active {
    background: var(--color-elevated);
  }
  .ar-iconbtn-chev {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font-size: 0.6rem;
    color: var(--color-muted);
    line-height: 1;
  }
  .ar-field {
    margin-bottom: 0.8rem;
  }
  .ar-lbl {
    display: block;
    font-size: 0.66rem;
    color: var(--color-muted);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.3rem;
  }
  .ar-in,
  .ar-date {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.7rem 0.9rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-surface);
    font-family: inherit;
  }
  .ar-in:focus,
  .ar-date:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .ar-seg {
    display: flex;
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 3px;
  }
  .ar-seg button {
    flex: 1;
    text-align: center;
    padding: 0.55rem;
    border-radius: 9px;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-muted);
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-seg button.on {
    background: var(--color-surface);
    color: var(--color-accent);
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.08));
  }
  .ar-chips,
  .ar-pockets {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .ar-chip {
    padding: 0.5rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-muted);
    background: var(--color-surface);
    cursor: pointer;
    font-family: inherit;
  }
  .ar-chip.on {
    background: color-mix(in oklab, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .ar-chip-new {
    border-style: dashed;
    color: var(--color-accent);
  }
  .ar-newsec {
    border: 1.5px solid var(--color-accent);
    background: color-mix(in oklab, var(--color-accent) 6%, transparent);
    border-radius: 14px;
    padding: 0.6rem;
  }
  .ar-secicon {
    flex: none;
    width: 40px;
    height: 38px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .ar-secicon-hint {
    font-size: 0.72rem;
    color: var(--color-muted);
    margin: 0.45rem 0 0;
  }
  .ar-chip-sec {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .ar-newsec-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .ar-newsec-row .ar-in {
    flex: 1;
    min-width: 0;
  }
  .ar-newsec-ok {
    flex: none;
    border: 0;
    border-radius: 10px;
    padding: 0.55rem 0.9rem;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-newsec-x {
    flex: none;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    width: 36px;
    height: 36px;
    background: var(--color-surface);
    color: var(--color-muted);
    cursor: pointer;
  }
  .ar-custom {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.7rem;
    border: 1.5px solid var(--color-accent);
    background: color-mix(in oklab, var(--color-accent) 8%, transparent);
    border-radius: 14px;
    padding: 0.7rem;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .ar-stepper {
    display: flex;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: 11px;
    background: var(--color-surface);
    overflow: hidden;
  }
  .ar-stepper button {
    width: 36px;
    height: 38px;
    border: 0;
    background: transparent;
    font-size: 18px;
    color: var(--color-accent);
    font-weight: 700;
    cursor: pointer;
  }
  .ar-val {
    width: 40px;
    text-align: center;
    font-size: 1.1rem;
    font-weight: 800;
  }
  .ar-unit {
    flex: 1;
    border: 1px solid var(--color-border);
    border-radius: 11px;
    background: var(--color-surface);
    padding: 0.6rem 0.7rem;
    font-weight: 700;
    color: var(--color-text);
    font-family: inherit;
  }
  .ar-note {
    font-size: 0.76rem;
    color: var(--color-muted);
    background: var(--color-elevated);
    border-radius: 12px;
    padding: 0.6rem 0.8rem;
    line-height: 1.45;
    margin: 0.3rem 0 0.9rem;
  }
  .ar-err {
    color: var(--color-danger);
    font-size: 0.82rem;
    margin: 0.2rem 0 0.6rem;
  }
  .ar-btn {
    width: 100%;
    padding: 0.9rem;
    border-radius: 14px;
    background-image: var(--grad-primary);
    color: var(--color-accent-fg);
    font-weight: 700;
    font-size: 1rem;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-delete {
    width: 100%;
    text-align: center;
    color: var(--color-danger);
    font-size: 0.9rem;
    font-weight: 600;
    margin-top: 0.7rem;
    padding: 0.6rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
  .ar-cancel {
    width: 100%;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.88rem;
    margin-top: 0.3rem;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: inherit;
  }
</style>
