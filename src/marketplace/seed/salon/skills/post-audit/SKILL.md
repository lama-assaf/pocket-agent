---
name: post-audit
description: Run a pre-publish audit on a drafted post. Use whenever the user asks to check, review, or audit a draft before it ships.
---

# post-audit

## when to use

Use before anything goes live: a finished thread, LinkedIn post, Discord announcement, Telegram broadcast, or any other drafted copy that's about to be published. This is the last gate, not a style pass.

## workflow

1. Read `.atelier/memory/voice.md` if present and check the draft against it: adjective sliders, vocabulary do/don't lists, per-platform register.
2. Check `.atelier/memory/instincts.md` for standing overrides (banned topics, claim requirements) and confirm the draft respects them.
3. Run the platform-limits check: character counts, link placement, hashtag count, embed field lengths, against `rules/social/platform-limits.md` for whatever platform this draft targets.
4. Run the AI-tell scan across all three tiers in `rules/social/ai-tells.md` plus the shared `rules/copy/anti-ai-tone.md` — forensic tier is an automatic flag, strict tier is flagged by default, aesthetic tier gets judgment.
5. Run the link-placement check: confirm every link sits where the platform rule requires (first reply, first comment, single embedded link) and not in the primary body.
6. Run the claim check: every number in the draft traces to a real source, and every promise made in the copy ("we'll follow up," "link below") is actually kept somewhere in the post or thread.
7. Run the engagement-design check — name the one signal this post is built to earn (reply, save, share, click, profile visit, bookmark) and confirm the copy actually asks for or invites that signal, not a generic "let us know what you think." Weigh the target against engagement-monitor's ladder (saves > meaningful comments > shares-with-commentary > short comments > likes — see engagement-monitor for the full ladder) and, for X drafts specifically, remember replies and dwell time are the top ranking tier with profile clicks and bookmarks close behind.
8. Produce a verdict: PASS, or a FLAG list. Every flag gets a specific fix suggestion, not just a pointer at the rule it broke.

## rules

- Every check runs every time — don't skip the AI-tell scan because the draft "sounds fine."
- Forensic-tier AI tells are hard flags: the audit cannot pass with one present.
- Strict-tier tells are flagged by default; only clear them with a specific reason the usage is earned in context.
- Aesthetic-tier tells get judgment, not an automatic flag — note them, don't block on them alone.
- A claim with no traceable source is a flag, even if it's probably true.
- A promise the copy makes but the post doesn't deliver on (a link that isn't there, a follow-up that isn't scheduled) is a flag.
- The verdict is binary at the top: PASS or FLAG. A flagged draft lists every issue with a concrete fix, not a vague "tighten this up."
- Rank the target engagement signal by cost to the reader, not by what's easiest to earn: saves outweigh meaningful comments, which outweigh shares with commentary, which outweigh short comments, which outweigh likes. Consult engagement-monitor's ladder for the exact weights when the call isn't obvious.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] Platform-limits check run (chars, links, hashtags, embed fields)
- [ ] AI-tell scan run across all three tiers plus anti-ai-tone
- [ ] Link placement checked against the platform's rule
- [ ] Every number sourced, every promise kept
- [ ] Target engagement signal named and confirmed the copy earns it
- [ ] Verdict issued: PASS, or FLAG list with a fix per item
