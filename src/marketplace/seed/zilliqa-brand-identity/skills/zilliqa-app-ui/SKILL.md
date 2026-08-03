---
name: zilliqa-app-ui
description: Use when building a Zilliqa application, dashboard, console, admin panel, or any product screen — app shells (topbar and sidebar), stat tiles, data tables, forms, empty states, translating Material components, and the responsive rules that prevent horizontal overflow. Layers on top of the zilliqa-brand skill, which owns colors, type, tokens, contrast and scroll behaviour. Includes five verified reference builds under examples/.
---

<!-- GENERATED FILE — DO NOT EDIT. Source: src/brand/. Regenerate with: npm run build:agents -->

# Zilliqa Application & Dashboard UI

An application framework layered on the Zilliqa brand system: app shells, dashboard
composition, and the responsive rules that keep them from breaking.

`zilliqa-brand` owns colors, type, logo, tokens, contrast, and navigation/scroll
behaviour — read it for anything not about assembly. This skill owns **how an application
is put together**. Every value below comes from `assets/tokens/zilliqa-colors.css`; wire
the tokens rather than hardcoding hex.

Working, verified references live in `examples/`:

| File | Shape |
|------|-------|
| `examples/app-staking.html` | Topbar shell — metrics dashboard, stat row, data table, meter |
| `examples/app-console.html` | Sidebar shell — settings, forms, list rows, empty state |
| `examples/page-long-form.html` | Editorial — measure-constrained prose, contents rail, reading progress |
| `examples/app-frames-material.html` | Material archetypes translated — app bar, nav drawer, bottom nav, FAB, tabs, dialog, snackbar, switches |
| `examples/app-frames-recovery.html` | A real Material 3 screen translated — vertical stepper, info cards, secret fields, provisional caution state |

## Non-negotiables

1. **Dark-first.** `--zq-surface-primary` (`#000000`) is the canvas. `--zq-surface-secondary`
   (`#1f1f1f`) is the elevated layer. Never default an app to a white canvas.
2. **Sharp containers, pill actions.** Cards/panels/nav `border-radius: 0`; buttons
   `2.5rem`. Inputs and tags are the only lightly-rounded elements (`0.25rem`).
3. **Elevation is a ring.** `inset 0 0 0 1px` hairlines, never drop shadows.
4. **Teal is a surface.** Teal fill takes **black** text (10.84:1). Teal text belongs only
   on black/near-black. Never teal text on white (1.94:1). Accent hover is Mint
   `--zq-mint`; never place Mint on teal (1.55:1).
5. **Focus is mandatory.** `outline: 2px solid #00d0c6; outline-offset: 3px`. Never remove it.
6. **Interface controls use Instrument Sans** (`--zq-font-ui`) — buttons and primary nav
   only. Every heading, label, and body string stays Montserrat.

## App shells

Two shells cover almost every application screen. Both put the brand mark top-left and
keep chrome at `--zq-nav-height` (4rem).

**Topbar shell** — dashboards, overview screens, anything wide and metric-led.

```css
.nav {
  position: sticky; top: 0; z-index: 10;
  height: var(--zq-nav-height);
  display: flex; align-items: center; gap: var(--zq-gap-sm);
  padding-inline: var(--zq-container-padding-x);
  background: var(--zq-surface-nav);
  backdrop-filter: blur(var(--zq-nav-blur));
  /* Links scroll rather than wrap — the 4rem height is a layout constant
     that other sticky offsets are derived from. */
  overflow-x: auto; overflow-y: hidden; white-space: nowrap; scrollbar-width: none;
}
.shell { max-width: var(--zq-container-base); margin-inline: auto;
         padding-inline: var(--zq-container-padding-x); }
```

**Sidebar shell** — settings, consoles, anything with deep navigation. The rail is sticky
and scrolls independently; below 992px it becomes a sticky top bar of the same height.

```css
.app  { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; align-items: start; }
.app > * { min-width: 0; }
.side { position: sticky; top: 0; height: 100vh; overflow-y: auto;
        background: var(--zq-surface-primary);
        box-shadow: inset -1px 0 0 rgba(255,255,255,.08); }

@media (max-width: 991px) {
  .app  { grid-template-columns: minmax(0, 1fr); }
  .side { position: sticky; top: 0; height: var(--zq-nav-height);
          flex-direction: row; overflow-x: auto; white-space: nowrap;
          background: var(--zq-surface-nav); backdrop-filter: blur(var(--zq-nav-blur));
          box-shadow: inset 0 -1px 0 rgba(255,255,255,.08); }
}
```

Active rail item: `color: var(--zq-teal)` on `--zq-surface-teal-wash-10` with
`inset 2px 0 0 var(--zq-teal)`. As a top bar, move the rule to the underside
(`inset 0 -2px 0`).

## Dashboard composition

Application density is tighter than marketing. Use `--zq-space-300` (3rem) between
sections rather than the 8rem marketing rhythm; keep `--zq-card-padding` for cards.

```css
.grid        { display: grid; gap: var(--zq-gap-xs); }
.grid > *    { min-width: 0; }                       /* see Responsive rules */
.grid--stats { grid-template-columns: repeat(4, 1fr); }
.grid--split { grid-template-columns: 2fr 1fr; align-items: start; }

.card { border-radius: var(--zq-radius-card); padding: var(--zq-card-padding);
        background: var(--zq-surface-subtle-panel); box-shadow: var(--zq-shadow-card); }
.card--teal  { background: var(--zq-surface-teal-wash-10); box-shadow: var(--zq-shadow-panel-teal); }
.card--solid { background: var(--zq-teal); color: var(--zq-black); box-shadow: none; }
```

**Card variants carry meaning — pick deliberately:**

| Variant | Use for |
|---|---|
| `.card` | The default. Neutral metrics and content. |
| `.card--teal` | One supporting panel per view — the thing to act on next. |
| `.card--solid` | At most **one** per screen. The single most urgent figure. Black text. |

Overusing `--solid` destroys the hierarchy it exists to create.

**Stat tiles.** Label at `.8rem`/`+.1em` uppercase in `--zq-text-muted`; value at
`1.95rem`/`1.04em` with `font-variant-numeric: tabular-nums` so digits don't jitter as
they update; delta at `.88rem`, teal only when it is genuinely positive.

**Data tables.** Hairline rows, no zebra fills. Sticky header offsets below the nav so
the two never collide:

```css
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { position: sticky; top: var(--zq-nav-height); z-index: 1;
     background: var(--zq-surface-primary);
     box-shadow: inset 0 -1px 0 rgba(255,255,255,.2);
     font-size: .8rem; letter-spacing: .1em; text-transform: uppercase;
     color: var(--zq-text-muted); text-align: left; }
td { border-bottom: 1px solid rgba(255,255,255,.08); }
```

Right-align numeric columns. Status pills use `--zq-radius-tag` with
`--zq-surface-teal-wash-12` + teal text for active states, `rgba(255,255,255,.06)` +
`--zq-text-tertiary` for inert ones.

**Meters** are 6px, unrounded, `rgba(255,255,255,.08)` track with a teal fill — the same
sharp-container logic as cards.

**Empty states** are a teal-wash panel, centred, copy capped at ~44ch, with exactly one
primary action. Say what the feature does, not that it is empty.

**Forms.** Inputs get `--zq-radius-input`, `--zq-input-padding`, a
`rgba(255,255,255,.2)` border on `--zq-surface-primary`, brightening on hover. Label
above at `.88rem` in `--zq-text-tertiary`; hint below at `.88rem` in `--zq-text-muted`.
Cap form fields around 480px regardless of container width.

## Translating Material (and other) component libraries

Most app scaffolding arrives shaped by Material — an app bar, a navigation drawer, bottom
navigation, a FAB, tabs, dialogs, snackbars, switches. Those archetypes are fine; their
*defaults* conflict with this system in four specific ways. Apply these in order:

| Material default | Zilliqa translation |
|---|---|
| Elevation as a drop shadow at dp levels | `inset 0 0 0 1px` hairline ring; bars use `backdrop-filter: blur(12px)` |
| Rounded corners throughout | Containers sharp (`radius: 0`) — cards, sheets, dialogs, snackbars. Inputs and tags only take `0.25rem` |
| Pill-filled active nav indicator | Square container marked with a teal edge plus a teal wash |
| Ripple on press | No ripple — `0.15s` colour, `0.2s` transform, `ease` |
| Primary colour as text/icon on light surfaces | Teal is a surface: filled controls take **black** labels; teal text only on black |
| Roboto / Material Symbols | Montserrat for content, Instrument Sans for controls, bundled brand icons via `currentColor` |
| Sliding tab indicator | Static teal edge; only the label colour transitions |

**Keep circular icon targets.** FABs, avatars, icon buttons and switch knobs stay round.
The sharp/pill rule governs *containers versus actions* — these are actions. Squaring them
off costs touch-target legibility for no brand gain.

Worked reference: `examples/app-frames-material.html`.

## Responsive rules

Collapse `grid--stats` to 2 columns at 991 and 1 at 767; `grid--split` to a single column
at 991. Breakpoints, sticky-offset stacking and `(hover: hover)` gating are in the
`zilliqa-brand` skill under *Navigation and scroll behaviour*.

**Four layout traps that cause sideways page scroll.** Each was hit and fixed while
building the reference examples; check all four before shipping any app screen:

1. **`1fr` has a min-content floor.** A wide code block or table widens the column past
   the viewport. Use `minmax(0, 1fr)`.
2. **Grid and flex items default to `min-width: auto`.** They refuse to shrink below
   their content. Set `min-width: 0` on grid/flex children.
3. **A fixed `max-width` beats a later clamp.** `max-width: 860px` lets a wide child
   stretch the column; use `max-width: min(860px, 100%)`. Watch cascade order — a
   `.prose { max-width: 860px }` further down the sheet overrides an earlier clamp.
4. **Wide content must scroll inside its own container.** Wrap tables in an
   `overflow-x: auto` element and give code blocks `overflow-x: auto`. The page body
   must never scroll horizontally.

Verify with `document.documentElement.scrollWidth - document.documentElement.clientWidth`
at 390px — it must be `0`. Elements wider than the viewport are fine **only** when an
ancestor scrolls them internally.

## Build checklist

- [ ] Canvas is `--zq-surface-primary`, not white
- [ ] Cards `radius: 0`; buttons `radius: 2.5rem`
- [ ] Elevation is `inset … 1px`, no drop shadows
- [ ] Every teal fill carries black text
- [ ] At most one `.card--solid` per screen
- [ ] Numeric columns are `tabular-nums` and right-aligned
- [ ] `scroll-padding-top` set; sticky offsets stacked, not overlapping
- [ ] Skip link present; focus ring never removed
- [ ] Hover affordances behind `(hover: hover)`
- [ ] `prefers-reduced-motion` honoured
- [ ] Zero horizontal page overflow at 390px
