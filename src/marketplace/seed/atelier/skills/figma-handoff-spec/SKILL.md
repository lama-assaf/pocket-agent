---
name: figma-handoff-spec
description: Generate a developer handoff spec from a Figma file or design. Use whenever the user mentions handoff, dev handoff, figma handoff, design to code, or needs a structured spec for engineers to implement a design.
---

# figma-handoff-spec

turn a design into a structured spec engineers can implement without round-trips.

## inputs

- figma file or detailed design description
- target stack (react / vue / svelte / native / web components)
- design system in use, if any

## what a complete handoff includes

### 1. component inventory

list every distinct component in the design. for each:

- name (using the team's naming convention)
- variants present (sizes, states, themes)
- whether it exists in the design system or is new

### 2. tokens used

extract every token referenced:

- colors with token names
- spacing with token names
- type styles with token names
- radii, shadows, z-indices

### 3. layout spec

per screen or component:

- container: max-width, padding, margin
- grid: columns, gaps, breakpoints
- alignment rules

### 4. interaction spec

- states: default, hover, focus, active, disabled, loading, error, empty
- transitions: duration, easing, properties
- micro-animations: trigger, behavior

### 5. responsive behavior

- breakpoints with intent (mobile-first or desktop-first)
- what changes at each breakpoint (layout, sizes, hidden elements)

### 6. content rules

- min and max character counts for text fields
- truncation rules
- localization considerations

### 7. data shape

- what data each component needs
- loading and empty states with sample data

## output

a single markdown file per screen or major component, structured as above.

## what this does not produce

- the code itself (that's a separate task)
- visual design decisions (those happen before handoff)
- placeholder content (use real strings or labeled stand-ins)
