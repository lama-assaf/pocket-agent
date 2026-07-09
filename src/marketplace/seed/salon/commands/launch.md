---
name: launch
description: run the golden-hour post-launch engagement routine by running the launch-window workflow
---

# /launch

invoke the launch-window skill's workflow with $ARGUMENTS as the subject —
the link to the post that just went live.

## steps

1. if $ARGUMENTS is empty, ask for the link (or confirm which post just
   published) before starting the timed routine.
2. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` for platform and audience context.
3. run launch-window to produce the golden-hour checklist and walk the user
   through it.
