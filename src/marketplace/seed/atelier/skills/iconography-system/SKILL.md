---
name: iconography-system
description: Design an icon system including stroke, fill, sizes, grid, and consistency rules. Use whenever the user mentions icon system, iconography, icon set, icon library, icon design, or needs icons that feel like they belong together.
---

# iconography-system

an icon system is what makes 200 icons feel like they were made by one person.

## decisions to make upfront

### style

- **outline** (stroked, transparent fill) — clean, neutral, scales well at small sizes
- **filled** (solid, no stroke) — confident, less detailed, reads at small sizes
- **duotone** (two-color, hierarchy within the icon) — adds depth, needs more design effort
- **hand-drawn / illustrated** — strong personality, harder to scale to large counts

pick one as primary. you can add a second for emphasis (e.g. outline default, filled for active state).

### grid

design every icon on the same grid. 24px is the most common base.

within the grid, leave consistent optical padding (usually 2px on each side, so the visual lives in a 20x20 area inside a 24x24 frame).

### stroke

if outline style:
- consistent stroke width across the set (1.5px or 2px at 24px is typical)
- consistent stroke caps (round or butt, not mixed)
- consistent stroke joins (round or miter, not mixed)

### fill rules

- closed shapes have one fill color
- transparent areas where the icon's meaning depends on the negative space

### optical alignment

mathematically centered icons often look off. center optically:

- a circle and a triangle of the same bounding box don't have the same visual center
- icons with vertical emphasis (arrows up/down) center differently than horizontal ones

## sizing tier

```
xs:  16px — inline with body text, dense ui
sm:  20px — buttons, list items
md:  24px — default
lg:  32px — feature areas
xl:  48px+ — empty states, illustrations
```

icons at xs may need a redrawn variant (less detail, thicker stroke proportionally).

## what to avoid

- mixing visual metaphors (some icons are objects, some are concepts, some are actions, without a system)
- using the same metaphor for different meanings (e.g. a gear for "settings" and "system status")
- icons that require text to be understood (you have a labeling problem, not an icon problem)
- inconsistent perspective (some icons in flat front view, some in isometric)
- starting from a free icon set and adding to it (the new ones will always feel different)

## quality bar

every icon should pass:

- recognizable at xs (16px)
- consistent stroke and optical weight at all sizes
- aligned to grid
- works in both light and dark mode
- works at the brand's accent color and at neutral text color
