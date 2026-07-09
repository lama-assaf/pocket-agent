---
name: copy-review
description: review copy for voice, rhythm, and clarity
---

# /copy-review

review existing copy. flag issues, propose rewrites.

## what it does

three-pass review:

1. voice match (against your guide, if provided)
2. sentence rhythm (length variation, structural patterns)
3. anti-ai tone (the words and structures that signal ai writing)

for each issue, returns the line, the problem, and a rewrite.

## how to use

```
/copy-review
```

then provide:

1. the draft
2. the voice guide (optional but recommended)
3. the channel and audience

## what it doesn't do

- ghost-write the whole piece (use /draft for that)
- argue with intentional stylistic choices once they've been named as intentional
