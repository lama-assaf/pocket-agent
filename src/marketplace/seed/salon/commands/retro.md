---
name: retro
description: run the post-campaign readout by running the campaign-retro workflow
---

# /retro

invoke the campaign-retro skill's workflow with $ARGUMENTS as the campaign
slug.

## steps

1. if $ARGUMENTS is empty, list the available slugs under
   `.atelier/memory/campaigns/` and ask which one to run the retro on.
2. read that campaign's file first (brief, calendar, and engager ledger
   sections) before scoring results.
3. run campaign-retro. it writes the retro section back into the same
   campaign file and flags any lessons worth promoting into
   `.atelier/memory/lessons.md`.
