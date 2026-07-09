---
name: metrics
description: design product metrics including primary, secondary, and guardrails
---

# /metrics

design a metric stack for a product, feature, or initiative. invokes the metric-design skill.

## what it does

produces, per initiative:

- one primary metric (moveable by the work, observable in a useful timeframe)
- 1-3 secondary metrics (watched, not optimized)
- guardrails (things that must not break)

tests each metric against:

- can the team move it
- is it observable in time
- is it gameable in ways that hurt the user
- does it capture the real thing or only a proxy

## how to use

```
/metrics [initiative name]
```

then describe what's being shipped and the underlying behavior.

## output per metric

```
name: [short label]
definition: [exact formula or query]
why it matters: [the behavior it represents]
target: [number with timeframe]
current value: [today's baseline]
direction of good: [up / down / range]
guardrails: [what this could break]
review cadence: [daily / weekly / monthly]
```
