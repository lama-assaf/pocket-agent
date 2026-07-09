---
name: community-health
description: Assess and act on Discord or Telegram community health signals. Use whenever the user asks about server health, member churn, mod escalation, or wants a re-engagement plan for a quiet community.
---

# community-health

## when to use

Use when a user asks how their Discord or Telegram community is doing, wants to spot churn before it shows up as a visible exodus, needs an escalation call on a brewing situation, or wants a plan to wake up a quiet server. This skill covers the community itself, not individual post engagement — see engagement-monitor for that.

## workflow

1. Read `.atelier/memory/voice.md` if present, for how the brand wants to sound in community spaces (more casual than the main feed, usually).
2. Check `.atelier/memory/instincts.md` for overrides — standing bans on topics, known problem accounts, or escalation contacts.
3. Pull the health signals below and compare against the community's own recent baseline, not an industry number — a 5% lurker drop matters more in a server that's normally rock-solid than in one that's always noisy.
4. Check response time against the SLA and flag any open member question past it.
5. If a health signal is trending down, pick a re-engagement play from the menu and propose it.
6. If there's an active negative or hostile situation, run it through the 3-tier escalation ladder and name the tier explicitly — don't leave it as "keep an eye on it."
7. Confirm mod-team cadence is happening: daily sweep logged, and the situation (or the quiet week) is on the agenda for the weekly retro.

## health signals

| signal | what it measures | watch for |
|---|---|---|
| lurker ratio | members who never post vs. total active members | a rising ratio means the server is becoming an audience, not a community |
| new-member first-message rate | share of new joins who post anything in their first week | a falling rate means onboarding or the welcome flow isn't working |
| churn signals | members leaving right after announcements, or threads going silent that used to have replies | leaves tied to announcements suggest the announcement itself pushed people out, not general drift |
| response-time SLA | time between a member question and the first substantive reply | unanswered questions past SLA are the single fastest way to make a community feel abandoned |

## re-engagement plays

| play | use when |
|---|---|
| call-out thread | a specific topic or channel has gone quiet and needs a concrete prompt to restart it |
| member spotlight | lurker ratio is climbing and the community needs a reason to see itself as people, not an audience |
| low-stakes poll | the server needs a fast, low-effort way to get quiet members posting again before a bigger ask |

## 3-tier escalation ladder

| tier | trigger | owner and timing |
|---|---|---|
| tier 1 | routine negativity — a complaint, a bad-day rant, ordinary friction | community manager handles directly, no escalation needed |
| tier 2 | a negative comment gaining traction — e.g., 10+ reactions or replies and still climbing | escalate to the marketing lead within 2 hours |
| tier 3 | viral negative content, or coordinated brigading | escalate to leadership immediately, no delay for confirmation |

Name the tier out loud in every escalation note. "This feels bad" is not a tier; match it to a trigger before deciding who gets pulled in.

## mod-team cadence

- Daily sweep: a mod reviews new messages, flags, and open questions once a day minimum, logged so cadence gaps are visible.
- Weekly retro: community health signals and any escalations from the week go on the retro agenda as a standing item, not an ad hoc mention.

## rules

- Compare every signal against the community's own baseline, not a generic industry benchmark.
- Any member question past the response-time SLA is a flag, even if it eventually gets answered.
- Every escalation is assigned an explicit tier before action is taken, using the triggers above, not gut feel.
- Tier 2 and tier 3 escalations move on their stated timeline (2 hours, immediately) — sitting on them defeats the ladder.
- Re-engagement plays get picked to match the specific signal that's declining, not applied as a generic morale boost.
- Every community message, spotlight, or reply drafted here passes `rules/social/engagement-ethics.md` — no manufactured urgency, no fake member testimonials.

## checklist

- [ ] Voice file checked for community-specific register
- [ ] Instincts checked for overrides
- [ ] Health signals compared against the community's own baseline
- [ ] Response-time SLA checked against open member questions
- [ ] Re-engagement play chosen to match the declining signal, if any
- [ ] Active situations assigned an explicit escalation tier
- [ ] Tier 2/3 escalations routed on their stated timeline
- [ ] Daily sweep and weekly retro cadence confirmed
- [ ] All drafted community responses pass `rules/social/engagement-ethics.md`
