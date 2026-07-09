---
name: jtbd-framing
description: Frame a product, feature, or user need using Jobs-to-be-Done methodology. Use whenever the user mentions JTBD, jobs to be done, user job, job statement, or wants to understand what users are really hiring a product to do.
---

# jtbd-framing

products get hired for jobs. people fire products that don't do the job well.

## the canonical structure

```
when [situation],
i want to [motivation],
so i can [outcome].
```

each part has rules.

### situation

the context, not the role. "when i'm preparing for a quarterly board meeting" is a situation. "as a finance director" is a role and doesn't tell us what triggers the need.

situations are specific moments. trigger-able. observable.

### motivation

what the user is trying to accomplish, stated in the user's terms, not in product terms.

bad: "i want to use our crm to track leads"
good: "i want to know which deals are at risk before my pipeline review"

motivation is the verb. the product is the means, not the motivation itself.

### outcome

the success state. how the user knows the job is done.

outcomes are the test. if the product technically does the motivation but doesn't deliver the outcome, the job isn't really done.

## how to find the right job

ask "why" five times. start from a surface request ("can we add filters?") and work down:

- why filters? "so i can find specific entries faster"
- why faster? "so i don't lose 20 minutes per week"
- why 20 minutes? "because i do this lookup before every customer call"
- why before every call? "so i don't ask a customer something they already told us"
- why does that matter? "so the customer feels heard"

the job isn't filters. the job is "feel like an attentive partner to my customers".

a product that solves the job at the right altitude is more durable than one that solves only the surface request.

## functional, emotional, social

every job has three layers:

- **functional**: the practical task. "track expenses".
- **emotional**: how the user wants to feel. "feel in control of my finances".
- **social**: how they want to be seen. "look responsible to my partner".

a great product addresses all three. b2b is often weakest on emotional and social. consumer is often weakest on functional.

## anti-patterns

- "as a user, i want a feature, so i can use it" (this is not a job)
- jobs that are really roles ("when i'm a marketer")
- jobs that are really features ("when i need to filter")
- jobs that only one user has ("when i'm trying to do this very specific thing nobody else does")

## output

```
job: when [...], i want to [...], so i can [...]
who hires: [user type and situation]
who they might fire (the alternative they'd switch from): [...]
emotional layer: [...]
social layer: [...]
evidence: [where this job came from]
```
