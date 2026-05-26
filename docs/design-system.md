# Money Tracker — Design System (reasoned, research-grounded)

> Every choice here has a reason and a source. We are NOT copying one app; we are
> synthesizing what the evidence says works for finance UIs into our own identity.
> Research date: 2026-05. Sources at the bottom.

## 0. What the research told us (and what we take from it)

**Finance-app user feedback (Copilot / Monarch / YNAB):**

- Copilot is loved for being **clean, calm, and effortless** — "the right things are automatic." → _Our north star: low friction, automatic where possible, manual when wanted._
- Monarch is praised for granularity + dashboards but **dinged for fiddly category editing**. → _Category assignment must be one tap, never a chore._
- YNAB is powerful but **complaints center on a cluttered, steep interface** and **no auto-subscription detection**. → _Avoid clutter; bias to clarity; our recurring/auto-categorization roadmap matters._

**Color psychology in fintech** (snap trust judgments form in ~90s and are 62–90% color-driven):

- **Blue = trust, stability, security** and is the safest for the ~10% who are red-green colorblind → our **primary/brand**.
- **Green = success, completion, safety; reduces anxiety around money** → **income / positive / confirmation only**.
- **Red = loss/error** → **spending / negative / destructive only**, and **never color-alone** (always paired with a sign `–`/`+` or icon, for colorblind safety).
- **Neutral foundation + generous whitespace = calm, lower cognitive load.**

**Financial data display (Tufte + dashboard best practice):**

- **Tabular (monospaced-width) numerals**, **right-aligned** numeric columns, **consistent 2-decimal** formatting, `$` + thousands separators → digits line up, scanning is effortless.
- Maximize **data-ink ratio**: strip decoration; let the numbers be the UI.
- Tables for precise lookup; charts for trends; **data _storytelling_** (say the takeaway, not just plot points).

**2026 fintech UI trends:** deliberate **neutral base + high-contrast data + precise accent**; **bold weight/size on the number that matters**, lighter on metadata; **design tokens**; **WCAG 2.2**; light+dark expected.

## 1. Color tokens (oklch — reasoned)

Dark-first (finance apps + our current mode; on-trend and easier on the eyes for long money sessions). Light mode is a fast-follow using the same token names.

| Token                      | Value (dark)              | Reason                                                                            |
| -------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `--bg`                     | `oklch(0.16 0.01 250)`    | Deep blue-tinted neutral — calm, not pure-black (less harsh), subtle blue = trust |
| `--surface` / `--elevated` | `0.20 / 0.24 (0.012 250)` | Layered neutrals for cards → depth without borders shouting                       |
| `--border`                 | `oklch(0.30 0.014 250)`   | Quiet separation (low data-ink)                                                   |
| `--fg` / `--muted`         | `0.97 / 0.66`             | High-contrast primary text (WCAG AA+), muted for metadata hierarchy               |
| `--primary` (brand/trust)  | `oklch(0.64 0.15 255)`    | **Blue** — trust, colorblind-safe; used for nav active, links, primary actions    |
| `--positive` (income)      | `oklch(0.74 0.16 150)`    | **Green** — money IN, success, "remaining" healthy                                |
| `--negative` (spending)    | `oklch(0.64 0.20 25)`     | **Red** — money OUT, overspent, destructive; ALWAYS with a sign/icon too          |
| `--warning`                | `oklch(0.80 0.15 85)`     | Amber — duplicate/needs-review                                                    |

Rule: **green/red carry meaning, never decoration.** Brand accent is blue. A pie/category palette uses distinct, evenly-spaced hues (not the semantic green/red) so "a category" is never confused with "income/spending."

## 2. Typography & numbers

- **UI font:** refined system stack (`-apple-system, "Segoe UI", Roboto, …`) — zero bundle, native feel per OS, no third-party CDN (Principle XIII).
- **Money/numbers:** `tabular-nums` (Tailwind utility) everywhere a figure appears, **right-aligned**, **2 decimals**, `$` + commas (via existing `formatMoney`). Never `font-mono` for amounts — tabular-nums on the UI font is cleaner and still column-aligned.
- **Hierarchy:** the one number that matters (net, balance, "left") is **large + semibold**; labels/metadata are **small + muted**. (2026 trend: weight encodes importance.)

## 3. Spacing, layout, motion

- 4px base scale (Tailwind default). Generous padding in cards (calm). Max content width ~`5xl`, centered.
- Cards = the primary container (rounded-xl, 1px quiet border, subtle elevation). Consistent header/body rhythm.
- Motion: subtle, fast (≤150ms), respect `prefers-reduced-motion`. No gratuitous animation (calm > flashy).

## 4. Components (shadcn-svelte, built on bits-ui + tailwind-variants)

Adopt a consistent set instead of ad-hoc `<div>`s: **Card, Button, Badge, Tabs (nav), Table, Input, Select, Stat (number callout)**. One source of truth for radius/spacing/states → consistency, which the research ties directly to perceived trust.

## 5. Data visualization (ECharts)

- Reserve room for axis + legend (no collisions — fixes the current bug). Legend top, grid padded.
- Category palette = the distinct-hue ramp (not semantic green/red). Net-cash-flow: green bars = in, red = out, neutral line = net.
- **Tell the story:** each chart gets a one-line plain-English takeaway above it ("You spent 18% more on dining this month").

## 6. Accessibility

WCAG 2.2 AA contrast on text + interactive states; never color-alone (sign/icon backup); focus-visible rings on the primary; honor reduced-motion.

## Sources

- Color psychology: billcut.com/blogs/color-psychology-in-fintech-ui-why-green-dominates; windmill.digital/psychology-of-color-in-financial-app-design; inordo.com/shades-of-trust-how-color-psychology-influences-fintech-ui-design
- Dashboards & data tables: f9finance.com/dashboard-design-best-practices; medium @vaishali.samanta data-tables; datafloq.com typography-basics-for-data-dashboards; rib-software.com bi-dashboard-design-principles
- 2026 fintech trends: theskinsfactory.com/uiux-design-blog/fintech-ui-ux-design; eleken.co/blog-posts/modern-fintech-design-guide; onething.design/post/top-10-fintech-ux-design-practices-2026
- App feedback: engadget.com best-budgeting-apps; era.app/articles/era-vs-monarch-vs-copilot-vs-ynab; monarch.com/compare/ynab-alternative
