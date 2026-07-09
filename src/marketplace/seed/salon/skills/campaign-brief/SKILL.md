---
name: campaign-brief
description: Turn a goal into a full campaign brief. Use whenever the user asks to start a new campaign, plan a launch, or wants a brief written before any content gets drafted.
---

# campaign-brief

## when to use

Use when a user wants to start a new campaign, plan a launch, or turn a loose goal into something the rest of the team can execute against. This is the first skill in the campaign lifecycle — content-calendar, social-listening, and campaign-retro all read the brief this skill produces.

## workflow

1. Read `.atelier/memory/voice.md` if present. The brief's audience notes and message house should sit inside the voice already on file, not invent a new one.
2. Check `.atelier/memory/instincts.md` for standing overrides — banned topics, required disclosures, prior campaigns that set a precedent worth repeating or avoiding.
3. Gather objectives and audience: what the campaign is for, and who it's for, including ICP notes (role, company stage, or persona the campaign is actually trying to reach — not "everyone interested in the space").
4. Build the message house: one core claim the whole campaign proves, three support pillars under it, and at least one proof point per pillar (a number, a quote, a shipped feature — something concrete, not an adjective).
5. Split channel strategy across owned, earned, and paid for each of the four platforms (X, LinkedIn, Discord, Telegram). A platform can carry "n/a" for a lane honestly; don't force paid spend where there isn't a budget.
6. Sketch a week-by-week calendar skeleton — phase names and dependencies, not finished posts. content-calendar fills in the actual grid later; this skill only lays the weeks and what has to happen before what.
7. Set success metrics with benchmark bands now, before any content ships: for each metric, name what counts as good, great, and excellent. Setting bands after the numbers come in is grading on a curve, not measuring anything.
8. If the campaign involves a token, an airdrop, or any Web3 financial mechanic, add an explicit compliance-review checkpoint into the calendar skeleton before the launch week — not as a footnote, as a dated step someone has to clear.
9. Open (or create) `.atelier/memory/campaigns/<slug>.md`. If the file doesn't exist, create it following `memory/campaigns/README.md`'s section order. Write or update the `## brief` section with everything above. Never touch `## calendar`, `## engager ledger`, or `## retro` — those belong to other skills.

## message house

| layer | contents |
|---|---|
| core claim | the one sentence the campaign has to prove, true even if every other line got cut |
| support pillars (3) | the three angles that each independently back the core claim |
| proof points | one concrete number, quote, or shipped fact per pillar — no pillar stands on adjectives alone |

## channel strategy grid

| platform | owned | earned | paid |
|---|---|---|---|
| X | | | |
| LinkedIn | | | |
| Discord | | | |
| Telegram | | | |

Fill every cell or mark it "n/a" with a one-line reason. A blank cell reads as forgotten, not deliberate.

## benchmark bands

| metric | good | great | excellent |
|---|---|---|---|
| (per campaign metric) | | | |

Set bands at brief time, before the first post ships. campaign-retro scores against these bands later — bands written after results are in don't measure anything, they only excuse whatever happened.

## rules

- Audience notes need an ICP, not a demographic guess — name the role or persona the campaign is actually trying to move.
- The core claim gets exactly three support pillars, each with a proof point that isn't an adjective.
- Every platform-lane cell in the channel grid is filled or explicitly marked n/a with a reason.
- The calendar skeleton is phases and dependencies only; leave the actual post grid to content-calendar.
- Benchmark bands are set now, at brief time, not after the campaign runs.
- Token or airdrop campaigns get a dated compliance-review checkpoint in the calendar skeleton before launch.
- Write only into `## brief`. The other three sections belong to content-calendar, engagement-monitor, and campaign-retro.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] Objectives and ICP-qualified audience captured
- [ ] Message house: one core claim, three pillars, proof point per pillar
- [ ] Channel strategy filled (owned/earned/paid) across all four platforms
- [ ] Week-by-week calendar skeleton with dependencies sketched
- [ ] Success metrics have good/great/excellent bands set at brief time
- [ ] Token/Web3 campaigns carry a dated compliance-review checkpoint
- [ ] `.atelier/memory/campaigns/<slug>.md` created if absent, `## brief` written or updated, other sections untouched
