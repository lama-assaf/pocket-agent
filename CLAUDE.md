# Pocket Agent

A persistent desktop AI that runs 24/7 as a menu-bar app, evolving from a single-brain personal assistant into a **client-first agency workspace**: one operator, many client brands, each with its own isolated, shareable brain (memory + voice + how-to-act). Powered by the Claude Agent SDK, with continuous memory, operator lanes (design/product/brand/social), Telegram, browser automation, and scheduled tasks.

## What we're building (North Star)

**Pick a client first; everything flows from it.** Each client (brand) is a shared memory *scope* with its own on-disk brain — voice, guardrails, facts, lessons — that the agent reads and writes as you work, and that syncs to a git repo so a team shares one brain per brand. **Personal** stays first-class and private. **Agency (world)** is the shared base beneath every client. **Projects** are sub-scopes under a client.

- **Scoped memory** — every fact/lesson/voice note lives in a scope (`user` / `world` / `client:<id>` / `project:<id>` / `chat:<id>`). Personal never mixes with shared; one brand never sees another. Isolation is by construction, not convention.
- **Memory Workbench** — The Brain panel edits a client's **Facts** (brand knowledge), **Lessons** (learnings), and **How to act** (voice/tone/banned-words) in-app, scoped to the active client.
- **Voice from facts** — `how_to_act` facts drive the brand-voice injection and the banned-words tone guard live; on-disk `voice.md`/`guardrails` mirror in on pull and out on publish.
- **Operator lanes** — design/product/brand/social modes carry marketplace pack rules, skills, and specialist sub-agents, layered on top of the active client's voice.

## Project Structure

```
src/
├── main/           # Electron main process (app lifecycle, tray, windows, IPC)
├── agent/          # Agent SDK wrapper, modes/lanes, how-to-act, write guards
├── memory/         # SQLite persistence (messages, scoped facts, clients, projects, sessions)
├── clients/        # Client/world brains: scope paths, git sync, facts↔files export
├── marketplace/    # Operator packs (atelier/salon): lanes, rules, skills, agents
├── channels/       # Communication channels (Telegram, desktop)
├── scheduler/      # Cron job management
├── browser/        # 2-tier browser automation (Electron + CDP)
├── tools/          # Agent tool implementations
├── config/         # Configuration and identity loading
├── settings/       # User preferences management
├── auth/           # OAuth flows for integrations
├── permissions/    # System permissions handling (macOS)
├── mcp/            # Model Context Protocol servers
└── utils/          # Shared helpers

ui/                 # HTML interfaces (chat, client picker, The Brain, settings, cron)
tests/unit/         # Vitest unit tests
assets/             # Tray icons and static assets
.claude/            # Claude Code commands and skills
```

## Organization Rules

**Keep code organized by responsibility:**
- Electron main process → `src/main/`
- Agent logic, modes, lanes → `src/agent/`
- Persistence, scopes, clients, projects → `src/memory/`
- Client/world brains, scoping, sync, export → `src/clients/`
- Operator packs (rules/skills/agents) → `src/marketplace/`
- External channels → `src/channels/`
- Tool implementations → `src/tools/`
- Configuration → `src/config/` and `src/settings/`
- Browser automation → `src/browser/`

**Modularity principles:**
- Single responsibility per file
- Clear, descriptive file names
- Group related functionality together
- Avoid monolithic files

## Code Quality - Zero Tolerance

After editing ANY file, run:

```bash
npm run typecheck && npm run lint
```

Fix ALL errors/warnings before continuing.

**Available scripts:**
- `npm run lint` - ESLint check
- `npm run lint:fix` - Auto-fix lint issues
- `npm run typecheck` - TypeScript type checking
- `npm run format` - Prettier auto-format
- `npm run test` - Run all tests

> **Native module note:** `better-sqlite3` is rebuilt per-ABI. Tests run under Node (the `pretest` hook checks/rebuilds); `npm run electron`'s `preelectron` hook rebuilds for Electron. If tests fail with `NODE_MODULE_VERSION`, run `npm rebuild better-sqlite3`.

## Key Architecture

**Scoped Memory:** Every fact/lesson/voice note carries a `scope`. `resolveVisibleScopes` turns a session's selected context (personal/world/client/project) into the ordered scopes visible for recall; `resolveNearestScope` picks where new writes land. The `user` (personal) scope is visible ONLY in the personal context — shared contexts never see it (`src/memory/scope.ts`).

**Client Brains:** Each client/world scope has an on-disk brain under `.atelier/memory/` (voice, instincts, lessons, glossary, facts) + `guardrails/`. `atelier-bridge` mirrors files → scoped facts on pull; `clients/export` materializes facts → files on publish; `clients/sync` does token-authed git clone/pull/commit/push with append-mostly reconciliation (lessons/decisions union; voice/guardrails single-owner).

**How-to-act:** `how_to_act` facts (subjects: `voice`, `tone`, `instincts`, `banned_words`) compose the brand-voice injection and feed the tone guard live (`src/agent/how-to-act.ts`), merged with marketplace lane rules + world facts. A nearer scope (client) overrides the agency (world) for the same subject — so a client's voice wins over the agency default.

**Operator Lanes:** design/product/brand/social modes map to lanes that pull marketplace pack rules, ~50 skills, and specialist sub-agents (atelier/salon), all scoped to the active client's context.

**Memory Layer:** SQLite with messages, facts (scoped + embedded for semantic recall), soul, daily logs, sessions, clients, and projects.

**Browser Automation:** Dual-tier — Electron hidden window (JS rendering) + CDP (authenticated sessions).

**Channel System:** Abstracts Telegram and desktop UI communication.

**Scheduler:** Cron-based task automation with SQLite persistence.
