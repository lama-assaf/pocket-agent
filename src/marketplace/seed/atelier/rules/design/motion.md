# motion

motion does work. it shows continuity, confirms state, directs attention, or expresses personality. if it does none of those, cut it.

## defaults

### duration

- micro (state toggle, button press): 100-150ms
- standard (panel slide, page transition): 200-300ms
- deliberate (large surface change, onboarding moments): 400-600ms

motion longer than 600ms needs a reason.

### easing

- ease-out: things entering (decelerating in)
- ease-in: things leaving (accelerating out)
- ease-in-out: cross-fades and continuous changes
- linear: only for indeterminate progress

### staggering

when multiple elements animate together, stagger by 20-50ms unless they should move as a unit.

## what motion should not do

- bounce by default
- play more than once on the same state
- block interaction
- celebrate routine actions
- fire on every element

## reduced motion

respect prefers-reduced-motion. animations either turn off entirely or become instant state changes when this is set.

a reduced-motion design isn't motion-less. fades and minimal cross-dissolves are usually fine. transforms and bounces should disable.

## performance

animate transform and opacity. these don't trigger layout.

avoid animating width, height, top, left, padding, margin. these do trigger layout and feel laggy.
