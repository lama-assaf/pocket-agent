---
name: roadmap
description: plan a product roadmap with themes, bets, and sequencing
---

# /roadmap

build a roadmap structured around themes and bets, not feature lists. invokes the roadmap-planning skill.

## what it does

produces:

```
theme: [the bet about where to focus]
duration: [usually a quarter]
question: [what we're trying to learn]
investment: [proportion of capacity]

now (committed): [items with hypothesis, size, confidence, metric]
next (high-confidence queue): [items]
later (under consideration): [items]
```

with sequencing rules: high-risk early, dependencies before dependents, learning before scaling.

## how to use

```
/roadmap
```

then describe the team, the time horizon, the current state, and what you're trying to decide.

## what it doesn't do

- predict ship dates with false precision
- list every backlog item
- pretend a roadmap holds for 12 months
