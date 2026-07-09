---
name: dark-mode-pairing
description: Design a dark mode that pairs with an existing light mode, including color mapping, contrast adjustments, and surface elevation. Use whenever the user mentions dark mode, dark theme, theme switching, or wants to add dark mode to an existing design.
---

# dark-mode-pairing

dark mode is not "invert the light mode". it's a parallel design with its own rules.

## the principles

1. **dark mode shouldn't fight the eye**. pure black on backgrounds is harsh; off-black reads better.
2. **surfaces elevate by getting lighter**, not darker. opposite of light mode.
3. **shadows lose much of their work**; outlines and surface lightness do more of it.
4. **color saturation drops** for ui elements; full-saturation hues feel too loud against dark backgrounds.
5. **text contrast is calibrated by feel**, not by ratio alone. true white on true black is too sharp; off-white softens it.

## color mapping

for each light-mode token, define a dark-mode counterpart:

```
background
  light: #ffffff
  dark:  #0a0a0c (off-black, slight cool tint)

surface (cards, panels)
  light: #fafafa
  dark:  #15151a (one elevation up)

surface elevated (modals, popovers)
  light: #ffffff (above background)
  dark:  #1f1f25 (two elevations up)

text primary
  light: #111
  dark:  #f0f0f3

text secondary
  light: #555
  dark:  #a8a8b0

border
  light: #e5e5e8
  dark:  #2a2a32

accent (brand color)
  light: full saturation
  dark:  reduce saturation 10-20%, increase lightness 5-10%

semantic colors (success, warning, error, info)
  each gets its own dark variant. usually less saturated, slightly lighter.
```

## shadows

in dark mode, shadows are subtle and often replaced by surface elevation. use a 1px lighter border on the top edge of elevated surfaces as a substitute for the top highlight that natural light would create.

## images and media

- pure white images need a wrapper with a subtle tint or padding
- logos may need a dark-mode variant (not always; test)
- charts and data viz almost always need separate palettes

## things that break in dark mode

- pure black backgrounds on oled screens look great but make subtle borders disappear
- screenshots of light-mode interfaces inside a dark-mode page (provide light backdrops)
- code blocks (need their own dark theme)
- third-party embeds (iframes don't inherit your theme)

## test list

before shipping:

- contrast check every text/background pair (4.5:1 body, 3:1 large)
- check focus rings (dark backgrounds need brighter rings)
- check chart and graph colors (light mode palettes don't translate)
- check images that have transparent backgrounds (they may bleed into dark backgrounds in unexpected ways)
- check loading skeletons (they need their own dark variant)
