---
name: launch-window
description: Run the golden-hour engagement routine right after a post goes live. Use whenever the user just published a post and asks what to do next, or wants a timed checklist for the first hours after launch.
---

# launch-window

## when to use

Use the moment a post goes live and the user asks what to do in the following hours, or wants a standing routine to run every time they publish. This skill governs the window right after publish; use post-audit before publishing and engagement-monitor for scoring who showed up afterward.

## workflow

1. Read `.atelier/memory/voice.md` if present — the tone of golden-hour replies should match the post they're defending, not drift into a different register under time pressure.
2. Check `.atelier/memory/instincts.md` for overrides on this specific post or campaign.
3. Run the timed checklist below starting the moment the post is live. Don't skip stages because early engagement looks slow — the schedule is what creates the engagement, not a response to it.
4. Log adjacent-post engagement (step T+5-15) as its own comment-strategy pass, not an afterthought — those are real comments, held to the same 15-word and shape standards.
5. At T+1-2h, do the final pass and then stop actively driving the post. Continued forced engagement past that point reads as manufactured.
6. Do not evaluate whether the post worked during the launch window. Schedule the actual performance check for 48-72 hours out and hold to it.

## golden-hour checklist

| time | action |
|---|---|
| T+0 | post goes live |
| T+0 to T+5 min | reply to every early comment as it lands |
| T+5 to T+15 min | engage 5-10 adjacent, in-niche posts (comment-strategy pass) |
| T+15 to T+30 min | recheck the post and reply to anything new |
| T+1 to T+2 hr | final pass: reply to remaining comments, then step back |

On X specifically, stay actively online for at least 30 minutes after posting — early reply density in that window is part of what the platform reads as a live, worth-extending post.

## rationale

Feed and ranking models seed a new post to roughly 8-15% of followers first, then decide whether to extend distribution based on what happens in that seed window. The first 60-90 minutes after publish determine the bulk of a post's eventual reach — a post that's ignored for the first hour and picked up on hour three has already lost most of the distribution it could have gotten. This is why the checklist is a schedule to execute, not a reaction to slow numbers.

Once the golden hour passes, distribution doesn't stop — it just slows down. Extended distribution keeps running for roughly 24-72 hours after publish, still pulling in views and engagement from the feed algorithm's later scoring passes. That's a separate fact from the 48-72 hour judgment rule below: the post keeps circulating in that window even though you're not allowed to score it as a win or a flop until the plateau check.

## judgment discipline

Do not evaluate a post's performance before the 48-72 hour plateau. Early numbers are still moving and any read taken during the launch window is a read of the algorithm's seed test, not the post's actual reception. Schedule the retro check for 48-72 hours out and treat the launch window itself as pure execution — no verdict, no "this one's not landing," until the plateau check.

## rules

- Reply to every comment in the T+0-5 window; a gap here is the single most avoidable loss of early momentum.
- The T+5-15 adjacent-post pass is 5-10 posts, and every comment on those posts follows comment-strategy's own rules (15+ words, real shape, ethics check).
- Stay online at least 30 minutes after posting on X.
- Extended distribution runs roughly 24-72 hours after the golden hour ends; that's ongoing algorithm circulation, not the 48-72h judgment window below — the two facts don't overlap.
- No performance verdict before the 48-72h plateau — schedule that check instead of eyeballing it day-of.
- The final pass at T+1-2h is where active driving stops; don't keep manufacturing engagement past it.
- Every reply and comment sent during the window still passes `rules/social/engagement-ethics.md`.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] T+0-5: every early comment answered
- [ ] T+5-15: 5-10 adjacent in-niche posts engaged via comment-strategy
- [ ] T+15-30: recheck done, new comments answered
- [ ] T+1-2h: final pass done, active driving stopped after
- [ ] Stayed online 30+ min post-publish on X
- [ ] 48-72h performance-check scheduled, no early verdict issued
- [ ] All window activity passes `rules/social/engagement-ethics.md`
