---
name: research-synth
description: synthesize user research into themes and recommendations
---

# /research-synth

turn raw research into structured insight. invokes the research-synthesis skill.

## what it does

reads everything before synthesizing. tags statements by job, frustration, workaround, desire, hard constraint. clusters by underlying need, not surface language. counts. names themes in user language.

## how to use

```
/research-synth
```

then provide the source material (interview transcripts, survey data, support tickets, or notes).

## output

```
theme: [short label]
size: [N participants]
strength: [low / medium / high]
representative quotes: [2-3 direct, attributed]
underlying job: [what they're really trying to accomplish]
current workaround: [what they do today]
opportunity: [what a product could do]
implication: [what this means for product decisions]
confidence: [low / medium / high]
```

## what it doesn't do

- generalize from one participant
- invent quotes
- recommend solutions before themes are stable
