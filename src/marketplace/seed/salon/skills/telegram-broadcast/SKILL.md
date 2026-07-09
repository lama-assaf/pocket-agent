---
name: telegram-broadcast
description: Draft a Telegram broadcast message. Use whenever the user asks to write, plan, or send a channel update, pinned message, or campaign broadcast on Telegram.
---

# telegram-broadcast

## when to use

Use when a user asks for a Telegram channel post, a pinned campaign message, or a broadcast update. Use it too when adapting a Discord announcement for Telegram. This skill covers that handoff.

## workflow

1. Read `.atelier/memory/voice.md` if present. Telegram broadcasts read closer to a newsletter than a chat message. Check the per-platform register notes.
2. Check `.atelier/memory/instincts.md` for overrides on cadence or banned topics.
3. Write the first line to carry the entire story on its own — it's what shows in the notification preview and the channel list, often the only line a member reads.
4. Draft the body assuming it will be forwarded out of context. Cut any phrase that depends on something said earlier in the channel ("as mentioned above," "following up on the last post").
5. Stay under the 4,096-character message cap; if the content genuinely needs more, split into a clearly-labeled follow-up rather than trimming meaning down to fit.
6. If this message should be pinned, check what's currently pinned first. Unpin the superseded message before pinning the new one. Never stack pins.
7. If there's one primary action (join, claim, RSVP), attach it as a single inline button rather than a bare link in the text.
8. If this is adapted from a Discord announcement, rewrite it for the broadcast register — don't mirror the Discord text verbatim.

## rules

- First line must stand alone as the whole story: assume it's the only line seen in the notification preview.
- 4,096-character hard cap per message.
- Write forward-friendly: no references to earlier messages in the same channel. A forwarded message should make full sense with zero surrounding context.
- One pinned campaign message at a time. When a new one goes up, unpin the old one in the same action.
- One inline keyboard button for the single primary action, when there is one. Don't stack multiple competing CTAs into one broadcast.
- Broadcasts are interruptions to a subscriber's day — batch related news into one message instead of sending three broadcasts in an hour.
- When adapting from Discord, rewrite for Telegram's register — cross-posting the identical text reads as lazy and undersells the channel.

## checklist

- [ ] Voice file checked and matched (or noted as absent)
- [ ] Instincts checked for overrides
- [ ] First line carries the full story on its own
- [ ] Message ≤ 4,096 characters
- [ ] No references to earlier messages ("as mentioned above")
- [ ] Pin discipline checked — old pin cleared if this one is pinned
- [ ] Single inline CTA button if there's one primary action
- [ ] News batched, not fired off as multiple small broadcasts
- [ ] Adapted for Telegram's register if sourced from Discord, not mirrored
