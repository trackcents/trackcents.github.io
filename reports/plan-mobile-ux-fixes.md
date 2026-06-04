# Mobile UX fixes — 2026-06-04 (from Hemanth's 5 screenshots)

Status legend: [ ] todo · [~] in progress · [x] done + verified

## A. Keyboard problems
- [x] **A1. CategoryPicker — add sub-category is keyboard-trapped.** After "Add",
  the input now blurs (keyboard dismisses) + closes the add row + scrolls the new
  sub into view under its expanded parent. (`CategoryPicker.svelte` submitAddSub)
- [x] **A2. QuickAdd — tapping Notes didn't open the keyboard.** Root cause: the
  keyboard-open compaction set `display:none` on Notes, so focusing it opened the
  keyboard → hid Notes → dropped focus → keyboard closed. Now Notes stays visible
  while it's the focused field (`:not(.notes-focused)`), and scrolls into view.

## B. Add-expense (QuickAdd) sheet
- [x] **B1. Optional Name field.** Added; empty → list shows the sub-category as the
  name; typing a name overrides. (verified — field renders)
- [x] **B2. Time "Now" tick.** Added a "Now" pill that fills the current time. (verified)

## C. Transactions list
- [x] **C1. Delete a transaction.** Two-tap "Delete → Tap to confirm" on MANUAL rows
  (verified: manual deleted, statement rows show no Delete, only "Exclude").
- [x] **C2. Row = NAME big, "Category › Sub-category" small.** Verified:
  Lunch / "Travel › Rapido"; unnamed manual → "Rapido" / "Travel".

## D. Recurring ↔ Transactions (the "merge" ask)
- [x] **D1. Removed the confusing per-row "Mark as recurring" checkbox** (it only
  painted a ↻ icon and didn't link to the Recurring tab). Recurring bills live on
  the Recurring tab. (verified — gone from actions)
- [ ] **D2. A recurring bill marked PAID should appear in Transactions.** DEFERRED
  to its own pass — it already deducts from the Home pocket; surfacing it as a
  read-only ledger row (not double-counting, not editable like a normal row) is a
  bigger change to the transactions view. Planned next.

## Verify + ship
- [x] `pnpm verify` green + browser-verified the batch with synthetic data (real data
  backed up + restored: 3 imports). Deploy once.
