---
name: ab-test-design
description: Design an a/b test or experiment including hypothesis, metrics, sample size, and analysis plan. Use whenever the user mentions a/b test, experiment, split test, multivariate test, or needs to design a test that produces a decision-quality result.
---

# ab-test-design

most a/b tests don't produce learnings. they produce arguments. a well-designed test produces a decision.

## the elements

### hypothesis

stated in a form that can be falsified:

"if we [change], then [primary metric] will move [direction] by at least [amount] within [timeframe], because [mechanism]."

the `because` matters. it's the reason you'd be confident in the result.

### primary metric

one. the metric that, if it moves, you'd make a decision on. defined precisely.

### secondary metrics

context. helps interpret the primary movement. not the basis for the decision.

### guardrails

things you'd want to know didn't break. if a guardrail crosses a threshold, you'd consider stopping the test even if the primary metric is winning.

### exposure

who sees the variant. user-level random assignment is the default. session-level only if user-level doesn't make sense for the change.

### duration and sample size

calculate before launching. needs:

- expected baseline rate of the primary metric
- minimum detectable effect (the smallest difference that would matter for the decision)
- desired statistical power (80% is typical)
- significance threshold (95% confidence is typical)

if the math says you need 10x your weekly traffic, the test as designed isn't going to give you an answer. redesign the test or the metric.

## the trap of running too short

most tests show winning early because the early adopters of a variant differ from the steady-state population. wait until the planned sample size is reached.

## the trap of running too long

if a test has been running for weeks and isn't conclusive, the effect is probably small enough that the change doesn't matter for the primary metric. accept that and move on.

## the trap of multiple comparisons

testing 4 variants against a control increases the chance of a false positive. either run a single A/B with the strongest variant, or use multiple-comparison corrections in the analysis.

## analysis plan (written before launch)

- what cuts do you plan to look at (by user segment, by platform, etc.)
- what would make you ship the variant
- what would make you not ship
- what would make you run a follow-up test instead of deciding

writing the analysis plan before the data comes in protects against motivated reasoning afterward.

## output

```
hypothesis: [if/then with mechanism]

primary metric: [name, definition, expected baseline, minimum detectable effect, target lift]

secondary metrics: [list with definitions]

guardrails: [list with thresholds that would stop the test]

variants:
  control: [current behavior]
  variant: [the change being tested]

exposure: [user-level / session-level, % of traffic]

sample size: [calculated number, with assumptions]

duration: [planned weeks]

analysis plan:
  cuts to examine: [list]
  decision rule: [ship / no-ship / follow-up criteria]
```
