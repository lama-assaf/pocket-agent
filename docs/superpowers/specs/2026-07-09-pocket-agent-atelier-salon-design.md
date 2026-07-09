# Pocket Agent × Atelier + Salon — Design

**Date:** 2026-07-09
**Status:** Draft for review
**Goal:** Ship Pocket Agent so it comes prebuilt with the Atelier (design/product/brand) and Salon (social/campaigns) operator systems — a non-technical user opens the native app and has the full operator experience without ever touching Claude Code.

---

## 1. Context

**Atelier** and **Salon** are sibling Claude Code marketplace plugins by lama-assaf, sharing one markdown format:

```
<plugin>/
  .claude-plugin/plugin.json     # name, version, description
  agents/*.md                    # frontmatter: name, description, tools, model + prompt body
  skills/<name>/SKILL.md         # frontmatter: name, description + workflow body
  commands/*.md                  # frontmatter: name, description + body (slash commands)
  rules/<lane>/*.md              # always-loaded lane guidance
  hooks/hooks.json               # UserPromptSubmit / PreToolUse / PostToolUse
  scripts/hooks/*.js             # hook implementations
  memory/                        # templates seeded into <project>/.atelier/memory/
```

- **Atelier:** 15 agents, 33 skills, 32 commands, 23 rules (lanes: design, product, brand, copy, common).
- **Salon:** 3 agents, 17 skills, 13 commands, social/brand/copy rules. Designed to co-install with Atelier: both read/write the **same** `<project>/.atelier/memory/` tree (Atelier owns `instincts.md`, `lessons.md`, `decisions/`, `glossary.md`; Salon adds `voice.md`, `campaigns/`). Salon's brand/copy rules are byte-identical copies of Atelier's, kept in sync.

**Pocket Agent** is a 24/7 native app (Electron tray, Telegram, iOS, SQLite memory + embeddings, cron scheduler) running on **`@kenkaiiii/gg-agent` + `@kenkaiiii/ggcoder`** — NOT the official Claude Agent SDK, and NOT the Claude Code plugin runtime. So the plugins' content is reusable, but their *runtime wiring* (Claude Code hooks, subagent format, plugin discovery) must be re-mapped onto Pocket Agent's engine.

### Runtime mapping (the whole design in one table)

| Plugin concept | Pocket Agent home | Mechanism |
|---|---|---|
| agents (`agents/*.md`) | dispatchable subagents inside a lane mode | extend `src/tools/subagent.ts` to load named agents |
| skills (`skills/*/SKILL.md`) | ggcoder skills (currently **dormant**) | enable `discoverSkills()` + `createSkillTool()` |
| commands (`commands/*.md`) | existing workflow-command loader | bundle into commands dir; namespaced `/atelier:*`, `/salon:*` |
| rules (`rules/**/*.md`) | per-mode system prompt | inject via `buildSystemGuidelines()` |
| memory (`.atelier/memory/`) | **both** file tree (canonical) + SQLite mirror | new `AtelierMemoryBridge` |
| hooks (`hooks.json`) | native seams in chat-engine / chat-tools | 3 ported hooks, see §8 |

### Decisions locked during brainstorming
- **Scope / delivery:** Atelier + Salon specifically, but as a **marketplace-inside-the-app**: the two repos are hardcoded *sources*, and their content is **synced from the og GitHub repos** into `<userData>/plugins/` (not vendored/compiled). A small **seed fallback** ships in the app for offline first-run; the synced copy is canonical and auto-updates. A 3rd pack later is one registry line.
- **No `src/packs/` content tree:** compiled content is frozen/read-only in a packaged app and can't self-update; the app already has a writable home (`app.getPath('userData')`, used for DB/models/attachments). Plugins live there. The repo gains only a small `src/marketplace/` code module + a small seed.
- **Update cadence:** background check on **app startup** + a manual **"Check for updates"** button. (No daily cron in v1.)
- **Agent surfacing:** 4 lane modes (Design, Product, Brand, Social); specialist agents are dispatchable subagents within a lane.
- **Switcher order:** operator lanes prominent, **Coder last**.
- **Memory:** do both — file tree canonical, mirrored into SQLite.
- **Hooks:** port all three, natively integrated.

---

## 2. Architecture

### 2.1 Marketplace: seed + sync + loader

Content is **not** vendored into a compiled `src/packs/`. It is installed to a writable per-user location and kept fresh from the og repos:

```
src/marketplace/
  registry.ts        # PACK_SOURCES: id, name, lanes, repo, branch — the "hardcoded both" (as sources)
  sync.ts            # PackSyncManager: seed → install → check → update from GitHub
  loader.ts          # readPack(dir) → { agents, skills, commands, rules, memoryTemplates }
  paths.ts           # getPluginsRoot() = <userData>/plugins ; getSeedRoot() = bundled seed
  seed/              # small offline fallback copy, shipped as a build resource
    atelier/  salon/

<userData>/plugins/  # RUNTIME CANONICAL — synced from repos
  atelier/  salon/
```

- **`registry.ts`** lists the two packs as `{ id, name, lanes, repo: 'lama-assaf/atelier', branch: 'main' }` and maps each lane → pack (Design/Product/Brand → atelier, Social → salon). Deliberate "hardcoded" wiring; a 3rd pack is one entry.
- **`PackSyncManager`** (`sync.ts`):
  - `ensureInstalled()` — on first run, if `<userData>/plugins/<id>` is empty, copy the bundled **seed** in so the app works offline immediately.
  - `checkAndUpdate()` — for each source, fetch the latest commit sha (`api.github.com/repos/<repo>/commits/<branch>`), compare to the stored `<userData>/plugins/<id>/.sha`; if changed, download the **tarball** (`codeload.github.com/<repo>/tar.gz/refs/heads/<branch>`), extract into `<userData>/plugins/<id>/`, write the new sha. No `git` dependency; extraction via the `tar` npm package.
  - Triggered on **startup** (background, non-blocking) and by a manual **"Check for updates"** IPC/button. Failure is non-fatal — the last good installed copy (or seed) keeps working offline.
- **`loader.ts`** is a pure filesystem reader (parse frontmatter → typed records) pointed at `getPluginsRoot()`. Unit-testable against a fixture dir.

**Interface:**
```ts
interface PackSource { id: string; name: string; lanes: LaneId[]; repo: string; branch: string; }
interface LoadedPack {
  id: string;
  agents: PackAgent[];      // { name, description, tools, model, prompt, source }
  skills: Skill[];          // ggcoder Skill shape { name, description, content, source }
  commands: { name; description; filename; content }[];
  rules: RuleFile[];        // { lane, filename, content, hash }
  memoryTemplates: MemoryTemplate[];   // { relativePath, content }
}
function getPluginsRoot(): string;                 // <userData>/plugins
function readPack(source: PackSource): LoadedPack; // reads getPluginsRoot()/<id>
class PackSyncManager {
  ensureInstalled(): Promise<void>;
  checkAndUpdate(): Promise<{ id: string; updated: boolean; sha: string }[]>;
}
```

### 2.2 Modes

New lane ids and `AGENT_MODES` entries in `src/agent/agent-modes.ts`:

```
AgentModeId = 'general' | 'design' | 'product' | 'brand' | 'social' | 'coder' | 'researcher' | 'writer' | 'therapist'
LaneId      = 'design' | 'product' | 'brand' | 'social'
```

Each lane mode:
- `engine: 'chat'`
- `systemPrompt`: composed from the pack operator persona (ATELIER.md / SOUL.md distilled) + lane framing (the operator loop: review / build / decide / synthesize).
- `mcpServers: ['pocket-agent']`
- carries its lane's rules (injected via guidelines) and its lane's skills (via discovery, §2.4).
- `canHandoffTo`: sibling lanes + general (so `switch_agent` still flows).

**Switcher ordering:** the UI renders from `getAllModes()`; introduce an explicit `order` field (or an ordered `MODE_DISPLAY_ORDER` array) so display is: General, Design, Product, Brand, Social, Researcher, Writer, Therapist, **Coder (last)**. Existing modes are unchanged in behavior.

> Note: `AgentMode.allowedTools` is currently documented as *not enforced* (`agent-modes.ts:18`). This design does not depend on enforcement; lane scoping is achieved by which skills/rules/subagents get loaded, not by `allowedTools`. Enforcing `allowedTools` is out of scope.

### 2.3 Specialist agents → subagents

Today `src/tools/subagent.ts` spawns ONE generic clean-slate worker (`SUB_AGENT_SYSTEM_PROMPT`, fixed 4-tool allowlist). Generalize it:

- Add a **named-agent registry** built from the active lane's `PackAgent[]`.
- The `subagent` tool gains an optional `agent` param (enum of available specialist names for the current lane). When set, the worker's system prompt = that agent's markdown body, and its tool allowlist is derived from the agent's declared `tools` (mapped to Pocket Agent tool names; unmapped tools dropped with a log).
- When `agent` is omitted, behavior is unchanged (generic worker) — backward compatible.
- Only agents for the **currently active lane** are offered, keeping the enum small.

**Interface:**
```ts
function getLaneAgents(lane: LaneId): PackAgent[];
// subagent tool params: { task: string; agent?: string }
```

### 2.4 Skills (enable the dormant pipeline)

ggcoder already ships `discoverSkills()`, `formatSkillsForPrompt()`, `createSkillTool()`, `parseSkillFile()` — Pocket Agent just never calls them.

- **Chat lane modes** (`getChatAgentTools`, `src/agent/chat-tools.ts`): add the ggcoder `skill` tool via `createSkillTool(skills)`, where `skills` = active lane's skills from the pack loader.
- **System prompt** (`buildSystemPrompt`, `src/agent/chat-engine.ts`): append `formatSkillsForPrompt(skills)` (names + descriptions only; bodies load on demand through the `skill` tool) into the **static** cacheable section, scoped to the active lane.
- **Coder mode** already has the plumbing (`buildCoderSystemPrompt(cwd)` / `createCoderTools(cwd)` accept a `skills` arg at `chat-engine.ts:319` / `chat-tools.ts:154`) but passes nothing — wire the same skill set through so on-disk `.gg/skills` + bundled skills both work.

Lane → skills selection is driven by `registry.ts` (each pack's skills are tagged to the lane(s) they belong to; Atelier skills split across design/product/brand by a lane map, Salon skills → social).

### 2.5 Commands

- Bundle all pack commands. Extend `src/config/commands-loader.ts` to also read the bundled pack command dirs (in addition to the existing `~/Documents/Pocket-agent/.claude/commands`).
- Namespace on load: `atelier:design-review`, `salon:campaign`, etc. (matches the plugins' own `/plugin:command` convention and avoids collisions like both packs having `remember`/`launch`/`content-calendar`).
- No new surface needed: the loader already feeds **desktop IPC** (`misc-ipc.ts`) and **Telegram** (`handlers/commands.ts`).

### 2.6 Rules

- Injected per active lane through `buildSystemGuidelines(mode)` (`src/config/system-guidelines.ts`).
- Design → `rules/design/*` + `rules/common/*`; Product → `rules/product/*` + common; Brand → `rules/brand/*` + `rules/copy/*` + common; Social → Salon's `rules/social/*` + `rules/brand/*` + `rules/copy/*`.
- Because Salon's brand/copy rules are byte-identical to Atelier's, the loader de-dupes by content hash so a co-loaded ruleset isn't injected twice.

---

## 3. Memory — both layers (§ decision: "do both")

Two coexisting stores with clear ownership:

### 3.1 Canonical: `.atelier/memory/` file tree (per project)
- Lives under the **session working directory** (`memory.getSessionWorkingDirectory(sessionId)`), matching how the real plugins resolve it.
- Files exactly as the plugins expect: `instincts.md`, `lessons.md`, `glossary.md`, `decisions/*.md`, `voice.md`, `campaigns/*`.
- **Source of truth** for operator memory. Skills/commands/agents read and write these files directly (via the existing `read`/`write`/`edit` tools + a `memory-init` tool that seeds missing files from `memoryTemplates`). This preserves byte-compatibility and Atelier↔Salon interop.

### 3.2 Mirror: SQLite (for search + UI)
- A new **`AtelierMemoryBridge`** (`src/memory/atelier-bridge.ts`) mirrors the file tree into Pocket Agent's SQLite so:
  - semantic recall (`recall_memory` / embeddings) can surface operator memory, and
  - the desktop/Telegram **facts UI** can display it.
- **Sync direction:** file tree → SQLite (file tree is canonical). Triggers: (a) on session load / project switch, (b) after any write to a path under `.atelier/memory/` (detected in the post-write hook, §8.3), (c) on `memory-init`.
- Mirrored rows are tagged (`source: 'atelier-memory'`, `project: <dir>`, `file: <relpath>`) so they're clearly distinct from — and never overwrite — Pocket Agent's **global** user facts/soul. Re-sync is idempotent (delete-by-tag + reinsert, then re-embed changed content).
- Global SQLite facts + soul remain the cross-project "who the user is" layer, untouched.

**Interface:**
```ts
class AtelierMemoryBridge {
  constructor(memory: MemoryManager);
  syncProject(projectDir: string): Promise<{ files: number; chunks: number }>;
  onMemoryFileWritten(absPath: string, projectDir: string): Promise<void>;
  seed(projectDir: string, templates: MemoryTemplate[]): Promise<string[]>; // returns files created
}
```

---

## 4. Hooks — full, natively integrated (§ decision: full)

Claude Code's hook events don't exist in gg-agent, so each hook becomes a native seam:

### 4.1 `UserPromptSubmit` → pre-turn context injector
- Plugin behavior: keyword-match the prompt → surface relevant skill/rule files.
- Native: a `buildLaneContextInjection(userMessage, lane)` step folded into the **dynamic** part of `buildSystemPrompt` (`chat-engine.ts`). It reuses the plugins' `KEYWORDS` map (ported to TS) to pull **full rule/skill file content** for strong matches — complementing (not replacing) ggcoder's description-level skill listing. Keyword hits inject full text; everything else stays description-only and loads on demand.

### 4.2 `PreToolUse: Write|Edit` → anti-AI-tone / banned-words guard
- Plugin behavior: scan drafts for banned tone/filler before save.
- Native: extend the existing `wrapWithWritePathSafety` seam in `chat-tools.ts` (already wraps `write`/`edit`) into `wrapWithWriteGuards`, adding a tone/banned-words scan sourced from `rules/brand/banned-words.md` + `rules/copy/anti-ai-tone.md`. On a hit it returns a **warning prepended to the tool result** (non-blocking by default) so the agent can self-correct; a setting can make it hard-block. De-dupe: single guard even when both packs loaded (rules are identical).

### 4.3 `PostToolUse: Write|Edit` → log + memory sync
- Plugin behavior: log writes.
- Native: a post-execute wrapper on `write`/`edit` that (a) appends a line to `daily_log` and (b) if the written path is under `.atelier/memory/`, calls `AtelierMemoryBridge.onMemoryFileWritten()` to re-mirror into SQLite (§3.2).

All three are gated by a `features.operatorPacks` setting (default on) so they can be disabled wholesale.

---

## 5. Data flow (a lane-mode turn)

```
User (desktop / Telegram) → AgentManager.processMessage(sessionId, msg)
  → mode = getSessionMode()  (e.g. 'design')
  → buildSystemPrompt:
       static:  guidelines + lane rules (§2.6) + lane persona + formatSkillsForPrompt(laneSkills)
       dynamic: facts + soul + daily logs + buildLaneContextInjection(msg, lane)  (§4.1)
  → getChatAgentTools:  custom tools + read/write(+guards §4.2) + web_fetch + shell
                        + skill tool (laneSkills) + subagent tool (laneAgents §2.3)
  → agentLoop() runs; model may:
       · invoke a skill  → loads SKILL.md body on demand
       · dispatch subagent{agent:'design-reviewer', task} → specialist worker
       · read/write .atelier/memory/*  → post-write hook mirrors to SQLite (§4.3)
  → response saved to SQLite messages, broadcast to channel
```

---

## 6. Components & isolation

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/marketplace/registry.ts` | Declares the two pack sources (repos) + lane map | — |
| `src/marketplace/sync.ts` | Seed on first run; check + download + extract updates from GitHub | fs, fetch, tar |
| `src/marketplace/paths.ts` | `getPluginsRoot()` (userData) + `getSeedRoot()` (bundled) | Electron app paths |
| `src/marketplace/loader.ts` | Read pack markdown → typed records | fs, frontmatter parse |
| `src/agent/agent-modes.ts` (edit) | 4 lane modes + display order | packs registry |
| `src/tools/subagent.ts` (edit) | Named specialist workers | pack agents |
| `src/agent/chat-tools.ts` (edit) | Skill tool + write guards | ggcoder, packs, rules |
| `src/agent/chat-engine.ts` (edit) | Skill prompt + lane context injection | packs, memory |
| `src/config/system-guidelines.ts` (edit) | Per-lane rule injection | pack rules |
| `src/config/commands-loader.ts` (edit) | Load + namespace pack commands | packs |
| `src/memory/atelier-bridge.ts` | File tree ↔ SQLite mirror | MemoryManager, fs |
| `src/tools/atelier-memory-tools.ts` | `memory-init` tool | bridge, packs |

Each is independently testable; edits to existing files are additive and keep current modes/behavior working.

---

## 7. Error handling
- **Missing/corrupt pack file:** loader skips the file, logs a warning, continues (a bad skill never crashes startup).
- **Unmapped agent tool name:** dropped with a log; subagent still runs with the mapped subset.
- **Project without a working dir:** `.atelier/memory/` falls back to the default workspace (mirrors `getCoderCwd`); memory-init tells the user to set a project first.
- **Bridge sync failure:** logged; the canonical file tree is unaffected, semantic recall degrades to global facts only.
- **Write guard false positive:** non-blocking warning by default; never silently discards the user's content.

## 8. Testing (Vitest, `tests/unit/`)
- `loader`: parses a fixture pack; frontmatter, skill/agent/command/rule counts, malformed-file resilience.
- `registry`: lane→pack and lane→skills maps are complete and collision-free.
- `agent-modes`: 4 new modes present, display order ends with `coder`, handoffs valid.
- `subagent`: named agent selects correct prompt + tool subset; omitted `agent` = legacy path.
- `atelier-bridge`: seed creates only missing files (never overwrites); sync is idempotent; mirror rows tagged and isolated from global facts.
- `write-guards`: banned-word/anti-AI-tone hit → warning; clean text → passthrough; single warning when both packs loaded.
- `commands-loader`: pack commands namespaced; `atelier:*` and `salon:*` both present; no dupes.
- `rules` de-dupe: identical brand/copy rules injected once.

## 9. Out of scope (v1)
Cross-harness adapters (Cursor/Codex/…), dashboard site, install profiles, browsable marketplace *UI* beyond a "Check for updates" button, private-repo auth tokens, daily scheduled sync, `allowedTools` enforcement, iOS-specific surfaces, syncing SQLite edits back to the file tree (mirror is one-way). In-app *sync from the og repos* IS in scope (§2.1).

## 10. Open questions
- Persona source: distill ATELIER.md/SOUL.md into each lane prompt, or ship a single shared operator preamble + thin lane deltas? (Leaning: shared preamble + lane delta, to avoid 4 near-duplicate prompts.)
- Should `memory-init` run automatically on first project switch, or stay an explicit `/atelier:memory-init` command? (Leaning: explicit, matching the plugins.)
