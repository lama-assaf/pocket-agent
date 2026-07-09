---
name: thread
description: draft an X thread by running the x-thread workflow, then offer a post-audit pass
---

# /thread

invoke the x-thread skill's workflow with $ARGUMENTS as the subject.

## steps

1. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` first, for key message and constraints,
   before drafting.
2. run x-thread to produce the draft.
3. once the thread is drafted, offer to run post-audit on it before the
   user publishes.
