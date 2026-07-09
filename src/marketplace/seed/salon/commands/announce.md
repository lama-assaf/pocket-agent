---
name: announce
description: draft a Discord server announcement by running the discord-announcement workflow
---

# /announce

invoke the discord-announcement skill's workflow with $ARGUMENTS as the
subject (the update, event, AMA, or reveal being announced).

## steps

1. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` first, for key message and constraints,
   before drafting.
2. run discord-announcement to produce the draft.
3. if a discord MCP server is connected, offer to post it directly; if not,
   hand back the draft text for the user to paste in.
