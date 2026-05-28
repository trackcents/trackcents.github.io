# Home BudgetBox + Add-button — locked design v1 (2026-05-28)

Reference mockups:
- `reports/mockup-v4.png` — hero card + month picker
- `reports/mockup-add-placement.png` — center "+" tab bar + Add sheet

## Hero card layout (top → bottom)

1. **Centered nav widget** — `◀ May 2026 ▾ ▶`
   - Left chevron = previous month (1 tap, immediate)
   - Pill center = open month-picker sheet
   - Right chevron = next month (1 tap, immediate)
   - ZERO swipe (Android edge-back conflict)
2. **"Spent this month"** label (muted, small)
3. **Big spent number** — no decimals (₹11,528 not ₹11,528.42)
4. **"of ₹X income"** subline
5. **"+₹X other inflows →"** green chip (only when extra income > 0)
6. **Progress bar group** with meta above:
   - Left: `63% used` (muted)
   - Right: `✓ on track` (green) OR `⚠ over budget` (red)
7. **Stats row** (3 cols): Remaining (primary, larger) · Daily pace · Days left

## Killed (do NOT bring back)
- Side-of-month headroom pill
- Carry-forward "+₹X ended April (FYI — not added in)" chip
- Edge chevrons inside the box
- Bottom `◀ April · June ▶` row
- Decimal precision on the big number
- The floating "+" FAB (replaced by tab-bar center button)

## Month-picker sheet
- Bottom sheet, rounded top corners, grabber bar
- Header: `Pick a month` (left) · `Today` button (right, accent pill)
- Data-only: only months with imported transactions appear
- Grouped by year, year as uppercase muted heading (`2026`, `2025`, `2023`)
- Months as pill chips, wrap to multiple rows
- Selected month: dark filled chip
- Empty months hidden entirely; empty years hidden entirely
- Years sorted descending (newest first)

## Bottom tab bar
- 5 slots: `Home · Transactions · [+] · Statements · More`
- Center `[+]` is a 56px raised accent button, slightly negative top margin
- Recurring moves under More (Recurring is glance-only, not daily-touch)
- The "+" opens the Add Sheet (NOT the QuickAddSheet directly)

## Add Sheet
- Bottom sheet, same chrome as month-picker
- Title: `Add a transaction`
- Three rows (cards):
  - **+ Expense** (orange ↓ icon) — "Money spent — counts toward budget"
  - **+ Income** (green ↑ icon) — "Salary, refund, gift, freelance"
  - **+ Transfer** (blue ↔ icon) — "Between your own accounts (not spend)"
- Tapping a row opens the existing QuickAddSheet preset to that type

## Tap-count contract
- ±1 month → 1 tap (chevron)
- Jump to any month → 2 taps (open sheet + tap month chip)
- Add expense/income/transfer → 2 taps (tap "+" + tap row)

## Chef-gate
- Money math unchanged (presentation only; REQ-B0.1 flow_intent still binding)
- Mobile: works at 320px
- iOS Safari: no PDF.js, no Promise.withResolvers, no service-worker change
- Privacy: presentational, zero data movement

🔒 LOCKED 2026-05-28.
