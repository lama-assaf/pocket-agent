---
name: discord-announcement
description: Draft a Discord server announcement. Use whenever the user asks to write, plan, or ping members about an update, event, AMA, or reveal in a Discord server.
---

# discord-announcement

## when to use

Use when a user asks for an announcement, an event promo, an AMA plan, or a role-gated reveal for a Discord community. Use it for web3/token-adjacent announcements too. This skill carries the compliance guardrail for those.

## workflow

1. Read `.atelier/memory/voice.md` if present. Discord tolerates more emoji and direct address than other platforms. Check the per-platform register notes before assuming a formal tone.
2. Check `.atelier/memory/instincts.md` for overrides (banned topics, escalation rules for pings).
3. Identify the announcement type: single update, event promo, AMA, or role-gated reveal — each has its own runbook below.
4. Draft the anatomy in order: headline line, what happened, why members should care, what to do next. Cut anything that doesn't serve one of those four jobs.
5. Choose the ping level using the etiquette ladder. Default to no ping or a role ping, and justify anything louder.
6. If this touches a listing, partnership, price, or token event, run the wording past the compliance guardrail before drafting further.
7. Check embed field lengths against the hard limits before sending.

## rules

- Announcement anatomy, in order: headline line → what happened → why it matters to members → what to do next. One clear ask, not three.
- One link maximum per announcement. If there's a second link, it goes in a reply or pinned thread, not the announcement itself.
- Embed title: 256 characters max. Embed description: 4,096 characters max.
- Ping etiquette ladder, loudest to quietest:
  - `@everyone`: reserved for changes that affect literally every member (downtime, security, a rule change). Overuse trains members to mute the server.
  - `@here`: time-critical only, for something happening in the next hour that active members should know about.
  - role ping: the default for anything audience-specific. Prefer this over `@here` whenever the news only matters to a subset of members.
  - no ping: routine updates, recaps, anything members will see in the normal scroll.
- Web3 context: listing, partnership, and token announcements get a compliance pass before posting — no price predictions, no "guaranteed returns" framing, no language that reads as investment advice. State facts; let members draw conclusions.

## runbooks

**Event promo (T-7 / T-1 / T-0):**
- T-7: full announcement (what, when, why it matters, how to prep or RSVP).
- T-1: reminder (shorter, links to the same event, adds any last-minute detail like speaker confirmed, agenda finalized).
- T-0: go-live ping (headline plus the direct join link, role-pinged to the relevant audience).

**AMA:**
- Announce the AMA with date, guest, and topic.
- Open a dedicated thread to collect questions ahead of time.
- Run the AMA live in its own thread, separate from the collection thread.
- Post a recap afterward with the key answers and a link to the full transcript or replay.

**Role-gated reveal:**
- Confirm the target role has the correct channel permissions before drafting.
- Write the reveal for that role's specific channel. Don't write a generic version and hope permissions handle the targeting.
- Plan the wider-server follow-up separately once the gate lifts, rather than mirroring the gated text verbatim.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] Anatomy present: headline, what happened, why it matters, what to do next
- [ ] One link maximum
- [ ] Embed title/description within limits (256 / 4,096)
- [ ] Ping level matches the etiquette ladder, justified if loud
- [ ] Compliance pass done if listing/partnership/price-adjacent
- [ ] Correct runbook followed if this is an event, AMA, or gated reveal
