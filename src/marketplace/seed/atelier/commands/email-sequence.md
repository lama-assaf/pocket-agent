---
name: email-sequence
description: write multi-email sequences for onboarding, nurture, sales, lifecycle, or launch
---

# /email-sequence

write a sequence where every email earns its place by what it asks the reader to do.

## what it does

builds the full sequence: goal, audience, trigger, cadence, content per email, success metric. produces draft copy for each email.

## how to use

```
/email-sequence
```

then provide:

1. purpose (onboarding / nurture / sales / lifecycle / launch / educational)
2. audience (who's receiving these and what they know)
3. goal (the one behavior the sequence should drive)
4. trigger (event that starts the sequence)
5. cadence ceiling (max emails before tolerance breaks)
6. voice (extracted or canonical)
7. unsubscribe and frequency rules

## sequence shapes supported

- onboarding (3-5 emails over 2 weeks)
- nurture (5-8 emails over 4-8 weeks)
- sales cadence (5-10 emails over 2-3 weeks)
- re-engagement (3-5 emails over 2 weeks)
- launch (3-5 emails over 1-3 weeks)
- educational course (5-10 emails)

## rules it follows

- one cta per email
- subject line earns the open
- preview text is the second subject line
- short by default (50-150 words for onboarding/sales)
- no exclamation marks unless something deserves them
- name the next action

## what to avoid

- "we hope this email finds you well"
- "exciting news"
- generic [first_name] tokens with no actual personalization
- fake countdowns and scarcity
- "did you see my last email?" four times

## output

per email: send time, subject, preview, body, cta, fallback path if no open.

plus: post-sequence handoff (where do people go who completed vs didn't).

## what it doesn't do

- send the emails (use your ESP)
- design templates
- segment your list
- replace a/b testing

## related

- `/voice-extract` — voice every email matches
- `/microcopy` — subjects, ctas
- `/messaging` — claims the sequence draws from
- `/launch` — launch sequences integrate with broader plan
