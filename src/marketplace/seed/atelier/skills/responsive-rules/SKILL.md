---
name: responsive-rules
description: Define responsive design rules including breakpoints, fluid scales, and what changes per viewport. Use whenever the user mentions responsive design, breakpoints, mobile design, fluid typography, viewport sizing, or wants to design for multiple screen sizes.
---

# responsive-rules

a default set of responsive rules. adjust to your product's traffic mix.

## breakpoints

if traffic is mobile-first, structure breakpoints up from the smallest:

```
xs:  320px (small mobile)
sm:  480px (mobile)
md:  768px (tablet, landscape mobile)
lg:  1024px (small desktop, large tablet landscape)
xl:  1280px (desktop)
2xl: 1536px (large desktop)
```

if traffic is desktop-heavy, start at lg and adjust downward.

## per breakpoint, decide

- **container width**: max-width and side padding
- **column count**: 4 / 8 / 12 grid columns is the standard ladder
- **type scale**: how much does the ramp shift between sizes
- **spacing scale**: same question for spacing tokens
- **navigation**: when does the nav collapse to a hamburger or drawer
- **content priority**: what hides, reorders, or compresses

## fluid sizing

for type and spacing, prefer fluid clamps over breakpoint jumps where it reads well:

```css
font-size: clamp(1rem, 0.5rem + 2vw, 1.5rem);
```

- use fluid for body type, paragraph spacing, container padding
- use breakpoint jumps for headlines, hero sections, where you want intentional weight at scale

## images

- responsive sizes via srcset
- art direction via picture when crops should change at breakpoints
- aspect-ratio css to prevent layout shift

## touch targets

- 24x24px minimum at AA
- 44x44px on mobile is the practical floor

## test list

at minimum, design and test at:

- 360px (smallest common mobile)
- 768px (tablet portrait)
- 1024px (standard desktop / tablet landscape)
- 1440px (common large desktop)
- text scaled 200% (accessibility test)

## what to avoid

- designing only at one breakpoint and praying
- hiding critical content on mobile because it doesn't fit
- bottom-aligned ctas that fall under the mobile browser chrome
- assumed orientation (some users land in landscape on mobile)
