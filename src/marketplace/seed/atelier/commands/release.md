---
name: release
description: write release notes
---

# /release

write release notes that tell users what shipped in their terms.

## what it does

builds:

```
[version] — [date]
[one-sentence summary]

new
- [item]: [user value]

improved
- [item]: [before → after, concretely]

fixed
- [item]: [symptom, not technical cause]

breaking changes (if any)
- [item]: [old → new + migration step]

heads up (if any)
- [item]: [workflow impact]
```

## rules it follows

- order by user impact, not ship order
- one sentence per item
- no internal jargon, no ticket numbers
- consistent verb tense
- specific over general ("improved performance" is not a change)

## how to use

```
/release [version]
```

then provide the list of changes (commit messages, jira tickets, or notes are fine — it'll translate).
