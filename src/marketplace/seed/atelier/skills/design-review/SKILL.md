---
name: design-review
description: Run a structured design critique on a screen, mockup, component, or Figma file. Use whenever the user asks for design review, design feedback, design critique, design check, or wants someone to look at a screen and say what's working and what isn't.
---

# design-review

a structured pass over a single screen or flow. fast, opinionated, prioritized.

## when to run this

- before sharing work for broader review
- after rapid iteration when you've stopped seeing it clearly
- when something feels off but you can't name what

## inputs

- the design (file, screenshot, or detailed description)
- the context: what is this screen for, who is the user, what action are they trying to take
- the brand voice or design system if one exists

## the critique pass

run the seven checks in order. don't skip ahead. notes for the user after each.

### 1. hierarchy

stand back. what's the first thing your eye lands on? is it the most important thing on this screen?

- if yes: pass.
- if no: name what's pulling attention. usually it's a color, a size mismatch, or a visual weight in the wrong place.

### 2. spacing

is the layout on a grid? 8px is the default. 4px is the half-step.

- count distinct spacing values. more than 6 is a sign of drift.
- check rhythm: do similar elements have similar spacing? if a card has 16px padding in one place and 14px in another, name it.

### 3. type

how many sizes and weights are in play?

- look for a ramp. 12 / 14 / 16 / 20 / 28 / 40 is a reasonable scale.
- flag near-duplicates (14 and 15 used interchangeably).
- check line-height. body text usually wants 1.5; headlines 1.1-1.2.

### 4. color

how many distinct values? cluster near-duplicates.

- check text contrast against background (WCAG AA: 4.5:1 for body, 3:1 for large text).
- check that color is not the only signal for state (e.g. an error that's red but has no icon or text).

### 5. alignment

scan vertical edges. do columns line up? do baseline of headers align with adjacent content?

- check optical centering. mathematical centering looks wrong when shapes are asymmetric.

### 6. density

is content fighting for attention, or does whitespace do work?

- if everything is bold, nothing is.
- if everything has a border, the borders stop functioning.

### 7. affordance

is it obvious what's interactive? do buttons look like buttons?

- check hover and focus states if relevant.
- check that destructive actions look different from default ones.

## output shape

```
hierarchy:  [pass | concern | fail] — one sentence
spacing:    [pass | concern | fail] — values to fix
type:       [pass | concern | fail] — sizes to consolidate
color:      [pass | concern | fail] — duplicates and contrast issues
alignment:  [pass | concern | fail] — where it breaks
density:    [pass | concern | fail] — where to breathe
affordance: [pass | concern | fail] — what's unclear

top three to fix:
1. [most impactful change]
2. [second]
3. [third]
```

## what this skill does not do

- redesign. it critiques.
- impose a different aesthetic. it works within the design's intent.
- give vague feedback. every flag has a specific value or location.
