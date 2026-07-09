---
name: comment
description: draft comments on someone else's post by running the comment-strategy workflow
---

# /comment

invoke the comment-strategy skill's workflow with $ARGUMENTS as the subject
— the post URL or topic to comment on.

## steps

1. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` first, for niche and voice constraints.
2. run comment-strategy to produce the drafted comment(s).
3. if $ARGUMENTS is empty, ask for the post URL or the topic/niche to target
   before drafting.
