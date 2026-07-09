---
name: accessibility-audit
description: Audit a design or component for WCAG accessibility compliance. Use whenever the user mentions a11y, accessibility audit, WCAG check, contrast issues, keyboard navigation, screen reader support, focus order, or asks if a design is accessible.
---

# accessibility-audit

run a WCAG 2.2 AA audit (or AAA when requested) over a design, component, or page.

## inputs

- the artifact (Figma file, component code, live URL, or screenshot with context)
- target level (AA default, AAA on request)

## the four principles

### perceivable

- **contrast**: body text 4.5:1, large text 3:1, ui components 3:1.
- **text alternatives**: every non-text content has an alt or aria-label.
- **info not by color alone**: states use a second signal (icon, text, pattern).
- **resize**: layout holds at 200% zoom.
- **captions and transcripts**: present or referenced for media.

### operable

- **keyboard reachability**: every interactive element is reachable by Tab.
- **focus visible**: focus ring with 3:1 contrast against adjacent background.
- **focus order**: matches visual order, doesn't jump unexpectedly.
- **no traps**: focus can always escape modals, menus, etc.
- **target size**: 24x24px AA, 44x44px AAA.
- **motion**: animations respect prefers-reduced-motion.

### understandable

- **heading hierarchy**: one h1, no skipped levels.
- **labels**: every form field has a visible label (placeholder alone fails).
- **errors**: identify the field and the fix in plain language.
- **language**: lang attribute set on html.

### robust

- **semantic html**: button for buttons, a for links, ul for lists.
- **aria where needed**: only when html semantics fall short.
- **valid roles**: aria attributes valid for their role.

## output

```
perceivable
  contrast:        [pass | fail with offending pairs and ratios]
  text alts:       [pass | fail with missing items]
  color alone:     [pass | fail with offending states]
  resize:          [pass | fail]
  media:           [pass | n/a]

operable
  keyboard:        [pass | fail with blocked elements]
  focus visible:   [pass | fail with offending elements]
  focus order:     [pass | fail with order issue]
  traps:           [pass | fail with location]
  target size:     [pass | fail with offending elements]
  motion:          [pass | fail with offending animations]

understandable
  headings:        [pass | fail with hierarchy issue]
  labels:          [pass | fail with offending fields]
  errors:          [pass | fail with offending messages]
  language:        [pass | fail]

robust
  semantics:       [pass | fail with locations]
  aria:            [pass | fail with locations]

for every fail:
  WCAG criterion: [e.g. 1.4.3 contrast minimum]
  element: [selector or location]
  fix: [smallest change that resolves it]
```

## what this does not do

- automated remediation. it reports.
- guarantee compliance. machine-checkable issues are caught; human review is still required for context-dependent ones.
