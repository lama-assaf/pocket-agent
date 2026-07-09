---
name: content-calendar
description: Build the pillar x format content grid and cadence plan for a campaign. Use whenever the user asks for a content calendar, a posting schedule, or wants a batch of concrete post ideas across platforms.
---

# content-calendar

## when to use

Use when a user wants a content calendar, a batch of post ideas across pillars and formats, or a cadence plan for how often to post on each platform. This skill reads the brief campaign-brief already wrote and turns its pillars into a dated, concrete grid.

## workflow

1. Read `.atelier/memory/voice.md` if present — the concrete headlines this skill produces have to sound like the brand, not like a generic content template.
2. Check `.atelier/memory/instincts.md` for overrides on cadence, banned topics, or posting windows.
3. Open `.atelier/memory/campaigns/<slug>.md` and read `## brief` for the campaign's message house and pillars. If `## retro` exists from a prior campaign, read its best-performers list too — that's an input to what gets repeated here, not just a historical note.
4. Build the pillar x format matrix: 3-5 content pillars (take them from the brief's support pillars, plus the core claim itself as an optional pillar) against the 8 format columns below. Every cell is a concrete headline for that pillar in that format — never a theme or a placeholder like "post about X." The brief always defines exactly three message-house support pillars; this grid's 3-5 pillars are derived from those three, not limited to them, since the optional core-claim pillar and any campaign-specific split can widen the count.
5. Check the pillar mix against the guard: authority ≈40-50%, narrative ≈30-40%, community ≈20-30%, product ≤15% if used at all. Rebalance the grid before finalizing if any pillar drifts outside its band.
6. Apply the per-platform cadence guard below to sequence the grid into dated slots.
7. Write the dated grid into `## calendar` in the campaign file: platform, format, working title (the concrete headline), status. Never overwrite `## brief`, `## engager ledger`, or `## retro`.

## the 8 format columns

| format | what it does |
|---|---|
| actionable | a specific step the reader can do today |
| motivational | a stance or story that moves the reader's belief, not just their to-do list |
| analytical | breaks a number, trend, or mechanism down |
| contrarian | states the opposite of the room's consensus, and means it |
| observation | names a pattern nobody's said out loud yet |
| x-vs-y | a direct comparison forcing a choice |
| present-vs-future | contrasts where things stand now against where they're headed |
| listicle | a numbered or bulleted set, each item load-bearing |

## pillar mix guard

| pillar type | target share |
|---|---|
| authority | 40-50% |
| narrative | 30-40% |
| community | 20-30% |
| product (optional) | ≤15% |

These bands describe the whole grid across all pillars and formats, not a per-week quota. A calendar that's 70% product content has stopped being a content calendar and started being an ad schedule.

## per-platform cadence guard

| platform | cadence | note |
|---|---|---|
| LinkedIn | 3-5 posts/week | more than 5 dilutes reach per post without a proportional gain in total reach |
| X | daily or more | the platform rewards frequency; a gap of more than a day resets momentum |
| Discord | news-driven | post when there's real news, not on a fixed clock; sustainable only if comment volume in the server holds up under the pace |
| Telegram | news-driven | same discipline as Discord — cadence follows what's actually happening, not a calendar habit |

Discord and Telegram cadence is a ceiling, not a floor: if comment volume in the server drops as posting frequency rises, that's the signal to slow down, not push harder.

## rules

- Every cell in the pillar x format matrix is a concrete headline, never a theme placeholder.
- Pillar mix stays inside the authority/narrative/community/product bands across the whole grid.
- LinkedIn cadence stays inside 3-5/week; X posts daily or more; Discord and Telegram follow news, not a clock.
- Discord/Telegram cadence backs off the moment comment volume drops relative to posting frequency.
- Read `## retro`'s best-performers list when it exists and weight the new grid toward what's already proven to work, without copying a post verbatim.
- Write only into `## calendar`. Leave `## brief`, `## engager ledger`, and `## retro` untouched.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] Brief's pillars read from `## brief`; prior `## retro` best-performers read if present
- [ ] 3-5 pillars set against all 8 format columns, every cell a concrete headline
- [ ] Pillar mix checked against the authority/narrative/community/product bands
- [ ] LinkedIn, X, Discord, Telegram cadence each match their guard
- [ ] Dated grid (platform, format, working title, status) written into `## calendar`
- [ ] Other campaign-file sections left untouched
