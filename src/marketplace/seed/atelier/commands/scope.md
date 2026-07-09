---
name: scope
description: scope a feature to its smallest valuable shape
---

# /scope

find the smallest version of a feature that still teaches and delivers value.

## what it does

walks through three diagnostic questions:

1. what specific problem does this solve and for whom
2. what would the user do today instead
3. what would prove this works

then proposes slicing strategies:

- by user (one user type first)
- by job stage (one workflow stage first)
- by quality (manual before automated)
- by surface (one channel first)

## output

```
the feature: [one sentence]
the slice: [the version you'd ship first]
what's in: [bullets]
what's out: [bullets, with when we'd revisit]
what we learn: [what the slice teaches]
the test: [evidence that justifies expanding]
```

## how to use

```
/scope [feature name]
```
