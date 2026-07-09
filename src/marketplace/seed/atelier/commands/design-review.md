---
name: design-review
description: run a structured critique on a design
---

# /design-review

trigger the design-review skill to evaluate a screen, component, or flow.

## what it does

runs a 7-check pass: hierarchy, spacing, type, color, alignment, density, affordance.

returns: per-check status (pass / concern / fail) and top 3 changes to make.

## how to use

```
/design-review
```

then share the design (figma link, screenshot description, file path, or pasted content). include:

- what this screen is for
- who the user is
- what action they're trying to take

## what it doesn't do

- redesign your work
- recommend a different aesthetic
- give vague feedback
