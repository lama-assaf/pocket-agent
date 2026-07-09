---
name: campaign-retro
description: Run the post-campaign readout, score results against the brief's benchmark bands, and distill durable lessons. Use whenever the user asks for a campaign retro, a performance readout, or wants to know what worked.
---

# campaign-retro

## when to use

Use when a campaign (or a defined phase of one) has run long enough to judge, and the user wants a readout: what worked, what didn't, and what to carry forward. This is the last skill in the campaign lifecycle — it reads the brief's bands and the calendar's slots, and its output feeds the next campaign's content-calendar.

## workflow

1. Read `.atelier/memory/voice.md` if present, for context on what the campaign was trying to sound like.
2. Check `.atelier/memory/instincts.md` for overrides on how this campaign should be scored.
3. Confirm every post under review has cleared the 48-72 hour plateau. A post scored before then is a read of the algorithm's seed test, not the post's actual reception — hold the whole retro until the newest post in scope has cleared the window.
4. Open `.atelier/memory/campaigns/<slug>.md` and read `## brief` for the benchmark bands and `## calendar` for the posts that ran.
5. Compute per-platform engagement rate for each post: `(reactions + comments + saves + shares) / impressions`. Exclude any paid-amplified reach and paid-driven engagement from this number — organic benchmarks measure organic performance, and blending in paid spend inflates the rate past what it actually earned.
6. Score each post's engagement rate against the brief's good/great/excellent bands for its metric.
7. Rank top-3 and bottom-3 posts, and for each one, name the WHY: hook type, format, topic, and timing. A ranking without a why is a leaderboard, not a readout.
8. Apply flop discipline before calling anything a flop: a post is a flop only if click-rate, follower-ratio, engagement-rate, AND conversion all missed their bands. A post that's weak on one metric and strong on three isn't a flop — it did its job differently than expected.
9. Write `## retro` into the campaign file: scored results, top-3/bottom-3 with why, and an updated best-performers list content-calendar will read next time.
10. Distill 1-3 durable lessons from the retro into `.atelier/memory/lessons.md`, following that file's format (date, context, lesson, optional cost of ignoring). Only promote a lesson that would change what gets built next campaign — not every observation earns a place there.

## engagement-rate math

```
engagement rate = (reactions + comments + saves + shares) / impressions
```

Exclude paid amplification from this calculation entirely when scoring against organic benchmark bands. If a post ran both organic and paid, compute two rates — organic-only against the organic bands, and a separate paid-inclusive number reported alongside it, never blended into one figure.

## flop discipline

| metric | missed band? |
|---|---|
| click-rate | |
| follower-ratio | |
| engagement-rate | |
| conversion | |

A post is a flop only when all four boxes are checked. Three misses and one hit is a post worth a closer look, not a verdict — name what the surviving metric suggests before writing the post off.

## rules

- No score, verdict, or flop call before the post's 48-72 hour plateau has passed.
- Engagement rate always excludes paid amplification when compared against an organic benchmark band.
- Every top-3/bottom-3 entry carries a WHY: hook type, format, topic, timing — never a bare ranking.
- "Flop" requires all four metrics (click-rate, follower-ratio, engagement-rate, conversion) missing their band, not one or two.
- `## retro` in the campaign file always ends with an updated best-performers list for content-calendar to read next.
- 1-3 lessons per retro get promoted into `.atelier/memory/lessons.md`, in that file's format, and only if they'd change future work.
- Write only into `## retro` (plus the separate lessons file). Leave `## brief`, `## calendar`, and `## engager ledger` untouched.

## checklist

- [ ] Voice file checked for scoring context
- [ ] Instincts checked for overrides
- [ ] Every post in scope has cleared the 48-72h plateau
- [ ] `## brief` bands and `## calendar` posts read before scoring
- [ ] Engagement rate computed per post, paid amplification excluded
- [ ] Posts scored against the brief's good/great/excellent bands
- [ ] Top-3 and bottom-3 named with a WHY (hook, format, topic, timing)
- [ ] Flop discipline applied — all four metrics missed before calling a flop
- [ ] `## retro` written with an updated best-performers list
- [ ] 1-3 durable lessons promoted into `.atelier/memory/lessons.md`
