---
name: trend-to-content
description: Turn one social-listening finding into a platform-fit content plan with angle options and a freshness deadline. Use whenever the user hands you a trend, a finding, or a conversation and asks what to do with it.
---

# trend-to-content

## when to use

Use when a user has one specific finding — a trend, a conversation, a competitor move — and wants to know whether and how to turn it into content. This skill takes a single finding from social-listening and outputs a plan; it does not draft the post itself.

## workflow

1. Read `.atelier/memory/voice.md` if present. A trend that's on-topic but off-voice still needs reshaping before it fits any platform.
2. Check `.atelier/memory/instincts.md` for overrides — banned topics, or trends the brand deliberately stays out of even when relevant.
3. Assess platform fit: of the four platforms (X, LinkedIn, Discord, Telegram), decide which one this trend actually lives on. A fast-moving technical trend fits X or Discord; a slower, credibility-driven angle fits LinkedIn; community-specific news fits Telegram. Name the platform explicitly, don't leave it implied.
4. Run hook-writing's six-angle drill against the trend, but only surface 2-3 angle options here — enough for the user to choose from, not the full generation-and-selection pass that belongs inside hook-writing itself when the chosen angle gets drafted.
5. Set a freshness deadline: trends decay. State a concrete post-by date and time, not "soon." Base it on how fast the underlying conversation is moving — a breaking technical story decays in hours, a slower industry shift can hold for a few days.
6. Open `.atelier/memory/campaigns/<slug>.md` if a campaign is active and check `## calendar` for an open slot the trend could fill. Suggest the specific slot (date, platform, format) rather than telling the user to "add it somewhere."
7. Hand the platform-fit assessment, angle options, freshness deadline, and slot suggestion back as the deliverable. Drafting the actual post belongs to the platform-specific writing skill (x-thread, linkedin-post, discord-announcement, telegram-broadcast), not to this skill.

## output shape

1. **platform fit**: which of the four platforms, and why.
2. **angle options (2-3)**: drawn from hook-writing's six angles, matched to what the finding actually supports.
3. **freshness deadline**: a specific post-by date and time.
4. **slot suggestion**: the calendar slot this fills, if a campaign calendar is active; otherwise a standalone recommendation.

## rules

- Platform fit names exactly one of the four platforms, with a reason tied to how the trend is moving, not a default guess.
- 2-3 angle options only, each traceable to one of hook-writing's six angles.
- Freshness deadline is always a specific date/time, never "soon" or "when convenient."
- Slot suggestion references an actual open slot in `## calendar` when a campaign is active, or is flagged as standalone when it isn't.
- This skill outputs a plan, not a draft. The actual post gets written by the platform-specific writing skill once an angle is chosen.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] Platform fit named for one of the four platforms, with a reason
- [ ] 2-3 angle options generated from hook-writing's six-angle set
- [ ] Freshness deadline set as a specific date/time
- [ ] Calendar checked for an open slot when a campaign is active
- [ ] Output handed off as a plan, not drafted into a finished post
