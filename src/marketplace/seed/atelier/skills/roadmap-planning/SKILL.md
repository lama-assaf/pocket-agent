---
name: roadmap-planning
description: Plan a product roadmap including themes, bets, and sequencing. Use whenever the user mentions roadmap, planning, quarterly planning, what to build next, sequencing features, or needs to organize work over a meaningful time horizon.
---

# roadmap-planning

a roadmap is a record of bets, not a list of features.

## what a roadmap is for

- align a team on direction without locking dates
- communicate priorities to people outside the team
- create a vocabulary for tradeoffs ("we're not doing X because we're doing Y this quarter")
- expose dependencies and bets explicitly

## what a roadmap is not for

- predicting ship dates with precision
- listing every task
- making people outside the team comfortable that everything will be done

## structure

### theme

a theme is a bet about where to focus. "improve onboarding". "deepen the analytics layer". "ship for teams".

themes have a duration (usually a quarter). themes have a question they answer ("can we get day-7 retention above 40%?") and an investment level ("most of our eng capacity").

### within each theme, three buckets

- **now**: committed work, in progress or starting
- **next**: high confidence, queued behind now
- **later**: under consideration, may or may not happen

`later` is not a backlog. it's the set of bets we'd make if `next` doesn't pan out or capacity opens up.

### sequencing rules

- highest-risk bets early. if a bet kills the theme, you want to learn that fast.
- dependencies before dependents.
- learning before scaling. ship the smallest version that teaches you something.

## what to capture per item

```
title: [short name]
theme: [which theme this belongs to]
hypothesis: [what we believe will happen if we ship this]
size: [t-shirt: xs, s, m, l, xl]
confidence: [low / medium / high]
status: [now / next / later]
dependencies: [other items or external factors]
metric: [what we'd measure to know it worked]
```

## what to avoid

- roadmaps that list features without themes (no shape)
- roadmaps with everything in "now" (no priorities)
- dates that imply more precision than you have
- a roadmap that hasn't changed in months (means you stopped learning)
- a roadmap that changes weekly (means you don't have themes)

## review cadence

- weekly: status on `now`, surface blockers
- monthly: re-evaluate confidence on `next`
- quarterly: pick themes for the next quarter, demote and promote between buckets

## how to tell it's working

- people outside the team can answer "what is the product team focused on right now?"
- people inside the team can say no to good ideas by pointing at the roadmap
- you can point at last quarter's roadmap and explain what shipped, what didn't, and what you learned
