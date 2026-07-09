---
name: prd-writing
description: Write a product requirements document (PRD) that captures problem, goal, scope, approach, and risk. Use whenever the user mentions PRD, product requirements, product doc, product brief, requirements doc, or needs to write a structured document about what to build and why.
---

# prd-writing

a prd is a thinking artifact. its job is to make a decision auditable, not to satisfy a template.

## what a good prd does

- forces a clear statement of the problem
- names the user and the evidence they have this problem
- defines what success looks like in measurable terms
- bounds scope by naming what's in and what's deliberately out
- exposes risks and bets

## what a bad prd does

- describes the solution as if the problem were settled
- pads with sections that nobody reads
- uses success metrics that are vanity (page views, signups)
- avoids the question "what could kill this?"

## the structure to start from

```
# [feature name]

## context
two sentences. what's happening in the world or in our product that makes this worth doing now.

## problem
who feels it.
what specifically.
how we know (evidence: research, support tickets, analytics, sales feedback).
what they do today and why it falls short.

## goal
the job-to-be-done framing: "when [situation], i want to [motivation], so i can [outcome]".
primary success metric: one number, with target and timeframe.
secondary metrics: 1-2 that we'd watch but won't optimize for.
guardrail metrics: things we don't want to break.

## scope
in scope: bullets.
out of scope: bullets. be explicit about what we are choosing not to do.
alternatives considered: each with one sentence on why we didn't pick it.

## approach
the shape of the solution at a level a designer and engineer can react to.
user flow (described in prose or steps).
key screens or surfaces.
data shape.
states to handle: loading, empty, error, success.

## open questions
what we don't know yet.
who can answer.
when we need the answer by.

## risks
what could kill this.
what we're explicitly betting on.
what we'd learn first if we did a smaller version.

## timeline (only if needed)
milestones, not gantt charts.
```

## rules

- write in present tense.
- name a real user, not a persona.
- use numbers where you have them. when you don't, write "no evidence yet, validate before build".
- one prd, one feature. don't bundle.
- length is the wrong metric. clarity is.

## what to do before sharing

- read it from the perspective of someone who hasn't been in the conversation. does the problem stand on its own?
- read it from the perspective of an engineer. is the scope answerable?
- read it from the perspective of a skeptic. what would they push back on?
