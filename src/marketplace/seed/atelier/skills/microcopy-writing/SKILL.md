---
name: microcopy-writing
description: Write ui microcopy including button labels, empty states, error messages, tooltips, form labels, and onboarding strings. Use whenever the user mentions microcopy, ui strings, button text, error messages, empty states, tooltips, form labels, or any short interface text.
---

# microcopy-writing

microcopy is the text inside a ui. it's read in the moment of doing something, not in the moment of being marketed to. write accordingly.

## the principles

### action verbs for buttons

what's the action? lead with that.

- "save changes" not "ok"
- "delete file" not "yes"
- "send invite" not "submit"

### plain language for errors

errors should tell the user what happened and how to recover. not what the code did.

- bad: "ERR_NETWORK_FAILURE: connection refused"
- good: "we couldn't reach your server. check the address and try again."

### specific empty states

empty states are an onboarding moment. tell the user what to do to fill the space.

- bad: "nothing here yet"
- good: "no invoices yet. create your first one to start tracking payments."

### respect

- no "oops" or "uh oh"
- no exclamation points unless something is genuinely worth celebrating
- no "please" before actions the user already chose to take
- don't blame the user
- don't infantilize

### consistency

decide patterns and follow them across the product:

- if one error starts with "we couldn't", they all should
- if one button is "save changes", another isn't "update" for the same action
- if one empty state has an illustration, similar ones do too

## common microcopy types and patterns

### button labels

- start with a verb in imperative form
- end with the object when ambiguity is possible ("save draft" not just "save")
- keep under 3 words where possible
- destructive actions get distinct language ("delete forever", "discard changes")

### empty states

- name what's missing
- name what creates it
- one-line cta to start
- optional: link to docs or a sample

### error messages

- what happened (one sentence)
- what to do about it (one sentence)
- option to retry or escape

### form field labels

- label every field. don't rely on placeholder.
- be specific: "email address" not "email"; "card number" not "number"
- inline help text below the field when needed
- required vs optional shown consistently

### confirmation dialogs

- name the action being confirmed in the title
- describe the consequence (especially if it's irreversible)
- confirm button repeats the action verb
- cancel button is clear ("cancel" or "keep [thing]")

### loading and progress states

- "loading..." is the floor, not the ceiling
- if it might take more than 2 seconds, name what's happening
- if it might take more than 10 seconds, show progress or estimated time

### success states

- confirm the action happened
- show what to do next
- avoid celebrating routine actions

### onboarding

- short. each step has one focus.
- skip-able. respect that some users know what they're doing.
- never start with "welcome!" alone. start with what the user can do next.

## output (per string)

```
context: [where it appears in the ui]
purpose: [what it tells the user]
constraints: [character limit, tone, voice match]
audience: [who reads this]

drafts
  a: [version 1]
  b: [version 2]
  c: [version 3]

recommendation: [a / b / c with one-sentence rationale]
```

## what to avoid

- placeholder text doubling as a label
- error messages that blame the user without offering a fix
- "are you sure?" without context
- starting onboarding with "welcome!"
- mixing tone across the product (warm in some places, clinical in others)
- microcopy that requires footnote-style explanation to understand
