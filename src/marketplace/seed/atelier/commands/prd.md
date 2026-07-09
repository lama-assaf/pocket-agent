---
name: prd
description: write a product requirements document
---

# /prd

start a prd from a feature name and rough intent.

## what it does

walks you through:

1. context (one or two sentences)
2. problem (who, what, evidence, current workaround)
3. goal (jtbd framing, primary metric, guardrails)
4. scope (in, out, alternatives)
5. approach (flow, screens, data, states)
6. open questions
7. risks

## how to use

```
/prd [feature name]
```

then answer questions. the prd is iterative.

## three questions you must answer

before writing anything substantive:

1. who is this for, and how do you know they want it?
2. what specific job are they trying to get done that current options do badly?
3. what does success look like in measurable terms 90 days after ship?

without these, the prd is vapor.
