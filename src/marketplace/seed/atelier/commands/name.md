---
name: name
description: generate name candidates for a product, feature, company, or brand
---

# /name

generate names with rationale and availability checks.

## what it does

generates 20-30 candidates across five categories:

- descriptive
- suggestive
- evocative
- invented
- metaphor

for the top 8-12, runs:

- pronunciation check
- spelling check
- search collision check
- domain availability
- npm availability
- trademark concerns

## how to use

```
/name
```

then provide:

- what's being named (product / feature / company)
- what it does
- audience
- what it should evoke
- constraints (length, language, must-avoid)
- availability requirements

## output

three recommendations and one anti-recommendation (a name that sounds good but has a fatal flaw).
