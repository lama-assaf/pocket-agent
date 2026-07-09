---
name: engage
description: triage and draft replies to comments on the user's own post by running the reply-playbook workflow
---

# /engage

invoke the reply-playbook skill's workflow with $ARGUMENTS as the subject —
the replies to triage.

## steps

1. if $ARGUMENTS contains the replies (pasted text), use them directly. if
   it names a post instead, and a platform MCP server is connected, pull the
   replies from there; otherwise ask the user to paste them in.
2. if a campaign is active for this project, consult its file under
   `.atelier/memory/campaigns/` for the engager ledger before drafting
   responses, and append notable engagers back to it afterward.
3. run reply-playbook to triage and draft the responses.
