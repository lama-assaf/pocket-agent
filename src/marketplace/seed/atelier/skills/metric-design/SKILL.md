---
name: metric-design
description: Design product metrics including north-star, primary, secondary, and guardrail metrics. Use whenever the user mentions metrics, north star metric, kpi, success metric, key results, or needs to figure out what to measure to know if something is working.
---

# metric-design

a metric you can't change with the work you're doing is decoration. a metric you can change for the wrong reasons is dangerous.

## the metric stack

every initiative has up to four metric types:

### north star

one metric. captures the long-term value the product creates for users. usually a usage metric weighted by depth, not a vanity count.

- bad: monthly active users
- better: monthly active users who completed the core action at least 3 times
- best: weighted active value (e.g. messages sent that received a reply, for messaging products)

a north star is not changed often. it's the destination.

### primary metric (per initiative)

one metric per project. the thing that tells you the bet paid off. should be moveable by the work you're doing in a meaningful time horizon (weeks to a quarter).

### secondary metrics

1-3 metrics you'd watch but won't optimize. they help interpret movement in the primary.

### guardrail metrics

things that must not break. you don't try to move these. you alarm if they regress.

examples: app crash rate, support ticket volume, customer satisfaction, page load time.

## the test of a good metric

ask:

- can the team actually move it with the work they do? (if no, it's a vanity metric or a system-level metric)
- is it observable in a useful timeframe? (a metric that takes 12 months to measure is hard to learn from)
- is it gameable in ways that hurt the user? (if yes, pair with a guardrail)
- does it capture the thing we care about, or only a proxy? (if it's a proxy, name what you can't measure directly)

## leading vs lagging

- **leading**: shifts before the thing you care about. easier to act on.
- **lagging**: the result. truer signal, slower.

most teams pair one of each. example: leading = "weekly active reports generated"; lagging = "customer retention 90 days out".

## per metric, capture

```
name: [short label]
definition: [the exact formula or query]
why it matters: [the underlying behavior it represents]
target: [number with timeframe]
current value: [what it is today]
direction of good: [up / down / stay within range]
guardrails: [what this could break if pushed too hard]
how often we review: [daily / weekly / monthly]
```

## what to avoid

- choosing metrics because they're easy to measure
- adding "improve" as the target (improve from what to what?)
- defining a metric without writing the query that produces it
- changing the metric mid-quarter because the trend is bad (change the metric for the next initiative, not the current one)
- tracking everything (the dashboard becomes wallpaper)
