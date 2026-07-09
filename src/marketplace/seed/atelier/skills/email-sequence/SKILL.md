---
name: email-sequence
description: Write a sequence of emails for onboarding, nurture, sales, lifecycle, or launch. Use when the user asks for a drip campaign, email sequence, welcome series, onboarding emails, sales cadence, or any multi-email flow tied to a goal.
---

# email-sequence

write multi-email sequences with intent. each email earns its place by what it asks the reader to do.

## what this skill does

builds an end-to-end email sequence: the goal, the audience, the trigger, the cadence, the content of each email, and the success metric. produces draft copy for every email in the sequence.

## when to use

- onboarding new users to a product
- nurturing leads through consideration
- sales cadences for high-touch outreach
- lifecycle emails (re-engagement, milestone, churn rescue)
- launch sequences (pre-launch, launch, post-launch)
- educational courses delivered by email

## inputs required

1. **purpose**: onboarding / nurture / sales / lifecycle / launch / educational
2. **audience**: who's receiving these, where they came from, what they know
3. **goal**: what one behavior should the sequence drive?
4. **trigger**: what event starts the sequence (signup, form fill, purchase, inactivity)
5. **cadence ceiling**: max emails the audience will tolerate
6. **voice**: extracted or canonical brand voice
7. **unsubscribe logic**: who you can email and how often

if these aren't clear, surface the gap. a sequence built on guesses produces unsubscribes.

## sequence shapes by purpose

### onboarding (3-5 emails over 2 weeks)

```
email 1 (T+0): welcome + first action
  goal: get them to take the first useful action
  content: one paragraph welcome, one clear CTA to a starter task
  what to skip: feature tour, founder story, social media follows

email 2 (T+2 days): your first win
  trigger: only if they completed the first action; otherwise different path
  goal: reinforce what they just did, point to next step

email 3 (T+5 days): the next thing worth doing
  goal: surface a capability they probably haven't tried
  content: one feature, one outcome, one CTA

email 4 (T+10 days): are you stuck?
  goal: re-engage people who paused
  content: specific question + direct help

email 5 (T+14 days): where you are now
  goal: summarize what they've accomplished, hint at what's next
```

### nurture (5-8 emails over 4-8 weeks)

```
emphasis: teach, not sell. each email earns the next open.
each email should leave the reader smarter, not pushed.
cta evolves: educational early → demo / contact late.
```

### sales cadence (5-10 emails over 2-3 weeks)

```
emphasis: relevance, brevity, response-friendliness.
each email under 100 words.
each cta a question, not a meeting link.
final email gives permission to opt out gracefully.
```

### lifecycle: re-engagement (3-5 emails over 2 weeks)

```
emphasis: acknowledge the gap.
do not pretend they've been active.
honest line about what's new, one specific reason to come back.
the last email is "removing you from this list unless you say no."
```

### launch (3-5 emails over 1-3 weeks)

```
pre-launch (T-3 days): heads up, why it matters
launch (T+0): it's here, what it is, primary cta
follow-up (T+2 days): for people who didn't open or click
deep-dive (T+1 week): for the engaged audience, one detail
```

### educational course (5-10 emails over 5-10 weeks)

```
each email is a self-contained lesson.
each lesson has: hook, content, application, optional next step.
no upsells until the course is complete.
```

## the rules

1. **one cta per email**: more than one cta = none of them work.

2. **subject line earns the open**: specific, curiosity-creating, not clickbait. "your first invoice" beats "important account update."

3. **preview text is the second subject line**: write it, don't let the first sentence default in.

4. **first line tested for the inbox preview**: "hi [name]" wastes the preview. lead with what matters.

5. **plain text feels personal**: when the email is from a person, write it like one person writing to another. drop the template chrome.

6. **short**: most onboarding and sales emails are 50-150 words. nurture and educational can be longer, but not by default.

7. **no exclamation marks unless something deserves them**: most don't.

8. **name the next action**: if you want them to reply, write "reply yes." if you want them to click, name what they'll find on the other side.

9. **the unsubscribe link is honest**: don't hide it.

## what to avoid

- "we hope this email finds you well"
- "exciting news!"
- "we're thrilled to announce"
- "circle back"
- "touch base"
- generic [first_name] tokens with no actual personalization
- corporate footer the size of the email
- a sequence that just says "did you see my last email?" four times
- countdowns and fake scarcity

## output shape

```
sequence: [name]
purpose: [onboarding / nurture / etc.]
audience: [who]
goal: [single behavior]
trigger: [event]
length: [N emails over X days]

success metric:
  primary: [open / click / conversion rate to specific action]
  secondary: [reply rate / unsubscribe rate as guardrail]

email 1
  send: T+0
  to: [filtered audience]
  subject: [line]
  preview: [line]
  body: [draft]
  cta: [single action + link]
  if no open by T+X: [next step]

email 2
  ...

post-sequence
  [what happens to people who completed, what happens to people who didn't]
  [is there a next sequence or are they done]
```

## what this skill doesn't do

- send the emails (use your ESP)
- design templates (separate task; this is copy)
- segment your list (you bring the segment)
- replace a/b testing (test subjects, ctas, send times in flight)

## related

- voice-extract (the voice every email should match)
- microcopy-writing (subject lines, ctas, error states)
- messaging-architecture (claims and proof the sequence draws from)
- launch-planning (launch sequence integrates with broader launch plan)
