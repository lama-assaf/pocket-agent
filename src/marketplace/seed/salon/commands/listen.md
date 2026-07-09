---
name: listen
description: run a trend and sentiment listening pass by running the social-listening workflow
---

# /listen

invoke the social-listening skill's workflow with $ARGUMENTS as the subject:
the niche, topic, or keyword to listen for.

## steps

1. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` first, for the audience and niche to focus
   the pass on.
2. run social-listening. it degrades to manual-research instructions for
   any of reddit, hacker-news, brave-search, telegram, or discord that
   isn't connected via MCP; it should never fail outright for a missing
   server.
3. if $ARGUMENTS is empty, ask what topic or niche to listen for before
   starting.
