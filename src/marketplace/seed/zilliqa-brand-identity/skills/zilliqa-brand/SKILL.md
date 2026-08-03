---
name: zilliqa-brand
description: Use when applying Zilliqa brand identity — official colors, the Montserrat type system, gradients, logo, and icon assets — to UI, components, websites, marketing, decks, or any design/build work. Bundles ready-to-use SVG logos, an icon set, color/gradient swatches, and design tokens (JSON / CSS / Tailwind). Source of truth: the official "Zilliqa - Brand Assets - Latest" Figma file.
---

<!-- GENERATED FILE — DO NOT EDIT. Source: src/brand/. Regenerate with: npm run build:agents -->

Use these exact values and the bundled assets — never invent or approximate Zilliqa
brand colors, fonts, or logo artwork.

- **Primary color:** Zilliqa Teal `#00d0c6`. Hover/darker accent: Pine `#2b9297`.
- **Dark / depth:** Deep Ocean `#26067c`.
- **Signature gradient:** `linear-gradient(135deg, #00d0c6 0%, #391ebc 55%, #26067c 100%)`.
- **Type:** Montserrat for all headings and body (300–800; 400 body, 500/600/700 emphasis).
  Instrument Sans on buttons and primary nav **only** — never headings, body, or print.
- **Logo:** use the bundled SVG variant with the best background contrast; never
  recolor, stretch, rotate, or add effects. The teal mark's three teal shades are
  intentional — don't flatten it.
- **Tokens & assets** live under `assets/` (`tokens/`, `logo/`, `icons/`, `gradients/`).
  Wire tokens once from `assets/tokens/` rather than hardcoding hex.

- **Web / product UI** — applied values from live zilliqa.com take precedence over the
  roles above; those roles stay canonical for print and brand-asset work:
  - **Canvas is dark-first:** `#000000` base, `#1f1f1f` elevated, white/alpha text.
    Don't default to a white canvas for product UI.
  - **Teal is a surface, not link text:** teal fills with **black** text on top
    (10.84:1). Never teal text on white — 1.94:1, fails at every size. Need a teal
    accent on light? Use Pine `#2b9297`, and only for large text or non-text UI.
  - **Shape signature:** sharp cards (`radius: 0`) paired with full pill buttons
    (`radius: 2.5rem`). Elevation is an `inset 0 0 0 1px` ring, never a drop shadow.
  - **Focus is mandatory:** `outline: 2px solid #00d0c6; outline-offset: 3px`. Never
    `outline: none`.
  - **Ratified web palette:** Mint `#6fffc2` (accent hover — never on teal, 1.55:1) ·
    Lilac `#ab87f7` / Violet `#854be8` (secondary accent) · Lime `#d2ff02` (accent-text
    hover on dark). Print keeps Pine and Deep Ocean.
- **Building an app, dashboard, console or admin panel?** See the `zilliqa-app-ui` skill
  (`skills/zilliqa-app-ui/SKILL.md`) for app shells, stat tiles, data tables, forms,
  sticky/scroll offsets, and the four layout traps that cause horizontal overflow.
  Worked reference builds: `examples/`.

# Zilliqa Brand Identity

Canonical brand system extracted from Figma **"Zilliqa - Brand Assets - Latest"**.
Use these exact values and bundled assets — never invent or approximate brand colors,
fonts, or logo artwork.

All assets live under this plugin at `${CLAUDE_PLUGIN_ROOT}/assets/`.

## Colors

7 official brand colors. Hex is authoritative (matches the Figma swatch fills).

| Token | Name | Hex | RGB | CMYK | Role |
|-------|------|-----|-----|------|------|
| `teal` | Zilliqa Teal | `#00d0c6` | 0, 208, 198 | 66 / 0 / 31 / 0 | Primary — accents, CTAs, highlights, links |
| `pine` | Pine | `#2b9297` | 43, 146, 151 | 79 / 25 / 40 / 2 | Secondary teal, hover/darker accent |
| `deep-ocean` | Deep Ocean (Purple-Dark) | `#26067c` | 38, 6, 124 | 99 / 100 / 14 / 14 | Dark brand backgrounds, deep contrast |
| `light-deep-ocean` | Light Deep Ocean (Purple-Light) | `#391ebc` | 57, 30, 188 | 87 / 88 / 0 / 0 | Gradient partner, lighter purple |
| `grey` | Light Gray | `#dcddde` | 220, 221, 222 | 0 / 0 / 0 / 15 | Borders, muted surfaces |
| `black` | Black | `#000000` | 0, 0, 0 | — | Text, dark surfaces |
| `white` | White | `#ffffff` | 255, 255, 255 | — | Backgrounds, text on dark |

> Data note: the Figma "Grey" label text reads `#d7d7d7`, but the swatch fill, paint
> style, and RGB callout all resolve to `#dcddde`. Use `#dcddde`.

Tokens are provided as code in `assets/tokens/`:
- `zilliqa-tokens.json` — design-tokens format (colors, gradients, type)
- `zilliqa-colors.css` — CSS custom properties (`--zq-*`)
- `zilliqa.tailwind.js` — Tailwind `theme.extend` fragment (`zilliqa.*` colors, `font-montserrat`, gradient utilities)

## Typography

- **Brand font: Montserrat** — all headings and body copy, in every medium.
- Weights: Light (300) · Regular (400) body · Medium (500) / SemiBold (600) / Bold (700)
  for headings & emphasis · ExtraBold (800) sparingly, for the heaviest display emphasis.
  300 and 800 were ratified 2026-07-30.
- **Interface font: Instrument Sans** — ratified 2026-07-30, scoped to **interface controls
  only**: buttons and primary nav items. Never for headings, body copy, print, or brand
  assets. Regular (400) is the weight in production.
- Wired as `font-montserrat` and `font-instrument` in the Tailwind fragment; `--zq-font`
  and `--zq-font-ui` in CSS.

## Logo

Vector logos in `assets/logo/` (1080×1080 marks, 2080×638 wordmarks):

| File | What | Use on |
|------|------|--------|
| `zilliqa-icon-teal.svg` | Icon mark (3-tone teal) | Light backgrounds |
| `zilliqa-icon-black.svg` | Icon mark, mono black | Light backgrounds, print |
| `zilliqa-icon-white.svg` | Icon mark, mono white | Dark / teal / image backgrounds |
| `zilliqa-full-teal.svg` | Full wordmark, teal | Light backgrounds |
| `zilliqa-full-black.svg` | Full wordmark, black | Light backgrounds, print |
| `zilliqa-full-white.svg` | Full wordmark, white | Dark / teal backgrounds |

Rules: pick the variant that maximizes contrast with its background; keep clear space
around the mark; never recolor, stretch, rotate, or add effects to the logo. The teal
mark is built from three teal shades (`#4dbbba` / `#2b9297` / `#05707e`) — that is intentional, don't flatten it.

## Gradients

The signature Zilliqa gradient runs **Teal → Light Deep Ocean → Deep Ocean**:

```css
background: linear-gradient(135deg, #00d0c6 0%, #391ebc 55%, #26067c 100%);
/* or: var(--zq-gradient) / Tailwind: bg-zilliqa-gradient */
```

A second decorative **spectrum line** (teal→magenta→purple, 9 stops) is available as
`assets/gradients/zilliqa-gradient-line.svg` and as `--zq-gradient-spectrum` /
`bg-zilliqa-spectrum`. Swatch preview: `assets/gradients/zilliqa-gradient-primary.svg`.

The Figma file also ships 36 raster gradient renders (`Gradient-dark-1..18`,
`Gradient-light-1..18`, 4096×2305 PNG) for hero/marketing backgrounds — pull those from
Figma directly when a photographic gradient is needed rather than the CSS approximation.

## Icons

~50 brand icons in `assets/icons/` as SVG (1080-grid, kebab-case names): `home.svg`,
`settings.svg`, `security.svg`, `network.svg`, `wifi.svg`, `document.svg`, `mail.svg`,
`star.svg`, `wallet`/`capital.svg`, `monitor.svg`, plus Zilliqa product icons
(`liquidity-provision-*`, `web3-loyalty-*`, `p2p-social-layer-*`, `game-economy-design-*`,
`platform-as-a-service-*`). Recolor via `currentColor`/`fill` to match context.

## Applying the brand

Three values split by medium — **accent hover**, **depth**, and **feature backgrounds**.
The UI layer below is the authority for web and product UI; the sections above govern
print and brand-asset work.

| | Web / product UI | Print / brand assets |
|---|---|---|
| Accent hover | Mint `#6fffc2` | Pine `#2b9297` |
| Depth | black and near-black surfaces | Deep Ocean `#26067c` |
| Feature backgrounds | teal atmospherics | the signature gradient |

Everything else is the same in both: Montserrat for headings and body, the unaltered logo
variant with the best background contrast, and tokens wired from `assets/tokens/` rather
than hex repeated by hand.

## UI layer

Source: live zilliqa.com (Next.js + Webflow), extracted 2026-07-29 — resolved CSS custom
property values and painted computed styles from `/` and `/roadmap`, not a published style
guide. Both pages resolve to the same system, so these are platform choices rather than
one template's styling.

**Precedence rule:** when building, styling, or reviewing web or product UI, the values in
this UI layer govern. When producing print, decks, or brand-asset work (logo files, palette
swatches, the gradient asset itself), the Figma **"Zilliqa - Brand Assets - Latest"** file
governs instead. Figma stays canonical for the 7 brand colors, the logo, and Montserrat in
*every* context — this layer adds a web-specific application on top, it does not replace them.

This section is additive to the Colors and Typography sections above. The final two
subsections record exactly where the two sources disagreed and how each was resolved, plus
the web UI palette ratified by the brand owner on 2026-07-30.

### Surfaces, elevation and motion

**Dark-first surface model.** Black is the default canvas for Zilliqa product UI, not an
alternate mode. Build on `#000000` first; treat any light variant as the exception.

| Surface | Use |
|---|---|
| `#000000` | Base page surface — default for any full-bleed section or app shell |
| `#1f1f1f` | Elevated surface — cards, modals, raised panels, without reaching for a shadow |
| `rgb(12, 12, 16)` | Neutral near-black section surface |
| `rgb(7, 16, 15)` | Teal-shifted near-black — a section that wants brand tint while staying effectively black |
| `rgba(255,255,255,0.03)` / `0.05` | Subtle panels — two steps of "barely off the base black" |
| `rgba(0,208,198,0.06)` | Flat teal wash — the lightest brand-tinted fill |
| `rgba(0,208,198,0.10)` / `0.12` | Teal wash panel — feature/callout blocks that read as on-brand without a saturated fill |
| `rgba(10,10,12,0.85)` + `backdrop-filter: blur(12px)` | Fixed/sticky bars floating over scrolling content |

Do not default to white or light-grey page backgrounds for product UI. Reach for `#1f1f1f`
before inventing a new grey.

**Elevation = rings, not shadows.** Depth is drawn with inset hairlines. On a black canvas
drop shadows are near-invisible and wasted — do not add coloured or glowing drop shadows to
imply elevation.

| Surface | Recipe |
|---|---|
| Card | `inset 0 0 0 1px rgba(255,255,255,0.2)` — plus `0 2px 4px rgba(0,0,0,.1)` and a larger faint `rgba(0,0,0,.15)` shadow that barely reads; the ring does the work |
| Teal-accented panel | `inset 0 0 0 1px rgba(0,208,198,0.16)` — stronger tier: `rgba(0,208,198,0.2)` |
| Solid ring | `inset 0 0 0 1px #ffffff` or `inset 0 0 0 1px #000000` |
| Nav / floating bar | `backdrop-filter: blur(12px)` in place of any shadow |

Pick elevation by ring weight and tint, not by shadow size. If you are about to write a
`box-shadow` to communicate "this is raised" — use an inset ring instead.

**Atmospherics instead of the signature gradient.** The signature 135° teal→purple gradient
is not painted anywhere on the live site. It is **not deprecated** — it stays canonical for
brand/marketing surfaces and print. For dark product/web UI prefer low-alpha teal over black:

```css
/* directional sheen — section backgrounds, hero fields */
linear-gradient(160deg, rgba(0,208,198,0.06), rgba(0,208,198,0) 55%);

/* top-of-section glow — draws the eye to the top of a section */
radial-gradient(120% 70% at 50% 0,
  rgba(0,208,198,0.14) 0,
  rgba(0,208,198,0.04) 32%,
  rgba(0,208,198,0) 60%);
```

Both are single-hue teal fades over black, not saturated multi-hue fills. Rule of thumb:
signature 135° gradient → brand/marketing and print. Low-alpha teal sheen/glow → product and web.

**Motion.** Four duration tiers, each tied to what is animating. All use `ease`.

| Duration | Properties | Use for |
|---|---|---|
| 0.15s | `color`, `border-color`, `opacity` | text/link/border colour changes, simple fades |
| 0.20s | `transform`, `box-shadow` | hover lifts, small scale/translate moves |
| 0.25s | `opacity, transform, visibility, background-color, box-shadow` | composite state changes |
| 0.45s | `all` | hero and other large composite moves |

Match duration to what is changing, not to how important the element is: a single colour
swap gets 0.15s even on a hero; reserve 0.45s for large-surface or hero-scale motion.
Honour `prefers-reduced-motion: reduce` — any motion added must degrade under it.

### Layout, spacing and rhythm

**Spacing scale** (rem) — use these steps only; round to the nearest step rather than
introducing a new value:

`0.25 · 0.5 · 0.75 · 1 · 1.25 · 1.5 · 1.75 · 2 · 3 · 4 · 5 · 6 · 7 · 8`

Gap tokens: `xxs` 0.5 · `xs` 1 · `sm` 2 · `md` 3 · `lg` 4 · `xl` 5 · `xxl` 6 (rem).
Button padding `1em 1.5em` (painted 12px 24px) · input padding `1rem` · tag padding `0.25rem 0.5rem`.

**Vertical rhythm.** Section and card padding are separate scales, both stepping down
responsively — do not hold a fixed padding across viewports:

| | Desktop | Tablet | Mobile-L | Mobile-P |
|---|---|---|---|---|
| Section padding | 8rem | 7rem | 6rem | 2rem |
| Card padding | 3rem | 2rem | 1.5rem | 1.5rem |

**Containers.** Default 1280px · `lg` 1440px · `sm` 1000px · horizontal padding 1rem ·
nav height 4rem. Default to 1280px unless the section is a wide feature band (1440) or a
narrow reading column (1000).

**Breakpoints:** `479` · `600` · `767` · `991/992` · `1440`. Use `(hover: hover)` as a
capability query to gate hover-only affordances, rather than a width query alone.

**Type scale** — rem-based, 1.25 (major third). Steps are discrete per breakpoint, not
fluid `clamp()` interpolation:

| Level | Desktop | Tablet | Mobile-L | Mobile-P | Line-height | Tracking | Weight | Margin-bottom |
|---|---|---|---|---|---|---|---|---|
| h0 | 3.81rem | 3.05 | 2.44 | 1.95 | 1.04em | -.01em | 400 | .3em |
| h1 | 3.05rem | 2.44 | 1.95 | 1.56 | 1.04em | -.01em | 400 | .3em |
| h2 | 1.95rem | 1.56 | 1.25 | 1.00 | 1.04em | -.01em | 400 (painted 700) | .35em |
| h3 | 1.56rem | 1.25 | 1.00 | 0.80 | 1.04em | -.01em | 400 (painted 500) | .5em |
| h4 | 1.25rem | 1.13 | 1.01 | 0.91 | 1.3em | -.01em | 500 | .5em |
| h5 | 1.00rem | 1.00 | 1.00 | 1.00 | 1.3em | 0 | 400 | .7em |
| h6 | 0.80rem | 0.80 | 0.80 | 0.80 | 1.3em | **+.1em** | 400 | .7em |

h0–h3 are the display tier (1.04em leading, -.01em tracking). h4–h6 are the text tier
(1.3em leading). h6 is the only level with positive tracking — reserve it for label and
eyebrow-adjacent headings, never body copy.

Body sizes, all 1.6em line-height and 0 tracking: `sm` 0.88 · base 1 · `lg` 1.13 ·
`xl` 1.5 · `xxl` 2rem. Base margin-bottom `.7em`. Eyebrow: 0.9rem / 1.3em / +.01em, body font.

**Measure** (derived from observed widths, not asserted by the site): cap prose around
**860px** when set in `lg` (1.13rem) and around **640px** when set in `sm` (0.88rem).
The observed 272px column is a narrow list/label column, not a prose measure.

### Component patterns

The sharp/pill tension is deliberate — apply it, don't soften it. **Containers (cards,
panels, nav) stay square (`radius: 0`). Actions (buttons) stay full pill (`radius: 2.5rem`).**
Never round a card to match a button, never square off a button to match a card.

```css
/* Button — primary (teal). Black label is a contrast requirement, not a style choice. */
.btn-primary {
  background: #00d0c6;
  color: #000000;
  border-radius: 2.5rem;   /* 40px painted */
  padding: 1em 1.5em;      /* 12px 24px painted */
  border: none;
}
.btn-primary:hover { background: #6fffc2; }   /* live value — see Divergences */

/* Button — secondary (ghost on dark) */
.btn-secondary {
  background: transparent;
  color: #ffffff;
  border-radius: 2.5rem;
  padding: 1em 1.5em;
  box-shadow: inset 0 0 0 1px #ffffff;   /* ring, not a border */
}

/* Card — sharp, ring-elevated */
.card {
  border-radius: 0;
  padding: 3rem;                         /* tablet 2rem, mobile 1.5rem */
  background: rgba(255,255,255,0.03);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2);
}
.card--teal {
  background: rgba(0,208,198,0.10);
  box-shadow: inset 0 0 0 1px rgba(0,208,198,0.16);
}

/* Nav — translucency and blur do the separation, never a shadow */
.nav {
  height: 4rem;
  background: rgba(10,10,12,0.85);
  backdrop-filter: blur(12px);
  box-shadow: none;
}

.input { border-radius: .25rem; padding: 1rem; }
.tag   { border-radius: .25rem; padding: .25rem .5rem; }
```

Anything sitting on a teal fill takes **black** text — never white, never teal-tinted.
Text links: teal `#00d0c6` **on dark surfaces only**, hovering to `#6fffc2`; on light
backgrounds use Pine `#2b9297` and see Contrast below.

### Navigation and scroll behaviour

The nav is **persistent and translucent** — `position: sticky`, 4rem tall,
`rgba(10,10,12,0.85)` over `backdrop-filter: blur(12px)`, no shadow and no solid fill.
It overlays scrolling content rather than displacing it, which has consequences the rest
of the page has to account for:

- **Offset every scroll target by the nav height.** A sticky overlay hides anchor
  destinations unless you compensate. Set `scroll-padding-top: 4rem` on the scroll
  container (derived from `--zq-nav-height`, not asserted by the site) so in-page links,
  skip links, and focus-driven scrolling land below the bar rather than behind it.
- **Never let the blur sit on an opaque parent.** `backdrop-filter` only reads against
  content scrolling underneath; giving the nav a solid background defeats the effect and
  flattens the depth model.
- **Keep the bar's contents on the text ramp,** not pure white — inactive nav links sit at
  `rgba(255,255,255,.7)`/`.82` and resolve to `#ffffff` on hover or when current.

**Responsive behaviour.** Breakpoints are `479 / 600 / 767 / 991-992 / 1440`. Below 992px
the horizontal nav must stop competing for width — collapse it, or let it scroll
horizontally, but never let links wrap into a second row and push the 4rem bar taller;
the nav height is a layout constant other offsets are derived from.

**Gate hover affordances behind capability, not width.** Use `@media (hover: hover)` for
anything that only exists on hover — the live site uses `(hover: hover) and (min-width: 992px)`.
A touch device at desktop width still has no hover, so a width query alone strands the
affordance.

**Honour `prefers-reduced-motion: reduce`.** It is respected on the live site. Anything
scroll-linked — smooth scrolling, progress indicators, parallax, reveal-on-scroll — must
degrade to an instant, static equivalent rather than being merely shortened.

**Reaching for sticky beyond the nav** (section headers, table headers, sidebars, a
long-form contents rail) is consistent with the system, with two rules: stack the offsets
from the nav height so sticky elements never overlap each other, and keep the same
ring-based separation — a sticky element earns its edge from an `inset 0 0 0 1px` hairline
or a blur, never from a drop shadow.

### Contrast and focus

Teal `#00d0c6` is a **surface colour, not a text colour** on light backgrounds. Teal-on-white
is 1.94:1 — fails AA at every size and fails non-text minimums. Never set teal body text,
links, or icon fills on white or light surfaces.

Black-on-teal is 10.84:1 (AAA both directions). That is why teal buttons carry **black**
labels. Teal-as-text is valid only on black or near-black: `#000000` 10.84:1 ·
`#1f1f1f` 8.51:1 · `rgb(7,16,15)` 9.91:1.

When a light background needs a teal-family accent, use **Pine `#2b9297`** (3.71:1 on white):
passes AA large text (≥24px, or ≥18.66px bold) and non-text UI (borders, icons) — it does
**not** pass AA body copy. Use it for large headlines, stat numbers, icon strokes, border
accents; never paragraph or label text.

**Dark-surface text ramp** — use alpha rather than duplicate hexes; all four clear AA:

| Alpha | Ratio on black | Use |
|---|---|---|
| `rgba(255,255,255,.9)` | 16.83:1 | primary text, headings |
| `rgba(255,255,255,.82)` | 13.75:1 | secondary / body |
| `rgba(255,255,255,.7)` | 10.02:1 | tertiary, captions, metadata |
| `rgba(255,255,255,.6)` | 7.37:1 | muted, hints |

**Focus ring — mandatory, verbatim:**

```css
:focus-visible {
  outline: 2px solid #00d0c6;
  outline-offset: 3px;
  border-radius: 2px;
}
```

Apply to every focusable element. Never override with `outline: none` / `outline: 0`.

> **Known defect — do not copy.** The live site's Webflow defaults strip focus outlines
> (`outline: 0`) on nav links, dropdowns, tabs, and slider controls. That is a live
> accessibility bug, not a pattern. The rule above overrides it everywhere, including the
> components the live site currently fails to style.

Approved pairings:

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `#000000` | `#00d0c6` | 10.84:1 | Do — buttons, chips, badges |
| `#00d0c6` | `#000000` | 10.84:1 | Do — text/icons on black |
| `#00d0c6` | `#1f1f1f` | 8.51:1 | Do — on elevated dark surface |
| `#00d0c6` | `#ffffff` | 1.94:1 | **Don't** — never teal text on white |
| `#2b9297` | `#ffffff` | 3.71:1 | Do (large text / non-text only) · Don't (body copy) |
| `#6fffc2` | `#000000` | 16.76:1 | Do — hover/accent text on black |
| `#6fffc2` | `#00d0c6` | 1.55:1 | **Don't** — never mint on teal, any size |
| `#ffffff` | `#26067c` | 15.01:1 | Do — text on Deep Ocean |
| `#ffffff` | `#854be8` | 5.04:1 | Do — text on the live purple |

### Open gap: no semantic status palette

The system has **no ratified colours for error, warning, or success.** Neither the Figma
file nor the live site defines them, and the ratified web palette deliberately does not
repurpose Mint, Lime or Lilac for status — they are accent roles, and overloading them
would make "hover" and "destructive" the same signal.

Until a status palette is ratified, when a screen genuinely needs one:

- Do **not** reach for Lime or Mint as a warning. Do not invent a red and commit it to
  `tokens.json`.
- Use a provisional value, state its contrast, and flag it for ratification. The worked
  example uses amber `#ffb020` — **11.48:1** on black, and it collides with none of teal
  (10.84), mint (16.76), lime (18.05) or lilac (7.54). See
  `examples/app-frames-recovery.html`.
- Express status as a **panel** — ring, wash and icon — rather than coloured body text
  alone. On a dark canvas, colour alone is a weak signal and fails users who cannot
  distinguish it.

### Divergences from the Figma brand file

Six conflicts, all resolved. Web values are ratified where marked; the Figma value stays
canonical for print in every row.

| Figma says | Live site does | Resolution |
|---|---|---|
| Hover = Pine `#2b9297` | `#6fffc2` | Mint ratified for web |
| Deep Ocean / Light Deep Ocean for depth | absent; purple is `#ab87f7` / `#854be8` | Lilac and Violet ratified as the web secondary accent; web depth is near-black surfaces |
| "Montserrat everywhere" | Instrument Sans on buttons and primary nav | Instrument Sans ratified for interface controls only |
| Signature 135° gradient for heroes | not painted; teal sheen and glow instead | Atmospherics for web |
| Teal for CTAs, highlights, links | teal is a fill with black text | Teal is a surface for web — see Contrast and focus |
| Weights 400–700 | 300 and 800 also in use | Both ratified; the range is now 300–800 in every medium |

### Ratified web UI palette

**Ratified by the brand owner on 2026-07-30.** These are in production on zilliqa.com and
are now approved brand values for **web and product UI**. Use them freely when originating
new work — they are no longer "observed", they are brand.

| Token | Name | Hex | RGB | Role | Contrast |
|-------|------|-----|-----|------|----------|
| `mint` | Mint | `#6fffc2` | 111, 255, 194 | Primary accent hover — replaces Pine as the web hover state | 16.76:1 on black · **never on teal** (1.55:1) |
| `lilac` | Lilac | `#ab87f7` | 171, 135, 247 | Secondary accent — text and accents on dark | 7.54:1 on black |
| `violet` | Violet | `#854be8` | 133, 75, 232 | Secondary accent fill — full-bleed sections, tint base | white on it 5.04:1 |
| `lime` | Lime | `#d2ff02` | 210, 255, 2 | Accent-text hover on dark (used at 60% alpha) | 18.05:1 on black |

They are held in a separate `uiColor` token group rather than folded into the canonical
7 above, for one reason: they have no Figma swatch and therefore **no CMYK**. Print and
brand-asset work still uses the 7-color table. Names are descriptive labels assigned at
ratification, not Figma names.

Wire them from `assets/tokens/` (`--zq-mint`, `--zq-lilac`, `--zq-violet`, `--zq-lime`;
Tailwind `zilliqa.mint` etc.) rather than hardcoding hex.

Two hard limits carry over from the contrast work:

- **Mint is never used on teal** — 1.55:1. It is a hover state *on dark*, not a fill partner.
- **Lime is an accent-text hover on dark only**, at ~60% alpha as the site uses it. It has
  no approved use as a fill.

**Instrument Sans** is likewise ratified, scoped to **interface controls only** — buttons
and primary nav items. Headings and body copy remain Montserrat; see Typography.
**Montserrat 300 and 800** are ratified as part of the weight range.

## Refreshing from Figma (Conductor MCP)

Against "Zilliqa - Brand Assets - Latest":
1. `get_local_styles` → paint style names
2. `get_page_structure` on **Colors** (`1:327`) → labeled hex/RGB/CMYK
3. `get_node_info` on any TEXT node → confirms `fontName` (Montserrat)
4. `export_as_svg` on Logo components (`Logo-Component` 1:326) and icon variants (component set `3:57`)
5. `get_page_structure` on **Gradients** (`2:2`) → gradient inventory
