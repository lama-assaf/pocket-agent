---
name: microcopy
description: write ui microcopy including buttons, errors, empty states, forms
---

# /microcopy

write ui strings.

## what it does

handles:

- button labels (action verbs)
- empty states (specific, with cta)
- error messages (what happened + what to do)
- form labels and help text
- confirmation dialogs (name the consequence)
- loading and progress states
- success states
- onboarding strings

per string, returns 3 drafts with rationale and a recommendation.

## how to use

```
/microcopy
```

then describe the context, purpose, and constraints (character limits, voice).

## rules it follows

- no "oops" or "uh oh"
- no exclamation points unless something is genuinely celebrating
- no "please" before actions the user chose
- consistency across the product (if one error starts with "we couldn't", they all do)
- placeholder is not a label
