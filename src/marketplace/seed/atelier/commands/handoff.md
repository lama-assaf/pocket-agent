---
name: handoff
description: generate a developer handoff spec from a design
---

# /handoff

turn a design into a structured handoff that engineers can implement without round-trips. invokes figma-handoff-spec skill.

## what it includes

- component inventory (with variants, design system status)
- tokens used (colors, spacing, type, with names)
- layout spec (containers, grid, breakpoints, alignment)
- interaction spec (states, transitions, micro-animations)
- responsive behavior
- content rules (character counts, truncation, localization)
- data shape per component

## how to use

```
/handoff
```

then share the design (figma file or description) and the target stack.

## output

a single markdown doc per screen or major component.

## what it doesn't produce

- code (separate task)
- visual design decisions (those happen before handoff)
- placeholder content (use real strings or labeled stand-ins)
