---
name: research-synthesis
description: Synthesize user interviews, surveys, support tickets, or other research into themes and recommendations. Use whenever the user shares interview transcripts, survey responses, support data, customer research, or asks for synthesis of qualitative input.
---

# research-synthesis

raw research is data. synthesis is making it useful for decisions.

## the process

### 1. read everything before synthesizing

never synthesize from a sample if the full set is available. patterns you notice in the first three interviews are often artifacts of the order you read them in.

### 2. tag, don't paraphrase

go through and tag statements. tags include:
- job-to-be-done (what they're trying to accomplish)
- frustration (what's blocking them)
- workaround (what they do today)
- desire (what they wish existed)
- hard constraint (what they can't change)
- non-goal (something explicitly not important to them)

keep the original wording. tag it. don't rewrite it yet.

### 3. cluster

group tagged statements by the shape of the underlying need, not the surface vocabulary. "i hate spreadsheets" and "i wish there was a faster way to track this" might be the same cluster.

### 4. count

for each cluster:
- how many distinct participants voiced this
- how strongly (passing mention vs. animated frustration)
- whether it came up unprompted or only when probed

### 5. theme

a theme is a cluster with a name. name it in the user's language, not your team's.

## output shape

```
theme: [short label]
size: [N participants]
strength: [low / medium / high]
representative quotes: [2-3, attributed to participant id]
underlying job: [what they're trying to accomplish]
current workaround: [what they do today]
opportunity: [what a product could do here]

→ implication: [what this means for product decisions]
→ confidence: [low / medium / high based on sample and consistency]
```

## what to avoid

- inventing quotes
- generalizing from one passionate participant
- mixing themes (one theme per cluster)
- jumping to solutions before themes are stable
- using softening adverbs (most, many, some) without numbers behind them
- presenting themes in a deck that has the conclusion before the evidence

## how to know synthesis is done

a good synthesis lets a reader who wasn't in the interviews make the same product decision you would. if they'd reach a different conclusion, the synthesis isn't complete or the evidence isn't strong enough.
