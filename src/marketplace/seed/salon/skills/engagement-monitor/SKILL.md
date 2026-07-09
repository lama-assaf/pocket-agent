---
name: engagement-monitor
description: Score and track who is engaging with a campaign, and maintain the engager ledger. Use whenever the user asks who's engaging, wants an engagement report, or needs to decide who to follow up with.
---

# engagement-monitor

## when to use

Use when a user asks to review who engaged with recent posts, wants engagement scored by relevance rather than raw counts, or needs the campaign's engager ledger updated or reviewed. This is the skill that turns a pile of likes and comments into a follow-up list.

## workflow

1. Read `.atelier/memory/voice.md` if present. It names the ICP the campaign is trying to reach, which this skill scores against.
2. Check `.atelier/memory/instincts.md` for overrides on who counts as in-ICP or which accounts to ignore (competitors, bots, known low-value accounts).
3. Pull the engagement on the post or window under review and weight it using the ladder below. Never rank by raw count.
4. Classify each engager into an ICP tier and note it against the post.
5. Open `.atelier/memory/campaigns/<slug>.md` and find (or create) the `## engager ledger` section. Update the row for each recurring or high-weight engager: handle, tier, posts engaged, suggested next action.
6. Suggest a next action per engager based on tier and pattern, not a blanket "follow everyone back": follow, DM, or comment-back are the three standing options.
7. On the weekly review cadence, re-read the whole ledger, not just this week's rows. Look for engagers crossing from "commented once" to "shows up every post," since that's the signal worth acting on.

## engagement-weight ladder

Rank engagement by what it costs the engager to give, not by what's easiest to count.

| signal | approximate weight | why |
|---|---|---|
| save | ~5x | costs nothing publicly, means the reader wants to return to it; strongest private-intent signal available |
| meaningful comment (15+ words) | ~4x | costs public effort and time; the words themselves are evidence of read-through |
| share with commentary | ~3-4x | costs reputation; the sharer is putting their own name next to the idea |
| short comment | ~2x | some effort, low information |
| like | ~1x | costs almost nothing; on its own, a like means almost nothing about intent |

A post with 500 likes and two saves is a weaker signal than a post with 40 likes and twelve meaningful comments. Score the second one higher.

## engager ICP tiers

| tier | definition |
|---|---|
| peer | works in the same space, similar role or company stage; good for reach and credibility, not usually a buyer |
| aspirational | the audience the user wants to be seen by, larger accounts that are harder to convert but valuable for visibility |
| prospect | matches the campaign's actual target buyer or user profile |
| other | doesn't fit any tier above; track only if engagement is unusually high-weight |

Report the per-post breakdown as a percentage across the four tiers, not just a headcount. A post that's 80% peer engagement is doing something different than one that's 60% prospect.

## engager ledger maintenance

The ledger lives inside the campaign file at `.atelier/memory/campaigns/<slug>.md`, in a `## engager ledger` section, with these columns:

| handle | tier | posts engaged | suggested next action |
|---|---|---|---|

- Update existing rows rather than duplicating a handle across multiple entries.
- "Posts engaged" tracks a running count across the whole campaign, not just the post under review.
- Suggested next action is one of: follow, DM, comment-back. Pick the smallest action that matches the signal — a single like doesn't earn a DM.
- An engager who crosses three or more posts engaged without a next action taken is a review flag; don't let the ledger accumulate dead rows.

## rules

- Weight engagement by the ladder above before ranking or reporting anything — raw like counts don't go in a report on their own.
- Every recorded engager gets an ICP tier; "other" is a valid tier, not a skip.
- The ledger lives in the campaign file's `## engager ledger` section, never a separate document.
- Suggested next action is always one of follow, DM, or comment-back, sized to the engagement weight actually observed.
- Review the full ledger weekly, not just the newest rows — repeat engagers are the highest-value signal and only show up on a longer look-back.
- Any outreach suggested by this skill still passes `rules/social/engagement-ethics.md` — no mass-DM patterns that read as automated outreach.

## checklist

- [ ] Voice file checked for the campaign's ICP definition
- [ ] Instincts checked for overrides on ignored or priority accounts
- [ ] Engagement weighted by the ladder, not raw counts
- [ ] Every engager assigned an ICP tier
- [ ] Per-post tier breakdown reported as percentages
- [ ] `.atelier/memory/campaigns/<slug>.md` `## engager ledger` updated, not duplicated
- [ ] Next action suggested per engager, sized to signal weight
- [ ] Weekly review covers the full ledger, not just this week
