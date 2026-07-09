---
name: motion-direction
description: Define motion principles, easing curves, durations, and interaction behaviors for a design system or product. Use whenever the user mentions motion design, animation principles, easing, transition timing, micro-interactions, or wants to make a product feel intentional in how it moves.
---

# motion-direction

motion that does work, not motion that decorates.

## the four jobs of motion

1. **continuity** — show where something came from or where it went.
2. **state change** — confirm that something happened or is happening.
3. **hierarchy** — direct attention without screaming.
4. **personality** — express the brand in a few signature moves.

if a motion doesn't do one of these jobs, cut it.

## defaults to start from

### duration

- micro (state toggles, button feedback): 100-150ms
- standard (panel open, page transition): 200-300ms
- deliberate (large surface change, onboarding moments): 400-600ms

motion longer than 600ms needs a reason.

### easing

- linear: only for loading indicators and progress bars
- ease-out: entering elements (decelerating into place)
- ease-in: exiting elements (accelerating away)
- ease-in-out: cross-fades and continuous changes
- custom cubic-bezier: signature moments, used sparingly

### staggering

when multiple elements animate together, stagger by 20-50ms unless the meaning requires them to move as a unit.

## what to specify per interaction

- trigger: what causes it
- properties animated: which css properties or transforms
- duration: in ms
- easing: by name or cubic-bezier values
- delay: if any
- reverse behavior: what happens when the trigger is removed
- reduced-motion fallback: what plays when prefers-reduced-motion is on

## what to avoid

- bouncing every animation
- animating layout properties (width, height) when transform would work
- animations that block interaction
- celebrations that fire on routine actions
- micro-animations on every element (the product feels twitchy)
