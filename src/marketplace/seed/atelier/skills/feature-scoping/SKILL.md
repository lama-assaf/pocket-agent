---
name: feature-scoping
description: Scope a feature to its smallest valuable shape. Use whenever the user mentions scoping, MVP, smallest version, cutting scope, or needs to figure out what to keep, what to cut, and what to defer.
---

# feature-scoping

most features fail by being too large. scope is the discipline of shipping the smallest thing that's still valuable.

## the questions

before scoping, answer these three:

1. **what specific problem does this solve and for whom?** (without this, you can't tell what's essential vs. nice-to-have)
2. **what would the user do today instead?** (this is the bar to beat)
3. **what would prove this works?** (the test, not the dream version)

if you can't answer all three, you're not scoping yet. you're brainstorming.

## the slicing methods

### slice by user

ship for one user type or use case first. add others when the first works.

- example: "we're building a billing system" → first version handles only the simplest billing pattern (monthly subscription, single tier, single currency). every other pattern is a later slice.

### slice by job stage

ship for one part of the user's workflow. add upstream and downstream stages later.

- example: "we're building expense management" → first version is the report submission step. capture (receipts) and reimbursement (payment) come later.

### slice by quality

ship a manual or partially-automated version. automate it after it's used.

- example: "we're building approval workflows" → first version sends an email and lets a human click approve. routing logic comes after we see what the routing actually needs to be.

### slice by surface

ship on one surface first.

- example: "we're building notifications" → email only in v1. push, slack, in-app later.

## what to cut and what to keep

cut:

- alternative paths (the path that 20% of users would take)
- configuration (defaults are fine; settings come after we know what to expose)
- bulk operations (one at a time works for small numbers)
- admin features (manual database operations for the team are fine in early days)
- analytics dashboards (logs are enough)

keep:

- the core happy path
- the most likely failure modes
- security and data integrity (these are not slice-able)
- the ability to remove or undo what was created

## output

```
the feature: [one sentence]

the slice: [the version you'd ship first]

what's in:
- [bullet]

what's deliberately out:
- [bullet] — [when we'd add it: after milestone X / never / later if needed]

what we'll learn from the slice:
- [what shipping this answers]

the test: [the specific evidence that would justify expanding]
```

## anti-patterns

- "mvp" that has every feature but rough
- "phase 1" that depends on phase 2 to be useful
- cutting the wrong axis (e.g. cutting features when the user count is the problem)
- adding "phase 2: everything else" instead of naming the next slice
