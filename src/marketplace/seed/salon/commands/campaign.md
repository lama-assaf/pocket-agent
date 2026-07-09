---
name: campaign
description: start a new campaign by running the campaign-brief workflow, then offer to build the content calendar
---

# /campaign

invoke the campaign-brief skill's workflow with $ARGUMENTS as the campaign
goal or subject.

## steps

1. run campaign-brief. it creates or opens the campaign's file under
   `.atelier/memory/campaigns/<slug>.md` and writes the brief section:
   goal, audience, key message, platforms, constraints.
2. once the brief is written, offer to continue straight into the
   content-calendar skill for the same campaign file rather than stopping
   and making the user re-invoke it.
3. if $ARGUMENTS is empty, ask what the campaign is for before starting —
   don't invent a goal.
