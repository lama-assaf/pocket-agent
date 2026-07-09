---
name: design-system-audit
description: Audit a codebase or design files for design system health, token drift, and inconsistency. Use whenever the user mentions design system audit, design token drift, design consistency, color drift, spacing drift, or wants to find and consolidate inconsistencies across components.
---

# design-system-audit

extract every distinct design value used across a surface. find drift. propose consolidation.

## when to run this

- when the design system feels theoretical but the product feels inconsistent
- before a redesign, to understand what's actually in use
- after a long sprint when many hands touched the styles

## inputs

- codebase path (CSS, SCSS, styled-components, Tailwind config, design tokens)
- or design files (Figma styles, exported tokens)
- optional: the canonical token set, if one exists

## the audit pass

### 1. extract distinct values

for each category, pull every unique value found:

- colors (hex, rgb, hsl, css vars, named tokens)
- spacing (padding, margin, gap values)
- type (font-size, font-weight, line-height, letter-spacing)
- radius
- shadow
- z-index
- breakpoints

note: extract from actual usage, not from the token file. the gap between defined tokens and used values is the drift.

### 2. cluster near-duplicates

use perceptual distance for colors (CIE76 Lab is the default, not RGB euclidean).

for everything else, cluster within tolerance (e.g. spacing values within 2px, font sizes within 1px).

flag clusters where multiple "almost-the-same" values exist.

### 3. measure grid adherence

for spacing: what percent of values are multiples of 8? of 4? of neither?

### 4. detect type scale

if a clear ratio exists (e.g. 1.25x for major third), report it. flag outliers that don't fit.

### 5. health score

per category: 10 = single canonical token set, no drift. 1 = chaos.

## output

```
colors
  distinct values: N
  clusters with near-duplicates: [list]
  contrast failures (text on bg): [count]
  health: X/10

spacing
  distinct values: N
  on 8px grid: X%
  on 4px grid: Y%
  off-grid outliers: [list]
  health: X/10

type
  distinct sizes: N
  detected scale ratio: [name or "no clear ratio"]
  outliers: [list]
  health: X/10

radius / shadow / z-index: same shape

proposed token set
  colors: [minimum set covering ~90% of usage]
  spacing: [recommended scale]
  type: [recommended ramp]

migration order
  1. [highest leverage change]
  2. [next]
  3. [next]
```

## what this does not do

- automated migration. it produces a report.
- judgment on aesthetics. it measures consistency, not taste.
