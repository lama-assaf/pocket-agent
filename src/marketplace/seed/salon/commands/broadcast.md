---
name: broadcast
description: draft a Telegram broadcast by running the telegram-broadcast workflow
---

# /broadcast

invoke the telegram-broadcast skill's workflow with $ARGUMENTS as the
subject (the update or campaign broadcast being sent).

## steps

1. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` first, for key message and constraints,
   before drafting.
2. run telegram-broadcast to produce the draft.
3. if a telegram MCP server is connected, offer to send it directly; if not,
   hand back the draft text for the user to send themselves.
