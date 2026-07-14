---
name: analytics-optimizer
description: Read per-post X/LinkedIn (and other channel) performance data from the Analytics store, find what's actually working, and turn that into concrete next-post recommendations. Use whenever the user asks how a post or channel performed, wants an analytics readout, or asks what to post next based on what's working.
---

# analytics-optimizer

## when to use

Use when a user asks how a post did, wants a performance readout across posts, or asks what to do next based on real numbers rather than gut feel. This skill reads the Analytics store (see the app's Analytics page and its `analytics:*` IPC surface) and campaign-retro's benchmark discipline; it does not draft content itself — findings route to campaign-strategist / content-calendar for the next brief.

## data source

Per-post metrics (impressions, likes, comments, shares, clicks, video views) live in the app's scoped analytics store, one snapshot per ingestion — a post's numbers are read as the LATEST snapshot per post, not summed across every historical snapshot (that would double-count a post that's been refreshed several times). Two ways numbers get in:

- **Manual entry** — a human pastes numbers from the X/LinkedIn native analytics dashboard into the Analytics page. This works with zero API credentials and is the default path.
- **MCP ingestion** — if a channel's official analytics-capable MCP server is connected and configured (e.g. an X API server with analytics scopes, or a LinkedIn analytics server), numbers can be pulled automatically. Treat this as an enhancement, never a requirement — the skill's workflow below must degrade cleanly to manual-entry data.

## workflow

1. Read `.atelier/memory/voice.md` and `.atelier/memory/instincts.md` if present, for ICP and benchmark context the same way campaign-retro does.
2. Check what's actually in the Analytics store for the requested scope/channel before saying anything about performance. An empty store (no manual entries yet, no MCP connected) is not a failure — report it plainly and stop, don't invent numbers.
3. Compute engagement rate per post: `(likes + comments + shares) / impressions`. Exclude clicks (a click-through signal, not an engagement one) and any paid-amplified reach, same exclusion campaign-retro uses.
4. Rank posts by engagement rate, restricted to posts with enough impressions to be meaningful (a 2-impression post with 1 like is noise, not a signal) — never rank on raw counts alone.
5. For each top performer, name the WHY: hook type, format, topic, timing, channel — a ranking without a why is a leaderboard, not an optimization.
6. Compare channels against each other only in relative terms (engagement rate, not raw impressions) — X and LinkedIn have structurally different reach mechanics, so a raw-count comparison misleads.
7. Turn the top 2-3 patterns into concrete, specific next-post recommendations (format + topic + timing), handed to campaign-strategist for the next brief — this skill does not draft the post itself.
8. If a pattern is strong and durable enough to change future work, promote it into `.atelier/memory/lessons.md` in that file's format, same discipline as campaign-retro.

## engagement-rate math

```
engagement rate = (likes + comments + shares) / impressions
```

Never include clicks in this number (track click-through rate separately: `clicks / impressions`). Exclude paid amplification the same way campaign-retro does when comparing against an organic pattern.

## degrading gracefully (no live API connected)

Most workspaces will have no X/LinkedIn analytics API connected — this is the default, expected state, not an error:

- If the Analytics store has zero rows for the requested scope, say so directly: "No analytics recorded yet for `<scope>`. Paste numbers from X/LinkedIn's own analytics dashboard into the Analytics page, or connect an analytics-capable MCP server in Settings > MCP Servers."
- If some posts have manual entries and others don't, work only with what exists — never estimate or fabricate a missing post's numbers.
- Never claim a number came from a live platform read unless the row's `source` is `mcp`, not `manual` — the Analytics page always shows this distinction; carry it into any readout so a human-entered guess is never confused with a platform-verified number.

## rules

- Never fabricate or estimate a metric that isn't in the Analytics store — an empty store gets reported as empty, not filled in with a plausible-sounding guess.
- Engagement rate always excludes clicks and paid amplification.
- Every top-performer call names a WHY (hook/format/topic/timing/channel), never a bare ranking.
- Cross-channel comparisons use rate, never raw counts.
- This skill produces findings and recommendations; it does not draft posts (hand off to campaign-strategist / content-calendar) and does not post/schedule anything.
- A pattern only gets promoted to `.atelier/memory/lessons.md` if it would change what gets built next, in that file's format.

## checklist

- [ ] Voice/instincts checked for ICP and benchmark context
- [ ] Analytics store checked before reporting anything — empty state reported plainly, not invented
- [ ] Engagement rate computed per post, clicks and paid amplification excluded
- [ ] Ranking restricted to posts with meaningful impressions, not raw likes
- [ ] Every top performer carries a WHY
- [ ] Channel comparisons use rate, not raw counts
- [ ] Recommendations are concrete (format + topic + timing) and handed off, not drafted here
- [ ] Manual vs. MCP-sourced numbers never conflated in the readout
