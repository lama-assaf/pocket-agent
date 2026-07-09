---
name: brand-identity-audit
description: Audit a brand's full identity (logo, typography, color, voice, visual language) for consistency, distinctiveness, and gap. Use when the user asks for a brand audit, identity review, brand health check, or wants to evaluate how a brand shows up across surfaces.
---

# brand-identity-audit

audit a brand identity across every surface it shows up on. find drift, find gaps, find what's distinctive and what's interchangeable.

## what this skill does

inventories every visible expression of the brand. measures consistency. finds points of drift. names what's distinctive vs generic.

## when to use

- a brand has been running for 12+ months without a structured review
- after a redesign that touched multiple surfaces
- before a launch that puts the brand in front of new audiences
- when leadership says "the brand feels inconsistent" but can't name where

## inputs required

before running the audit, collect:

1. **the canonical brand assets**: logo files, type specimens, color tokens, voice guide (if one exists)
2. **the live surfaces**: homepage, app, marketing site, social, ads, email templates, support docs, sales decks, recruiting pages
3. **the audiences each surface targets**: brand surfaces serve different audiences and may legitimately vary

if the canonical assets don't exist yet (or are scattered), say so. an audit needs a baseline.

## the audit

inspect each axis. capture distinct values and any drift.

### 1. logo

- what variants exist (full, mark, monochrome, inverted)?
- which surfaces use which variants?
- minimum size violations?
- clear-space violations?
- positioning consistency (always top-left? sometimes centered?)

### 2. typography

- which typefaces are in use? compare canonical vs actual.
- type scale: does it match the system? off-scale uses?
- weight usage: is hierarchy consistent (display = bold, body = regular)?
- line-height patterns?
- letter-spacing patterns?

### 3. color

- which hex values appear? group near-duplicates.
- which surfaces use which palette subset?
- accent color usage: consistent or random?
- contrast: any AA / AAA failures?

### 4. spacing and layout

- grid adherence
- section spacing patterns
- container widths

### 5. imagery and illustration

- photography style (lit, color-graded, candid, etc.)
- illustration system (if any)
- iconography (one set or many?)
- ai-generated imagery (worth a separate review pass)

### 6. voice

- run brand-voice-extraction on samples from each surface
- compare extracted voice against canonical guide (if one exists)
- name surfaces where voice is strongest, weakest, most off

### 7. motion (if applicable)

- transition durations
- easing curves
- where motion appears vs where it doesn't

### 8. naming and terminology

- product feature names: consistent across surfaces?
- terminology variants ("dashboard" vs "home" vs "overview"?)
- internal vs external terminology bleeding through?

## output shape

```
brand identity audit — [brand name]

executive summary
- distinctive (the 3-5 things this brand owns)
- generic (the 3-5 things any competitor could say or show)
- drift severity: low / medium / high
- top 5 fixes

surface-by-surface
[for each surface]
  - logo: [score / notes]
  - typography: [score / notes]
  - color: [score / notes]
  - voice: [score / notes]
  - off-canonical findings

axis-by-axis drift
[for each axis]
  - canonical: [the reference]
  - actual: [what's in the wild]
  - severity: [low / med / high]
  - affected surfaces: [list]
  - proposed resolution

recommended actions
  - immediate (must fix before next ship): [list]
  - quarterly cleanup (worth scheduling): [list]
  - strategic (requires a decision, not just execution): [list]
```

## scoring rubric

per axis, score 1-5:

- 5: canonical and consistent across every surface
- 4: canonical with isolated drift (single surface)
- 3: drift across multiple surfaces, no clear pattern
- 2: more drift than consistency
- 1: no canonical version evident; every surface is its own brand

## rules this skill follows

- don't judge what's distinctive without comparison; pull at least 2 competitors
- "feels off" is not a finding; name the specific axis and surface
- voice drift is often the worst kind because no one notices until someone outside does
- consistency for its own sake isn't the goal; coherence in service of recognition is

## what this skill doesn't do

- redesign the brand (that's downstream of this)
- write a new voice guide (use brand-voice-extraction)
- judge taste (it measures coherence; aesthetics are out of scope)
- prescribe colors or fonts (it surfaces drift; design decisions happen separately)

## related

- brand-voice-extraction (voice audit, more focused)
- design-system-audit (technical token / component drift, separate concern)
- messaging-architecture (verbal positioning, separate axis)
