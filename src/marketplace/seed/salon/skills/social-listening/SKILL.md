---
name: social-listening
description: Run the MCP-driven listening loop across reddit, hacker-news, brave-search, telegram, and discord for trend and sentiment discovery. Use whenever the user asks what's trending in their niche, wants a listening pass, or needs conversations worth joining.
---

# social-listening

## when to use

Use when a user asks what's trending in their niche, wants a competitor or community sentiment check, or needs a list of conversations worth joining before drafting anything new. This skill produces findings; hand any finding worth turning into a post to trend-to-content.

## workflow

1. Read `.atelier/memory/voice.md` if present, so findings get filtered against a niche the brand actually cares about.
2. Check `.atelier/memory/instincts.md` for overrides — banned topics, competitors to track or ignore, communities off-limits for outreach.
3. Check which listening MCPs are actually connected: reddit and hacker-news for niche trend and technical-conversation discovery, brave-search for broader web search when the niche isn't well covered by either, telegram and discord reads for community sentiment inside the user's own or adjacent servers.
4. For each connected MCP, run the discovery pass appropriate to it: reddit and hacker-news for what's being discussed and how it's landing, brave-search for a wider trend check, telegram/discord for tone and volume inside specific channels.
5. If no MCP is connected at all, or a specific one is missing, do not fail or stop. Emit the manual research checklist below in place of the missing tool's output, scoped to what it would have covered.
6. For each finding, write it in the four-part format below. A finding without evidence links or a named conversation opportunity isn't a finding yet — it's a hunch.
7. Route content-shaped findings to trend-to-content; route conversation-shaped findings straight into a comment-strategy target list with the shape suggestion attached.
8. Never post, reply, or comment directly from this skill. Listening produces findings and opportunities for a human or another skill to act on — it does not act on its own.

## finding format

For every finding, report all four parts:

1. **finding** — what's actually happening, stated plainly, not hyped.
2. **evidence links** — the specific posts, threads, or messages the finding is based on.
3. **conversation-entry opportunity** — which post or thread to join, and which comment shape from comment-strategy fits it (missing-piece concession, data-point-first, sharper follow-up question, etc.).
4. **content opportunity** — if the finding is strong enough to build a post around, flag it for trend-to-content rather than drafting content here.

## manual research checklist (no MCP connected)

When reddit, hacker-news, brave-search, telegram, or discord tooling isn't available, run this instead of failing silently:

- [ ] Search the niche's top 2-3 subreddits manually for the last 48 hours of top posts
- [ ] Check Hacker News front page and "new" for anything touching the niche
- [ ] Run a manual web search for the niche's key terms plus "reddit," "discussion," or "thread" to surface conversation, not just news
- [ ] Skim the user's own Discord/Telegram communities for the last day of activity, noting tone shifts or repeated questions
- [ ] Note which MCPs were unavailable so the next listening pass can retry them

Present this checklist as the deliverable, clearly labeled as a manual-research substitute, not disguised as MCP output.

## rules

- Check MCP connection status before running any discovery pass; never assume a tool is live.
- Degrade to the manual research checklist per missing tool rather than failing the whole listening pass.
- Every finding carries all four parts: finding, evidence links, conversation-entry opportunity, content opportunity.
- Conversation-entry opportunities name a specific comment shape from comment-strategy, not a vague "engage with this."
- Content-shaped findings get handed to trend-to-content, never drafted into a post inside this skill.
- Never auto-post, auto-reply, or auto-comment from a listening pass — this skill only surfaces opportunities.
- Community sentiment reads (telegram/discord) respect the same instincts overrides as everything else — no reading channels marked off-limits.

## checklist

- [ ] Voice file checked for niche context
- [ ] Instincts checked for banned topics and off-limits communities
- [ ] MCP connection status checked before running discovery
- [ ] Manual research checklist substituted for any disconnected tool
- [ ] Every finding has finding + evidence links + conversation opportunity + content opportunity
- [ ] Conversation opportunities name a specific comment-strategy shape
- [ ] Content-shaped findings routed to trend-to-content, not drafted here
- [ ] Nothing posted, replied, or commented directly from this skill
