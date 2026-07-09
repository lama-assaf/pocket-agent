---
name: brand-identity
description: audit a brand's full identity across logo, type, color, voice, and visual language
---

# /brand-identity

run a structured audit across every surface a brand shows up on. invokes brand-identity-audit skill.

## what it does

inventories the visible expression of the brand. measures consistency. finds drift. names what's distinctive vs generic.

works across 8 axes: logo, typography, color, spacing, imagery, voice, motion, terminology.

## how to use

```
/brand-identity
```

then provide:

1. canonical brand assets (logo files, type specimens, color tokens, voice guide if one exists)
2. live surfaces to audit (homepage, app, marketing site, social, ads, email, support, sales decks)
3. audiences each surface serves

## output

- executive summary: what's distinctive, what's generic, drift severity, top 5 fixes
- surface-by-surface scorecard (1-5 per axis)
- axis-by-axis drift report
- recommended actions, split by urgency (immediate / quarterly / strategic)

## the test

- can you point to a competitor and name 3 things that make this brand visually distinct? if no, the audit failed to find what's worth keeping.
- can you point to 3 specific surfaces and name where each drifts? if no, the audit was too abstract.

## what this command doesn't do

- redesign the brand
- judge taste (it measures coherence)
- prescribe new colors or fonts

## related commands

- `/voice-extract` — voice audit, narrower scope
- `/system-audit` — technical design system drift
- `/messaging` — verbal positioning architecture
