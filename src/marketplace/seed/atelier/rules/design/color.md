# color

## the system

a color system has these layers:

```
brand: 1-2 primary brand colors
neutral: 8-10 grays from white to near-black
accent: 1-3 accent colors for callouts and decoration
semantic: success, warning, error, info (each often has 2-3 variants)
```

## naming

semantic names (background, surface, text-primary, border-default, accent) outlast specific names (gray-600). build the system around semantic tokens.

## contrast

text on background: 4.5:1 minimum (WCAG AA). 7:1 for AAA.
large text (18px+ or 14px bold): 3:1 minimum.
ui components and graphics: 3:1 minimum.

never rely on color alone to convey state. errors get a color and an icon and text.

## perceptual distance

near-duplicate colors confuse the eye. use CIE76 Lab distance to check. delta-e of 3-5 is the threshold below which colors look identical in context.

if your design system has #f5f5f5 and #f4f4f4 used in the same flow, it has drift.

## dark mode

dark mode is a parallel design, not an inverted light mode. see the dark-mode-pairing skill.

key principle: in dark mode, surfaces elevate by getting lighter, not darker.

## tints and shades

don't generate them mechanically. each tint and shade needs a perceptual check at the size and context it's used.

programmatic palettes from a single hex value rarely produce a balanced ramp.

## what to avoid

- pure black (#000) text on white background (too sharp)
- pure white (#fff) text on saturated colored backgrounds (vibrates)
- relying on color hue alone for ui state (colorblind users miss it)
- mixing color systems (some colors from a token system, some hand-picked, in the same surface)
