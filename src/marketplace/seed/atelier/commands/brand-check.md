---
name: brand-check
description: check copy against a brand voice guide
---

# /brand-check

run text against a brand voice guide. flag lines that drift.

## what it does

reads your draft and your voice guide. goes line by line. for each sentence:

- voice match: pass / drift / fail
- specific issue if drift or fail
- proposed rewrite that holds meaning and fixes the voice

also flags generic ai-tone markers and corporate buzzwords regardless of guide.

## how to use

```
/brand-check
```

then provide:

1. the voice guide (or examples of past copy in the voice)
2. the draft to check

## what it doesn't do

- improvise a voice if no guide is provided
- add personality the voice doesn't have
- make copy more clever than the voice allows
