# Clients & projects

Pick a client first; everything flows from it. This is the client-first workspace model that sits on top of the [scoped memory system](./memory-and-brain.md).

## Personal, Agency, Clients, Projects

- **Personal** — your own private brain. Always first-class, never shared.
- **Agency (World)** — the shared base beneath every client. Facts here apply everywhere except Personal.
- **Client** — one brand you work with. Its own isolated memory: facts, lessons, voice, guardrails, and (optionally) a synced git repo.
- **Project** — a lightweight sub-scope under a client (`project:<id>`), inheriting that client's + Agency's memory. Can optionally link to a working directory for coder-style work.

Switching context in the **Clients picker** (the sidebar/workspace switcher) scopes the whole session — chat history, memory recall, voice/tone, and enabled agents/MCP servers all follow whichever workspace is active.

## Data model

Clients and projects are plain SQLite rows (`src/memory/clients.ts`, `src/memory/projects.ts`):

```
clients:  id, name, sync_mode ('live'|'manual'), repo_url, last_pulled_at, last_pushed_at, ...
projects: id, client_id, name, working_directory, ...
```

`id` is a stable slug — it's also the `client:<id>` / `project:<id>` scope key, so it must never change once memory is attributed to it. On disk, each client gets a checkout under `<userData>/clients/<id>` (and Agency under `<userData>/world`), holding `.atelier/memory/*.md` + `guardrails/*.md`.

A couple of default client brains ship with the app out of the box, already voiced and agent-wired, so there's something to look at on first launch — this is idempotent (never overwrites your own edits) and independent of whether you've already hand-created a client with the same name.

## Sharing a client's brain with your team

Each client's brain can sync to a private git repo — this is what makes "one brand, one shared brain" possible across a team:

1. **Set up sync.** In Settings → GitHub, click **Connect GitHub** to sign in with your own account (device flow — no pasted secret; see [github-account-connection.md](./github-account-connection.md)), or use the collapsed "Advanced: Personal Access Token" fallback. Then point a client at a repo URL. Either path authenticates as *you* — your GitHub account still needs collaborator/org access to that repo before sync can actually pull/push it.
2. **Publish.** Editing voice/lessons/facts/analytics in-app, then clicking **Publish**, materializes your edits to `.atelier/memory/*.md` (+ a machine-readable `analytics-posts.json`) and commits + pushes them.
3. **Share access.** From the Clients picker, **Copy setup link** on that client copies a compact `pocketagent://join?...` string — repo + client id/name only, *never* a credential — safe to paste in Slack/email.
4. **Teammate joins.** They paste it via **Join a Client**; r3to.os creates the client row locally and pulls the brain immediately, using *their own* GitHub token (set separately in their Settings) to authenticate.
5. **Stay in sync.** Clients default to `sync_mode: live` and auto-pull on every launch when a token is configured; each card shows "last pulled" and flags itself **stale** after 24h. **Pull All** sweeps every live client manually.

Reconciliation on divergence is append-mostly: `lessons.md`/`decisions/` merge by line-union (nothing lost), while single-owner files (`voice.md`, `guardrails/*`, agent/MCP enablement) resolve to one whole side rather than a line merge.

**What syncs:** voice, lessons, facts, guardrails, enabled-agents/MCP overrides, and post-analytics snapshots (two-way — a pull reconstructs analytics rows locally too, so a fresh teammate sees real numbers offline after one pull).

**What doesn't sync (yet):** content drafts/posts and campaigns stay local-only; the client/project row's own metadata (name, repo URL) isn't itself version-controlled — only the brain content is.

Next: [Analytics](./analytics.md).
