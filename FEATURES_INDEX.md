# Pocket Agent - Features & Systems Index

**Quick reference guide to all features, tools, and systems in Pocket Agent**

---

## 🚀 QUICK START

**New to Pocket Agent?** Start with:
1. [Client Workspaces](#client-workspaces-brand-brains) - Pick a client, everything scopes to it
2. [Chat Tools](#chat-tools) - What you can do conversationally
3. [Memory System](#memory-system) - How it remembers you
4. [Channels](#channels) - Where you can use it

---

## 📋 FULL INDEX

### CLIENT WORKSPACES (BRAND BRAINS)

Pick a client (brand) and everything — memory, voice, how the agent should act — scopes to it. Personal stays private; Agency ("world") is the shared base beneath every client; Projects are sub-scopes under a client.

**Scopes:** `user` (personal, private) · `world` (agency-wide shared base) · `client:<id>` (one brand) · `project:<id>` (sub-scope under a client) · `chat:<id>` (per-session). `resolveVisibleScopes`/`resolveNearestScope` (`src/memory/scope.ts`) decide what's visible to recall and where a new write lands — personal never leaks into shared, one client never sees another.

**The Brain workbench** (`ui/chat/brain-panel.js`, `brain-panel.html` section in `chat.html`) edits a client's:
- **Facts** — brand knowledge
- **Lessons** — what's been learned
- **How to act** — voice, tone, banned words (subjects under the `how_to_act` category — see `src/agent/how-to-act.ts`) that compose the brand-voice injection and feed the live tone guard

Creating a client (`cvCreateClient` in `ui/chat/clients-view.js`) routes straight into The Brain's "How to act" tab for that client so its voice/facts get populated before the agent starts drafting in an empty brand voice.

**Shareable brains.** Each client/world scope has an on-disk brain under `.atelier/memory/` (voice, instincts, lessons, glossary, facts) + `guardrails/`, synced via a git repo (`src/clients/sync.ts` — token-authed clone/pull/commit/push, append-mostly reconciliation). `atelier-bridge` mirrors files → scoped facts on pull; `clients/export` materializes facts → files on publish. Clients flag themselves **stale** after 24h with no pull; "Pull All" sweeps every live-sync client, and `sync_mode: 'live'` (default) auto-pulls on launch.

**Joining a teammate's client:** "Copy setup link" on a client card copies a `pocketagent://join?...` string (repo + client id/name only, never a credential); "Join a Client" creates the client locally and pulls its brain immediately using the joiner's own token.

[DB tables](#database) — `clients`, `projects`. [IPC](#-architecture) — `src/main/ipc/sessions-ipc.ts` (client/project handlers); UI — `ui/chat/clients-view.js`, `ui/chat/brain-panel.js`.

---

### CONTENT WORKFLOW (DRAFT → APPROVAL → POST)

Per-brand content drafts that move through a human-gated approval pipeline before anything gets posted (`src/memory/content-drafts.ts`).

**Two tables:**
- `content_drafts` — one row per piece of content, scoped like facts. The row IS the current state (status + scheduling info).
- `content_posts` — an append-only audit log of every post attempt (dry-run or real) against a draft, so post history survives retries.

**State machine:** `draft → pending_approval → approved → scheduled/posted/failed`, plus `rejected`. The agent can submit a draft for approval; only a human can approve or reject (enforced server-side in `canTransition`, not just by UI convention). The posting/scheduling tool layer (`src/tools/content-tools.ts`) additionally hard-requires `status === 'approved'` before acting.

**UI:** Content Queue panel (`ui/chat/content-panel.js`) — list/detail view, submit/approve/reject/schedule/retry actions, post history. A posted draft with a captured `external_ref` can jump straight into Analytics with its channel/post-ref prefilled (`cntRecordAnalyticsForDraft`) so the recorded snapshot joins back to it correctly.

[DB tables](#database) — `content_drafts`, `content_posts`. [IPC](#-architecture) — `src/main/ipc/content-ipc.ts`.

---

### CAMPAIGNS (MULTI-DELIVERABLE PLANS)

A lightweight persisted plan (`src/memory/campaigns.ts`) so the orchestrating model can manage multi-deliverable work across turns and days. The campaign is durable STATE only — doing a deliverable's actual work still goes through the existing subagent tool (`src/tools/subagent.ts`).

**Two tables:**
- `campaigns` — one row per plan, scoped like facts/content_drafts.
- `campaign_deliverables` — one row per unit of work, with an optional `depends_on` pointing at another deliverable in the same campaign (a deliverable can't start until its dependency is `done`, enforced by `canStartDeliverable`).

A deliverable's `result_ref` can point at a content-workflow draft (`content_draft:<id>`, via `linkDeliverableToContentDraft`), so the campaign board cross-references straight into the Content Queue panel (`cpnOpenContentDraft`) — and campaign analytics roll up whatever content that campaign's deliverables produced (`MemoryManager.getCampaignAnalytics`).

**UI:** Campaign board (`ui/chat/campaign-panel.js`) — deliverable status board, link-to-content-draft picker, "nudge" action that prefills the chat composer with a prompt for the next unblocked deliverable.

[DB tables](#database) — `campaigns`, `campaign_deliverables`. [IPC](#-architecture) — `src/main/ipc/campaign-ipc.ts`.

---

### ANALYTICS (PER-POST PERFORMANCE)

Per-post performance metrics — impressions, likes, comments, shares, clicks, video views — for X/LinkedIn/etc. (`src/memory/analytics.ts`), scoped like facts so one brand's numbers never leak into another's.

`post_analytics` is **append-only**: a post's numbers keep climbing for days, so each ingestion (manual entry or MCP/API sync) writes a new snapshot row rather than overwriting the last one. "Current numbers" = the latest snapshot per post (`getLatestPostAnalyticsForScopes`); "performance over time" is the full history (`getPostAnalyticsHistory`).

Each row also carries the post's direct URL, lead/thread text, and notable replies (`post_url`, `thread_text`, `top_comments`) alongside the numeric metrics.

**Sources:**
- `manual` — paste numbers straight from a platform's own dashboard, no API key needed (default, zero-config path)
- `mcp` — automated ingestion; currently wired for **LinkedIn** only (`src/integrations/linkedin/sync.ts`, org URN stored per-scope as a fact). X/Twitter has no automated sync yet — manual entry only.

**UI:** Analytics panel (`ui/chat/analytics-panel.js`) — overall + per-channel + per-campaign summaries, per-post drill-down, "record a snapshot" form (prefillable from a posted content draft).

[DB tables](#database) — `post_analytics`. [IPC](#-architecture) — `src/main/ipc/analytics-ipc.ts` (record/list/history), `src/main/ipc/linkedin-ipc.ts` (org URN config + sync-now).

---

### TOOLS (45+)

#### Browser Tools
- **browser** - Automate web tasks
  - 14 actions: navigate, screenshot, click, type, evaluate, extract, scroll, hover, download, upload, tabs_list, tabs_open, tabs_close, tabs_focus
  - Two tiers: Electron (default) or CDP (Chrome)
  - [Full docs](FEATURES_MAPPING.md#browser-tool)

#### Memory Tools (5)
- **remember** - Save facts to long-term memory
- **forget** - Remove facts
- **list_facts** - View all memories
- **memory_search** - Semantic + keyword search
- **daily_log** - Journal entries with auto-timestamps
- [Full docs](FEATURES_MAPPING.md#memory-tools)

#### Soul Tools (4)
- **soul_set** - Record relationship dynamics
- **soul_get** - Retrieve specific aspect
- **soul_list** - View all aspects
- **soul_delete** - Remove aspect
- [Full docs](FEATURES_MAPPING.md#soul-tools)

#### Scheduler Tools (4)
- **create_routine** - Schedule LLM-executed prompts
- **create_reminder** - Simple notifications
- **list_routines** - View all scheduled jobs
- **delete_routine** - Remove routine
- [Full docs](FEATURES_MAPPING.md#scheduler-tools)

#### Calendar Tools (4)
- **calendar_add** - Create events with reminders
- **calendar_list** - View events by date
- **calendar_upcoming** - Get next N hours of events
- **calendar_delete** - Remove event
- [Full docs](FEATURES_MAPPING.md#calendar-tools)

#### Task Tools (5)
- **task_add** - Add todo with priority & due date
- **task_list** - View tasks by status
- **task_complete** - Mark done
- **task_delete** - Remove task
- **task_due** - Filter by due date
- [Full docs](FEATURES_MAPPING.md#task-tools)

#### Project Tools (3)
- **set_project** - Switch working directory
- **get_project** - View active project
- **clear_project** - Reset to default
- [Full docs](FEATURES_MAPPING.md#project-tools)

#### System Tools (2)
- **notify** - Send desktop notifications
- **diagnostics** - Monitor tool health
- [Full docs](FEATURES_MAPPING.md#macos-tools)

---

### MEMORY SYSTEM

**Core Features:**
- Persistent storage in SQLite
- Semantic search (vector + keyword)
- 7 main tables (sessions, messages, facts, chunks, daily_logs, soul_aspects, summaries)
- 45+ public methods
- Auto-embeddings (OpenAI text-embedding-3-small)
- Context compaction (rolling summaries)
- Per-session isolation (up to 5 sessions)

**Key Capabilities:**
1. **Long-term memory** - Save and retrieve facts
2. **Semantic search** - Find relevant memories
3. **Daily journaling** - Log entries with timestamps
4. **Relationship tracking** - Soul aspects about working dynamics
5. **Smart context** - Recent + relevant + compressed messages
6. **Multi-session** - Isolated conversation threads

[Full docs](FEATURES_MAPPING.md#memory-system)

---

### SCHEDULING & AUTOMATION

**Schedule Types:**
- Cron: `0 9 * * MON` (standard cron format)
- At: `tomorrow 3pm`, `in 10 minutes` (one-time)
- Every: `every 30m`, `every 2h` (recurring)
- Duration: `30m`, `2h` (shorthand one-time)

**Job Types:**
1. **Routine** - Full LLM execution with all tools
2. **Reminder** - Simple notification (no LLM)

**Features:**
- Calendar event reminders
- Task due date reminders
- Channel routing (desktop/telegram/ios)
- Job history (last 100)
- Auto-reload every 60 seconds

[Full docs](FEATURES_MAPPING.md#scheduling--automation)

---

### BROWSER AUTOMATION

**Three-Tier System:**

1. **Electron Tier** (default)
   - Hidden window rendering
   - No setup required
   - Cannot access logged-in sessions
   - Single tab

2. **CDP Tier** (Chrome DevTools Protocol)
   - Connects to user's Chrome
   - Requires: `chrome --remote-debugging-port=9222`
   - Access to logged-in sessions
   - Multi-tab support

3. **Smart Selection**
   - Auto-picks best tier
   - Falls back if needed
   - User can force specific tier

**14 Actions:**
- navigate, screenshot, click, type, evaluate, extract, scroll, hover
- download, upload, tabs_list, tabs_open, tabs_close, tabs_focus

**Extract Types:**
- text, html, links, tables, structured

[Full docs](FEATURES_MAPPING.md#browser-automation)

---

### CHANNELS

#### Desktop
- Electron notifications
- Window focus
- Built-in (always available)

#### Telegram
- **8 Commands**: /start, /status, /facts, /clear, /link, /unlink, /mychatid
- **Message Types**: Text, photo, voice, audio, document, location
- **Features**: Reactions, inline keyboards, typing indicator, document processing
- **Security**: User ID allowlist
- **Groups**: Multi-group session linking
- [Full docs](FEATURES_MAPPING.md#telegram-channel)

#### iOS
- **Modes**: Cloud relay (default) or local WebSocket
- **25+ Handlers**: Core messaging, sessions, models, memory, automation
- **Features**: Push notifications, pairing codes, device tracking
- **Full Parity**: Desktop feature access from iOS
- [Full docs](FEATURES_MAPPING.md#ios-channel)

---

### SETTINGS & CONFIGURATION

**Categories (60+):**

| Category | Examples |
|----------|----------|
| Auth | API keys, OAuth tokens |
| Agent | Model, mode, thinking level |
| Telegram | Bot token, user allowlist |
| iOS | Relay URL, instance ID, port |
| Browser | Use My Browser, CDP URL |
| Personalization | Name, timezone, personality |
| UI/Theme | Dark/light, font size, compact |
| Features | Enable/disable channels |

**All Settings Encrypted** via Electron safeStorage

[Full docs](FEATURES_MAPPING.md#settings--configuration)

---

### AUTHENTICATION

- **OAuth** - PKCE flow with Anthropic
- **API Key** - Direct API key option
- **Token Refresh** - Auto-refresh on expiry
- **Encryption** - Stored in OS keychain
- **Fallback** - Graceful degradation

[Full docs](FEATURES_MAPPING.md#authentication)

---

### AGENT & CHAT ENGINE

**Modes:**

| Mode | Features | Use Case |
|------|----------|----------|
| **Coder** (default) | Full SDK, code exec, debugging | Development, code analysis |
| **General** | Lightweight, memory + tools | Fast queries, casual chat |

**System Prompt Building:**
1. Developer guidelines (memory usage, soul, CLI)
2. User facts (from long-term memory)
3. Soul aspects (relationship dynamics)
4. Daily logs (last 3 days)
5. User customizations (personality, rules)

**Multi-Provider:**
- Anthropic (primary)
- Moonshot/Kimi
- Z.AI GLM

[Full docs](FEATURES_MAPPING.md#agent--chat-engine)

---

### USER INTERFACE

**Standalone templates** (`ui/*.html`): `chat.html` (main window — hosts the chat plus every embedded panel below), `cron.html`, `customize.html`, `daily-logs.html`, `facts.html`, `soul.html`.

**Embedded panels inside chat.html** (each its own `ui/chat/*-panel.js`, shown/hidden over the chat view, same `_dismissOtherPanels` convention): Settings, The Brain (Facts/Lessons/How-to-act), Agents, Content Queue, Campaigns, Analytics, Routines, Personalize, Clients (workspace picker), Onboarding.

**Features:**
- Real-time updates via EventEmitter
- IPC communication
- Dark/light themes + custom skins
- Cross-panel deep links (e.g. a campaign deliverable's linked content draft opens straight in the Content Queue; a posted draft can jump into Analytics with its post pre-filled; creating a client opens straight into its Brain)

[Full docs](FEATURES_MAPPING.md#user-interface)

---

### MCP SERVERS

**Browser MCP**
- JSON-RPC 2.0
- Tools: browser, notify
- Standalone browser automation

**Project MCP**
- Project management via MCP
- Tools: set_project, get_project
- SQLite backed

[Full docs](FEATURES_MAPPING.md#mcp-servers)

---

## 📊 DATABASE

All tables live in one SQLite file (`src/memory/index.ts`), scoped by `scope` (`user` / `world` / `client:<id>` / `project:<id>` / `chat:<id>`) wherever the row is brand/personal-specific. Settings (API keys, tokens) are **not** in SQLite — they're encrypted via Electron's `safeStorage` (see [Settings](#settings--configuration)).

**Core tables:**
1. `sessions` - Conversation threads
2. `clients` - Client/brand workspaces
3. `projects` - Sub-scopes under a client
4. `messages` - Chat history + embeddings
5. `facts` - Long-term memory (scoped, embedded for semantic recall; includes `how_to_act` voice/tone/banned-words facts)
6. `facts_fts` - Full-text search index over facts (FTS5 virtual table)
7. `daily_logs` - Daily journaling
8. `soul` - Relationship-dynamics aspects
9. `cron_jobs` - Scheduled tasks (routines/reminders)
10. `calendar_events` - Calendar items
11. `tasks` - Todo items
12. `telegram_chat_sessions` - Telegram group ↔ session links
13. `summaries` / `rolling_summaries` - Context compaction
14. `content_drafts` - Content-workflow queue (draft → approval → post state)
15. `content_posts` - Append-only post-attempt audit log
16. `campaigns` - Multi-deliverable plans
17. `campaign_deliverables` - Per-deliverable work items
18. `post_analytics` - Append-only per-post performance snapshots

**Internal support tables:** `daily_log_rollups`, `memory_meta`, `pulse_log`.

[Full schema](FEATURES_MAPPING.md#database-schema)

---

## 🏗️ ARCHITECTURE

**5 Layers:**
1. **UI** - HTML templates + IPC
2. **Main** - Electron main process
3. **Agent** - AgentManager + SDK/ChatEngine
4. **Systems** - Memory, Browser, Scheduler, Settings
5. **Storage** - SQLite + filesystem

**Key Patterns:**
- Singleton (managers)
- Factory (channels)
- Observer (status updates)
- Repository (persistence)
- Strategy (browser tiers)

[Full architecture](FEATURES_MAPPING.md#-architecture-summary)

---

## 🔌 EXTENSIBILITY

**Add a Tool:**
→ Create `/src/tools/my-tool.ts`
→ Export definition + handler
→ Register in index.ts

**Add a Channel:**
→ Extend BaseChannel
→ Implement start/stop/send
→ Register in main process

**Add MCP Server:**
→ Create MCP server
→ JSON-RPC 2.0 protocol
→ Register in buildMCPServers()

[Full guide](FEATURES_MAPPING.md#-extensibility-points)

---

## ⚡ QUICK REFERENCE

**What to use for...**

| Need | Tool |
|------|------|
| Save important info | remember |
| Search your memory | memory_search |
| Schedule LLM action | create_routine |
| Set working dir | set_project |
| Create todo | task_add |
| Add event | calendar_add |
| Automate browser | browser |
| Quick reminder | create_reminder |
| Record learning | soul_set |
| Log entry | daily_log |
| Desktop notification | notify |

---

## 📚 DOCUMENT STRUCTURE

- **FEATURES_MAPPING.md** (1,418 lines, 42.4 KB)
  - Complete feature reference
  - Every tool documented
  - All systems explained
  - Database schema
  - Architecture diagrams
  - Extensibility guide

- **FEATURES_INDEX.md** (this file)
  - Quick reference
  - Cross-links to full docs
  - At-a-glance tables
  - Quick start guide

---

## 🎯 WHERE TO GO NEXT

**I want to...**

- **Use a specific tool** → See [Tools section](#tools-45) or [FEATURES_MAPPING.md](FEATURES_MAPPING.md)
- **Understand memory** → [Memory System section](#memory-system) or [full docs](FEATURES_MAPPING.md#memory-system)
- **Set up Telegram** → [Telegram Channel](FEATURES_MAPPING.md#telegram-channel)
- **Add a feature** → [Extensibility guide](FEATURES_MAPPING.md#-extensibility-points)
- **See all settings** → [Settings section](FEATURES_MAPPING.md#settings--configuration)
- **Understand architecture** → [Architecture section](FEATURES_MAPPING.md#-architecture-summary)
- **Check database schema** → [Database section](FEATURES_MAPPING.md#database-schema)
- **See data flows** → [Data Flow Diagrams](FEATURES_MAPPING.md#-data-flow-diagrams)

---

## 📊 BY THE NUMBERS

| Item | Count |
|------|-------|
| Tools | 45+ |
| Browser actions | 14 |
| Memory tools | 5 |
| Scheduler tools | 4 |
| Calendar tools | 4 |
| Task tools | 5 |
| Project tools | 3 |
| Channels | 3 |
| Telegram commands | 8 |
| iOS handlers | 25+ |
| Database tables | 18 core (+3 internal support) |
| Settings | 60+ |
| MCP servers | 2 |
| Session modes | 2 |
| Schedule types | 4 |
| Standalone UI templates | 6 |
| Embedded chat panels | 10 |
| Memory scopes | 5 (user/world/client/project/chat) |
| API providers | 3 |

---

**Last Updated:** 15 July 2026  
**Documentation Version:** 1.1  
**Status:** Complete & Exhaustive

For detailed information on any feature, see [FEATURES_MAPPING.md](FEATURES_MAPPING.md)
