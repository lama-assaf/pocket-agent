---
name: system-audit
description: audit a codebase or design files for design system drift
---

# /system-audit

audit design system health. invokes design-system-audit skill.

## what it does

extracts every distinct value used for:

- colors (hex, rgb, hsl, css vars, tokens)
- spacing (padding, margin, gap)
- type (font-size, weight, line-height, letter-spacing)
- radius
- shadow
- z-index

clusters near-duplicates. measures grid adherence. detects type scale. assigns health scores per category.

proposes the minimum token set that covers ~90% of usage.

## how to use

```
/system-audit
```

then point to a codebase or share design files.

## output

```
colors: distinct values, near-duplicates, contrast failures, health X/10
spacing: distinct values, grid adherence, off-grid outliers, health X/10
type: distinct sizes, scale ratio, outliers, health X/10
radius / shadow / z-index: same shape
proposed token set: minimum coverage
migration order: highest-leverage changes first
```

## what it doesn't do

- automated refactoring (it reports, you migrate)
- judge aesthetics (it measures consistency)
