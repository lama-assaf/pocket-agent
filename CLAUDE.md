# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# r3to.os

A persistent desktop AI that runs 24/7 as a menu-bar app, evolving from a single-brain personal assistant into a **client-first agency workspace**: one operator, many client brands, each with its own isolated, shareable brain (memory + voice + how-to-act). Powered by the Claude Agent SDK, with continuous memory, operator lanes (design/product/brand/social), Telegram, browser automation, and scheduled tasks.

Stack: Electron + TypeScript (ESM, `"type": "module"`) + better-sqlite3. **Requires Node 22 or 24** (LTS lines only — 23/25 break deps).

## What we're building (North Star)

**Pick a client first; everything flows from it.** Each client (brand) is a shared memory *scope* with its own on-disk brain — voice, guardrails, facts, lessons — that the agent reads and writes as you work, and that syncs to a git repo so a team shares one brain per brand. **Personal** stays first-class and private. **Agency (world)** is the shared base beneath every client. **Projects** are sub-scopes under a client.

- **Scoped memory** — every fact/lesson/voice note lives in a scope (`user` / `world` / `client:<id>` / `project:<id>` / `chat:<id>`). Personal never mixes with shared; one brand never sees another. Isolation is by construction, not convention.
- **Memory Workbench** — The Brain panel edits a client's **Facts** (brand knowledge), **Lessons** (learnings), and **How to act** (voice/tone/banned-words) in-app, scoped to the active client.
- **Voice from facts** — `how_to_act` facts drive the brand-voice injection and the banned-words tone guard live; on-disk `voice.md`/`guardrails` mirror in on pull and out on publish.
- **Operator lanes** — design/product/brand/social modes carry marketplace pack rules, skills, and specialist sub-agents, layered on top of the active client's voice.

## Commands

```bash
npm run dev          # Build (tsc ×2 + ESM import fix + seed copy) and launch the Electron app
npm run build        # Compile only (main + preload tsconfigs, fix-esm-imports, copy-seed-assets)
npm run typecheck && npm run lint   # REQUIRED after editing any file — fix ALL errors/warnings
npm run test         # All unit tests (Vitest, runs under plain Node)
npm test -- tests/unit/chat-engine.test.ts   # Single test file (keeps the pretest ABI check)
npm run test:watch   # Vitest watch mode
npm run verify       # Full CI check: format:check + lint + typecheck + test
npm run test:e2e     # Playwright E2E (builds + rebuilds native for Electron first; config in e2e/)
npm run eval:live    # Live guardrail-influence eval (tests/eval/)
npm run format       # Prettier auto-format src/
npm run dist:local   # Package unsigned macOS build (electron-builder)
```

## Code Quality - Zero Tolerance

After editing ANY file, run `npm run typecheck && npm run lint` and fix ALL errors/warnings before continuing.

> **Native module note:** `better-sqlite3` is rebuilt per-ABI (Electron vs. plain Node — see `docs/dev-setup.md` for the full explanation). `npm install`/`npm ci` fetch a prebuilt binary automatically (`prebuild-install`, no compiler needed in the common case); tests run under Node (the `pretest` hook checks/rebuilds); `npm run electron`'s `preelectron` hook rebuilds for Electron. A per-ABI cache (`scripts/native-cache.cjs`, gitignored, per machine) makes switching between the two fast after the first build of each side. If tests fail with `NODE_MODULE_VERSION`, run `npm rebuild better-sqlite3`; if `npm run electron`/`npm run dev` does, run `npm run rebuild:native`. CI caches `~/.npm` (and, for the Node-only `verify` job, `node_modules` itself) so this rarely triggers a real rebuild there either — see `docs/dev-setup.md`'s CI section.

> **ESM note:** Source compiles with `tsc`, then `scripts/fix-esm-imports.cjs` rewrites extensionless relative imports to `.js` — never hand-write `.ts` extensions in imports, and don't skip the build script chain by running bare `tsc && electron .`.

## Project Structure

```
src/
├── main/           # Electron main process (app lifecycle, tray, windows, IPC handlers in main/ipc/)
├── agent/          # Agent SDK wrapper (chat-engine), modes/lanes, how-to-act, write guards, plan approval
├── memory/         # SQLite persistence (messages, scoped facts, scope resolution, clients, projects, sessions, soul, embeddings)
├── clients/        # Client/world brains: scope paths, git sync (live-sync, sync-manager), facts↔files export, docs import, seeds
├── marketplace/    # Operator packs (atelier/salon): lanes, rules, skills, agents
├── channels/       # Communication channels (Telegram, desktop)
├── scheduler/      # Cron job management
├── browser/        # 2-tier browser automation (Electron + CDP)
├── tools/          # Agent tool implementations
├── integrations/   # Platform integrations (LinkedIn, X)
├── auth/           # OAuth/device-flow (GitHub, LinkedIn, OpenAI, Kimi)
├── config/         # Configuration and identity loading
├── settings/       # User preferences management
├── permissions/    # System permissions handling (macOS)
├── mcp/            # Model Context Protocol servers
└── utils/          # Shared helpers

ui/                 # HTML interfaces (chat, client picker, The Brain, settings, cron)
tests/unit/         # Vitest unit tests
tests/eval/         # Scripted-conversation + guardrail evals
e2e/                # Playwright specs against the packaged Electron app
docs/               # Deeper docs: dev-setup (native ABI), memory-and-brain, clients-and-projects, mcp, settings
.claude/            # Claude Code commands and skills (bundled into the packaged app)
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

## Key Architecture

**Scoped Memory:** Every fact/lesson/voice note carries a `scope`. `resolveVisibleScopes` turns a session's selected context (personal/world/client/project) into the ordered scopes visible for recall; `resolveNearestScope` picks where new writes land. The `user` (personal) scope is visible ONLY in the personal context — shared contexts never see it (`src/memory/scope.ts`).

**Client Brains:** Each client/world scope has an on-disk brain under `.atelier/memory/` (voice, instincts, lessons, glossary, facts) + `guardrails/`. `atelier-bridge` mirrors files → scoped facts on pull; `clients/export` materializes facts → files on publish; `clients/sync` does token-authed git clone/pull/commit/push with append-mostly reconciliation (lessons/decisions union; voice/guardrails single-owner). `clients/live-sync` auto-pulls live-mode clients on launch and debounces pushes.

**How-to-act:** `how_to_act` facts (subjects: `voice`, `tone`, `instincts`, `banned_words`) compose the brand-voice injection and feed the tone guard live (`src/agent/how-to-act.ts`), merged with marketplace lane rules + world facts. A nearer scope (client) overrides the agency (world) for the same subject — so a client's voice wins over the agency default.

**Operator Lanes:** design/product/brand/social modes map to lanes that pull marketplace pack rules, ~50 skills, and specialist sub-agents (atelier/salon), all scoped to the active client's context.

**Memory Layer:** SQLite with messages, facts (scoped + embedded for semantic recall), soul, daily logs, sessions, clients, and projects.

**Browser Automation:** Dual-tier — Electron hidden window (JS rendering) + CDP (authenticated sessions).

**Channel System:** Abstracts Telegram and desktop UI communication.

**Scheduler:** Cron-based task automation with SQLite persistence.
