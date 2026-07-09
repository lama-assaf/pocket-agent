---
name: experiment
description: design an a/b test or experiment
---

# /experiment

design a/b tests or experiments that produce decision-quality results.

## what it does

forces you through:

- a falsifiable hypothesis ("if [change], then [metric] moves [direction] by [amount] in [timeframe], because [mechanism]")
- one primary metric, defined precisely
- secondary metrics for context
- guardrails with stopping thresholds
- sample size calculated before launch
- analysis plan written before data arrives

## output

```
hypothesis: [if/then with mechanism]
primary metric: [name, definition, expected baseline, minimum detectable effect, target lift]
secondary metrics: [list]
guardrails: [thresholds that stop the test]
variants: [control vs variant description]
exposure: [user-level / session-level, % of traffic]
sample size: [calculated number, with assumptions]
duration: [planned weeks]
analysis plan: [cuts to examine, decision rule]
```

## how to use

```
/experiment [name]
```

## what it doesn't do

- pick metrics for you (you bring the metric, the command checks it)
- run the test (this is design, not execution)
