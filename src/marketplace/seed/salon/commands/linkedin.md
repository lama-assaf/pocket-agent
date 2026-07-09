---
name: linkedin
description: draft a LinkedIn post by running the linkedin-post workflow, then offer a post-audit pass
---

# /linkedin

invoke the linkedin-post skill's workflow with $ARGUMENTS as the subject.

## steps

1. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` first, for key message and constraints,
   before drafting.
2. run linkedin-post to produce the draft.
3. once the post is drafted, offer to run post-audit on it before the user
   publishes.
