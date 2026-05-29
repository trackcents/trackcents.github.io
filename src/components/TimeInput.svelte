<script lang="ts">
  // TimeInput — segmented HH : MM AM/PM control for QuickAddSheet.
  //
  // Hemanth: "to manually enter [time] it is not forcing any format like
  // why user need to type always ':' why can't you fix it and even AM PM
  // also why don't you add drop down".
  //
  // Design:
  //   • Two numeric-only sub-inputs (HH 1-12, MM 0-59) separated by a
  //     printed ":" — no need to type the colon.
  //   • HH auto-advances focus to MM after 2 valid digits.
  //   • AM / PM as a tappable segmented toggle (not a typed letter).
  //   • Pads single digits to 00 on blur ("3" -> "03").
  //   • Caps HH at 12 (rolls invalid 13+ down) and MM at 59.
  //   • Two-way bound to a 24-hour "HH:MM" string via the `value` prop so
  //     it remains compatible with the form's save path AND with the NL
  //     parser's autofill (which emits 24h "15:40" for "03:40 PM").
  //   • Empty state: every sub-field clears and AM/PM is left at the
  //     last-used value (so toggling doesn't accidentally save 12:00 AM).

  interface Props {
    /** 24-hour "HH:MM" or '' for empty.  Two-way bound. */
    value: string;
    /** Called when the user is actively editing (typing or toggling) so the
     *  parent can flip its "userTouched" flag and stop autofill. */
    onUserEdit?: (() => void) | undefined;
    /** Optional id for testing / labelling. */
    id?: string;
  }

  let { value = $bindable(''), onUserEdit, id }: Props = $props();

  let hh = $state('');
  let mm = $state('');
  let period = $state<'AM' | 'PM'>('PM');
  let hhEl = $state<HTMLInputElement | null>(null);
  let mmEl = $state<HTMLInputElement | null>(null);

  // Re-derive sub-fields whenever `value` changes externally (autofill).
  // Guard against feedback loops by only updating when the parsed split
  // differs from current state.
  let lastParsedValue = '';
  $effect(() => {
    if (value === lastParsedValue) return;
    lastParsedValue = value;
    if (value === '') {
      hh = '';
      mm = '';
      // Leave `period` alone so a transient empty value doesn't reset
      // the user's last choice.
      return;
    }
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return;
    const h24 = parseInt(m[1]!, 10);
    const mins = parseInt(m[2]!, 10);
    if (!Number.isFinite(h24) || !Number.isFinite(mins)) return;
    // Convert 24h -> 12h + period for display.
    let h12: number;
    if (h24 === 0) {
      h12 = 12;
      period = 'AM';
    } else if (h24 < 12) {
      h12 = h24;
      period = 'AM';
    } else if (h24 === 12) {
      h12 = 12;
      period = 'PM';
    } else {
      h12 = h24 - 12;
      period = 'PM';
    }
    hh = String(h12).padStart(2, '0');
    mm = String(mins).padStart(2, '0');
  });

  // Combine sub-fields back to 24-hour "HH:MM" or '' and push up to the
  // parent.  Triggered after any sub-field changes.
  function syncOut(): void {
    if (hh === '' && mm === '') {
      if (value !== '') {
        lastParsedValue = '';
        value = '';
      }
      return;
    }
    const h12 = parseInt(hh, 10);
    const mins = parseInt(mm, 10);
    if (!Number.isFinite(h12) || h12 < 1 || h12 > 12) return;
    if (!Number.isFinite(mins) || mins < 0 || mins > 59) return;
    let h24: number;
    if (period === 'AM') h24 = h12 === 12 ? 0 : h12;
    else h24 = h12 === 12 ? 12 : h12 + 12;
    const next = `${String(h24).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    if (next !== value) {
      lastParsedValue = next;
      value = next;
    }
  }

  /** Strip non-digits, clamp to 0..hi, return up to `maxLen` chars. */
  function sanitize(raw: string, maxLen: number, hi: number): string {
    let s = raw.replace(/\D/g, '');
    if (s.length > maxLen) s = s.slice(0, maxLen);
    if (s === '') return '';
    const n = parseInt(s, 10);
    if (n > hi) {
      // Keep just the first digit when the typed number overflows
      // ("13" in HH → "1", letting the user retry with the next keystroke).
      return s.slice(0, 1);
    }
    return s;
  }

  function onHhInput(e: Event): void {
    onUserEdit?.();
    const el = e.target as HTMLInputElement;
    const cleaned = sanitize(el.value, 2, 12);
    hh = cleaned;
    if (cleaned !== el.value) el.value = cleaned;
    syncOut();
    // Auto-advance once the user has typed 2 digits (or a clearly-complete
    // single digit like "2" → wait for the second; "3-9" → auto-advance
    // because no valid hour starts with those except as the only digit).
    if (cleaned.length === 2) {
      mmEl?.focus();
      mmEl?.select?.();
    }
  }
  function onMmInput(e: Event): void {
    onUserEdit?.();
    const el = e.target as HTMLInputElement;
    const cleaned = sanitize(el.value, 2, 59);
    mm = cleaned;
    if (cleaned !== el.value) el.value = cleaned;
    syncOut();
  }

  /** Pad single-digit values on blur ("3" → "03"). */
  function onHhBlur(): void {
    if (hh !== '' && hh.length === 1) {
      hh = hh.padStart(2, '0');
      syncOut();
    }
  }
  function onMmBlur(): void {
    if (mm !== '' && mm.length === 1) {
      mm = mm.padStart(2, '0');
      syncOut();
    }
  }
  function setPeriod(p: 'AM' | 'PM'): void {
    if (period === p) return;
    onUserEdit?.();
    period = p;
    syncOut();
  }
  /** Backspace at MM start → jump back to HH. */
  function onMmKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Backspace' && mm === '') {
      e.preventDefault();
      hhEl?.focus();
    }
  }
  /** Allow ":" to jump from HH → MM, even though we never WRITE one. */
  function onHhKeyDown(e: KeyboardEvent): void {
    if (e.key === ':' || e.key === ';') {
      e.preventDefault();
      mmEl?.focus();
    }
  }
</script>

<div class="ti-wrap" {id}>
  <div class="ti-cluster">
    <input
      type="text"
      inputmode="numeric"
      pattern="\d*"
      maxlength="2"
      placeholder="HH"
      class="ti-num"
      aria-label="Hour"
      bind:value={hh}
      bind:this={hhEl}
      oninput={onHhInput}
      onblur={onHhBlur}
      onkeydown={onHhKeyDown}
      onfocus={(e) => (e.target as HTMLInputElement).select()}
    />
    <span class="ti-sep" aria-hidden="true">:</span>
    <input
      type="text"
      inputmode="numeric"
      pattern="\d*"
      maxlength="2"
      placeholder="MM"
      class="ti-num"
      aria-label="Minute"
      bind:value={mm}
      bind:this={mmEl}
      oninput={onMmInput}
      onblur={onMmBlur}
      onkeydown={onMmKeyDown}
      onfocus={(e) => (e.target as HTMLInputElement).select()}
    />
  </div>
  <div class="ti-ampm" role="group" aria-label="AM or PM">
    <button
      type="button"
      class="ti-ap"
      class:on={period === 'AM'}
      onclick={() => setPeriod('AM')}
      aria-pressed={period === 'AM'}
    >
      AM
    </button>
    <button
      type="button"
      class="ti-ap"
      class:on={period === 'PM'}
      onclick={() => setPeriod('PM')}
      aria-pressed={period === 'PM'}
    >
      PM
    </button>
  </div>
</div>

<style>
  .ti-wrap {
    display: flex;
    align-items: stretch;
    gap: 0.4rem;
    min-width: 0;
  }
  .ti-cluster {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    border-radius: 10px;
    padding: 0.4rem 0.5rem;
    min-width: 0;
  }
  .ti-cluster:focus-within {
    border-color: var(--color-accent);
  }
  .ti-num {
    width: 1.8em;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-size: 1rem;
    font-weight: 600;
    text-align: center;
    padding: 0.15rem 0;
    outline: none;
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  .ti-num::placeholder {
    color: var(--color-muted);
    font-weight: 500;
  }
  .ti-sep {
    color: var(--color-muted);
    font-weight: 600;
    line-height: 1;
  }
  .ti-ampm {
    display: inline-flex;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--color-bg);
  }
  .ti-ap {
    border: 0;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    padding: 0 0.6rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    height: 100%;
    min-height: 2.05rem;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }
  .ti-ap.on {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
  .ti-ap:not(.on):hover {
    background: var(--color-elevated);
    color: var(--color-text);
  }
  .ti-ap + .ti-ap {
    border-left: 1px solid var(--color-border);
  }
</style>
