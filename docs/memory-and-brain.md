# Memory & the Brain

r3to.os's memory isn't just chat history — it actively extracts and organizes knowledge, and every piece of it carries a **scope** so personal information never mixes with shared brand information.

## The scope model

Every fact, lesson, and voice note lives in one of these scopes (`src/memory/scope.ts`):

| Scope | Meaning | Visible where |
|---|---|---|
| `user` | Your private, personal memory | **Personal** context only — never shared, never synced |
| `world` | Agency-wide shared knowledge | Every non-personal context (the base under every client) |
| `client:<id>` | One brand's memory | That client's context, and any project under it |
| `project:<id>` | A sub-scope under a client | That project's context only |
| `chat:<id>` | One conversation's own memory | That conversation only |

`resolveVisibleScopes` turns your selected context (Personal / Agency / a client / a project) into the ordered list of scopes visible for recall, nearest-first. `resolveNearestScope` decides where a *new* fact/lesson lands based on what's currently selected. The `user` scope is excluded from every shared context by construction — isolation isn't a filter you can turn off, it's how the data model works.

## The Brain workbench

Each client (and Agency/World) has an on-disk "brain" plus its SQLite-backed facts, editable in-app in **The Brain** panel:

- **Facts** — brand knowledge (who they are, positioning, do's and don'ts).
- **Lessons** — append-only learnings recorded over time.
- **How to act** — voice, tone, instincts, and banned words. These compose the brand-voice system prompt injection and feed the live tone guard (`src/agent/how-to-act.ts`) — a client's voice always overrides the Agency default for the same subject.

On disk, each brain lives under `.atelier/memory/` (`voice.md`, `lessons.md`, `facts.md`, analytics exports) plus a `guardrails/` folder (`banned-words.md`). `AtelierMemoryBridge` mirrors those files into scoped facts whenever a brain is pulled; the export path (`src/clients/export.ts`) does the reverse — materializing your in-app edits back out to those files so they're git-diffable and shareable (see [Clients & projects](./clients-and-projects.md) for the sync workflow).

## Semantic recall

Facts are embedded for semantic search, so mentioning something from months ago still surfaces the right memory — not just a keyword match. Recall respects the same scope-visibility chain: a search from a client's context never surfaces another client's facts, and never surfaces your personal ones.

## Daily logs & consolidation

The app keeps daily logs (a running journal per day) and periodically rolls them up (`src/memory/consolidation.ts`, `src/memory/daily-logs.ts`) — summarizing older logs into durable facts so context doesn't grow unbounded, using the in-process summarizer (`src/memory/summarizer.ts`) rather than a separate service.

## The "soul" system

A separate layer from facts: it learns *how* to work with you specifically — your communication style, preferred response shape, boundaries you've set — not facts *about* you. It's what makes the agent feel increasingly tailored the more you use it, independent of which client/project you're working in.

## Calendar, tasks, and reminders

Built-in task management (priorities, due dates, automatic reminders), calendar events with location/time alerts, and the daily log all live alongside memory and are scoped/session-aware the same way.

Next: [Clients & projects](./clients-and-projects.md).
