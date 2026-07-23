# 🐱 r3to.os Docs

**r3to.os** is an AI that lives in your menu bar 24/7 — it remembers everything, learns how you work, and gets better over time. 

This is the in-repo documentation set, linked from the app's **Docs** menu item. It reflects the current codebase — if something here drifts from the app's actual behavior, check the source under `src/` first and open an issue/PR against [lama-assaf/pocket-agent](https://github.com/lama-assaf/pocket-agent).

## Contents

| Page | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Install, first launch, API key setup, Telegram, browser automation |
| [Memory & the Brain](./memory-and-brain.md) | Scoped memory model, facts/lessons/voice, the Brain workbench, daily logs, the "soul" system |
| [Clients & projects](./clients-and-projects.md) | Client workspaces, projects, the Clients picker, git-based brain sync/sharing |
| [Analytics](./analytics.md) | Post-performance tracking, LinkedIn sync, team-shared analytics export/import |
| [MCP integrations](./mcp.md) | The Model Context Protocol marketplace, built-in vs. marketplace servers, credentials |
| [CLI](./cli.md) | The standalone `pocket` CLI, install/update from Settings |
| [Settings](./settings.md) | Every settings category and what it controls |
| [Updating (unsigned macOS builds)](./updating-unsigned.md) | Why in-app auto-install can't work unsigned on macOS, how a release ships, and how testers update manually |

## The short version

- **Personal** is your private brain — never shared, never synced.
- **Agency (World)** is the shared base every client sits on top of.
- **Clients** are brands/workspaces with their own isolated memory (voice, facts, lessons, guardrails) that can sync to a shared git repo so a team works from one brain per brand.
- **Projects** are lightweight sub-scopes under a client.
- Everything is local-first: SQLite on your machine, your own Anthropic API key, no telemetry.

See [Getting started](./getting-started.md) to install and set up.
