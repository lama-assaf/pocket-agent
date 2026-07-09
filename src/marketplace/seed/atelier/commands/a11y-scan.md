---
name: a11y-scan
description: audit a design or component for WCAG accessibility
---

# /a11y-scan

run a WCAG 2.2 AA audit on a design, component, or page.

## what it does

four-principle audit:

- perceivable (contrast, alts, color use, resize, media)
- operable (keyboard, focus, target size, motion)
- understandable (headings, labels, errors, language)
- robust (semantics, aria)

for every failure: the WCAG criterion, the offending element, the smallest fix.

## how to use

```
/a11y-scan
```

then share the artifact (figma file, component code, live url, or screenshots with context).

specify level if it's not AA (most products default to AA; AAA on request).

## what it doesn't do

- automated remediation (it reports)
- guarantee compliance (machine-checkable issues are caught; human review is still required for context-dependent ones)
