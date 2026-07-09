# Atelier + Salon Operator Packs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Pocket Agent prebuilt with the Atelier (design/product/brand) and Salon (social/campaigns) operator systems, surfaced as native lane modes, skills, commands, rules, hooks, and memory.

**Architecture:** Sync both plugins' markdown from the og GitHub repos into `<userData>/plugins/` (bundled seed as offline fallback), read by a pure loader. Four new lane modes in `AGENT_MODES` compose their lane's rules (system prompt), skills (ggcoder `discoverSkills`/`createSkillTool`, currently dormant), and specialist agents (dispatchable subagents). Operator memory lives in a canonical `.atelier/memory/` file tree, mirrored one-way into SQLite for semantic recall + UI. Three Claude Code hooks are re-mapped onto native seams in `chat-engine.ts` / `chat-tools.ts`.

**Tech Stack:** TypeScript, Electron, `@kenkaiiii/gg-agent` + `@kenkaiiii/ggcoder`, better-sqlite3, Vitest, Zod.

## Global Constraints

- After editing ANY file: `npm run typecheck && npm run lint` must pass with zero errors/warnings (CLAUDE.md, zero tolerance).
- Tests are Vitest under `tests/unit/`, matched by `tests/**/*.test.ts` (vitest.config.ts:7).
- Do NOT modify existing mode behavior (`general`, `coder`, `researcher`, `writer`, `therapist`) except display order.
- All pack commands namespaced `<pack>:<command>` (e.g. `atelier:design-review`, `salon:campaign`) — both packs define colliding names (`remember`, `launch`, `content-calendar`).
- Operator memory canonical location: `<sessionWorkingDir>/.atelier/memory/`; SQLite mirror is one-way (file → SQLite), never the reverse.
- Salon's `rules/brand/*` and `rules/copy/*` are byte-identical to Atelier's — de-dupe by content hash so they inject/scan once.
- Everything gated by setting `features.operatorPacks` (default `'true'`).
- Frontmatter parsing follows the existing regex pattern in `src/config/commands-loader.ts:40` (`/^---\n([\s\S]*?)\n---\n([\s\S]*)$/`).
- Lane ids: `'design' | 'product' | 'brand' | 'social'`. New mode ids added to `AgentModeId`.
- **Content delivery (marketplace):** packs are NOT compiled into `src/`. Runtime-canonical content lives at `<userData>/plugins/<id>/` (`app.getPath('userData')`, as used in `src/main/index.ts:444`). A small **seed** copy ships as a build resource for offline first-run only. `PackSyncManager` keeps the userData copy fresh from the og GitHub repos (`lama-assaf/atelier`, `lama-assaf/salon`).
- **Sync = seed-then-update:** on first run, if `<userData>/plugins/<id>` is empty, copy the seed in. Then, on **startup (background)** and on a **manual button**, fetch the latest commit sha and, if changed, download+extract the repo tarball. Sync failures are non-fatal (last good copy keeps working offline).
- Tarball extraction uses the `tar` npm package — add it to `dependencies` if absent (`npm i tar`).
- `getPluginsRoot()` returns `<userData>/plugins`. In unit tests, `PACK_ROOT_OVERRIDE` env var points it at a fixture dir.

---

## File Structure

**Create:**
- `src/marketplace/types.ts` — shared types (`LaneId`, `PackSource`, `LoadedPack`, `PackAgent`, `RuleFile`, `MemoryTemplate`, `Skill`).
- `src/marketplace/paths.ts` — `getPluginsRoot()` (`<userData>/plugins`) + `getSeedRoot()` (bundled seed).
- `src/marketplace/registry.ts` — `PACK_SOURCES` (the two repos) + lane maps (the "hardcoded" wiring).
- `src/marketplace/sync.ts` — `PackSyncManager`: seed on first run, check + download + extract updates from GitHub.
- `src/marketplace/loader.ts` — `readPack()`, `loadAllPacks()`, frontmatter parse.
- `src/marketplace/seed/atelier/`, `src/marketplace/seed/salon/` — small offline fallback copy (build resource).
- `src/memory/atelier-bridge.ts` — file tree → SQLite mirror.
- `src/tools/atelier-memory-tools.ts` — `memory-init` tool.
- `src/agent/lane-context.ts` — keyword→rule/skill injector (hook 1) + rule composition.
- `src/agent/write-guards.ts` — anti-AI-tone/banned-words scan (hook 2).
- Tests: one `tests/unit/<name>.test.ts` per unit above.

**Modify:**
- `src/agent/agent-modes.ts` — 4 lane modes + display order.
- `src/config/system-guidelines.ts:112` — per-lane rule injection.
- `src/agent/chat-tools.ts` — skill tool + write guards in `getChatAgentTools`.
- `src/agent/chat-engine.ts` — skills in system prompt, lane context injection, post-write sync.
- `src/tools/subagent.ts` — named specialist agents.
- `src/config/commands-loader.ts` — load + namespace pack commands.
- `src/main/index.ts` — call `PackSyncManager.ensureInstalled()` + background `checkAndUpdate()` on startup.
- `src/main/ipc/settings-ipc.ts:306` — expose mode `order`/`lane`; add `marketplace:checkUpdates` IPC handler.
- `package.json` — add `tar` dep; ship `src/marketplace/seed/*` as electron-builder resources.

---

## Task 1: Types + seed content + path resolution

**Files:**
- Create: `src/marketplace/types.ts`, `src/marketplace/paths.ts`
- Create (seed): `src/marketplace/seed/atelier/**`, `src/marketplace/seed/salon/**`
- Test: `tests/unit/marketplace-paths.test.ts`

**Interfaces:**
- Produces: `LaneId`, `PackSource`, `PackAgent`, `RuleFile`, `MemoryTemplate`, `Skill`, `LoadedPack`, `getPluginsRoot(): string`, `getSeedRoot(): string`.

- [ ] **Step 1: Fetch the seed content**

```bash
cd /tmp && rm -rf atelier salon
git clone --depth 1 https://github.com/lama-assaf/atelier.git
git clone --depth 1 https://github.com/lama-assaf/salon.git
cd /Users/zilliqa/Desktop/workhere/pocket-agent
mkdir -p src/marketplace/seed/atelier src/marketplace/seed/salon
for d in agents skills commands rules memory; do
  cp -R /tmp/atelier/$d src/marketplace/seed/atelier/$d
  cp -R /tmp/salon/$d   src/marketplace/seed/salon/$d
done
cp /tmp/atelier/VERSION /tmp/atelier/.claude-plugin/plugin.json src/marketplace/seed/atelier/
cp /tmp/salon/VERSION   /tmp/salon/.claude-plugin/plugin.json   src/marketplace/seed/salon/
# Seed is the OFFLINE FALLBACK only — the canonical copy is synced to <userData>/plugins at runtime.
# Do NOT copy .git, docs, tests, adapters, scripts, hooks.
```

- [ ] **Step 2: Write the types**

```ts
// src/marketplace/types.ts
export type LaneId = 'design' | 'product' | 'brand' | 'social';

export interface PackSource {
  id: string;          // 'atelier' | 'salon'
  name: string;
  lanes: LaneId[];
  repo: string;        // 'lama-assaf/atelier'
  branch: string;      // 'main'
}

export interface PackAgent {
  name: string;
  description: string;
  tools: string[];     // declared Claude-Code tool names (best-effort mapped later)
  model?: string;
  prompt: string;      // markdown body
  source: string;      // absolute file path
}

export interface RuleFile {
  lane: string;        // subdir under rules/ (design|product|brand|copy|common|social)
  filename: string;
  content: string;
  hash: string;        // sha256 of content, for de-dupe
}

export interface MemoryTemplate {
  relativePath: string; // e.g. 'instincts.md', 'campaigns/README.md'
  content: string;
}

// ggcoder Skill shape (mirror of @kenkaiiii/ggcoder core/skills)
export interface Skill {
  name: string;
  description: string;
  content: string;
  source: string;
}

export interface LoadedPack {
  id: string;
  agents: PackAgent[];
  skills: Skill[];
  commands: { name: string; description: string; filename: string; content: string }[];
  rules: RuleFile[];
  memoryTemplates: MemoryTemplate[];
}
```

- [ ] **Step 3: Write path resolution**

```ts
// src/marketplace/paths.ts
import path from 'path';

/**
 * Runtime-canonical plugins dir: <userData>/plugins. Synced from og repos.
 * In unit tests, PACK_ROOT_OVERRIDE points at a fixture dir (avoids importing electron).
 */
export function getPluginsRoot(): string {
  if (process.env.PACK_ROOT_OVERRIDE) return process.env.PACK_ROOT_OVERRIDE;
  try {
    // Lazy require so tests don't need electron. Matches src/main/index.ts:444.
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'plugins');
  } catch { /* not running under electron (unit tests) */ }
  return getSeedRoot(); // non-electron fallback → read seed content directly
}

/**
 * Bundled seed (offline fallback). Packaged: <resources>/seed-plugins; dev: src/marketplace/seed.
 */
export function getSeedRoot(): string {
  const fs = require('fs');
  const packaged = path.join(process.resourcesPath || '', 'seed-plugins');
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'seed');
}
```

- [ ] **Step 4: Write the failing test**

```ts
// tests/unit/marketplace-paths.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getSeedRoot, getPluginsRoot } from '../../src/marketplace/paths';

describe('marketplace paths', () => {
  it('seed root contains atelier and salon plugin.json', () => {
    const seed = getSeedRoot();
    expect(fs.existsSync(path.join(seed, 'atelier', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(seed, 'salon', 'plugin.json'))).toBe(true);
  });
  it('getPluginsRoot honors PACK_ROOT_OVERRIDE without importing electron', () => {
    process.env.PACK_ROOT_OVERRIDE = '/tmp/fixture-plugins';
    expect(getPluginsRoot()).toBe('/tmp/fixture-plugins');
    delete process.env.PACK_ROOT_OVERRIDE;
  });
});
```

- [ ] **Step 5: Run test — expect PASS.** Run: `npx vitest run tests/unit/marketplace-paths.test.ts`

- [ ] **Step 6: Ship the seed as a build resource**

In `package.json` electron-builder `build.extraResources`, add:
```json
{ "from": "src/marketplace/seed", "to": "seed-plugins", "filter": ["**/*.md", "**/*.json"] }
```
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/marketplace/types.ts src/marketplace/paths.ts src/marketplace/seed tests/unit/marketplace-paths.test.ts package.json
git commit -m "feat(marketplace): types, userData/seed path resolution, seed content"
```

---

## Task 1B: Pack sync manager (seed + update from og repos)

**Files:**
- Create: `src/marketplace/sync.ts`
- Modify: `package.json` (add `tar` dep)
- Modify: `src/main/index.ts` (startup: ensureInstalled + background checkAndUpdate)
- Modify: `src/main/ipc/settings-ipc.ts` (manual `marketplace:checkUpdates`)
- Test: `tests/unit/marketplace-sync.test.ts`

**Interfaces:**
- Consumes: `PACK_SOURCES` (Task 3 — for tests, pass sources in), `getPluginsRoot`, `getSeedRoot`.
- Produces: `class PackSyncManager { ensureInstalled(): Promise<void>; checkAndUpdate(): Promise<{id;updated;sha}[]> }`, and `installSeed(seedRoot, pluginsRoot, id)`, `latestSha(repo,branch)`, `extractTarball(buf, destDir)` helpers.

- [ ] **Step 1: Add the tar dependency**

Run: `npm i tar` → Expected: added to `dependencies`.

- [ ] **Step 2: Write the failing test** (seed-copy + idempotent sha behavior; network calls stubbed)

```ts
// tests/unit/marketplace-sync.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installSeed } from '../../src/marketplace/sync';

describe('installSeed', () => {
  let seed: string; let plugins: string;
  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    seed = path.join(base, 'seed'); plugins = path.join(base, 'plugins');
    fs.mkdirSync(path.join(seed, 'atelier'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'atelier', 'plugin.json'), '{"name":"atelier"}');
    fs.writeFileSync(path.join(seed, 'atelier', 'VERSION'), '0.1.0');
  });
  it('copies the seed into an empty plugins dir', () => {
    const copied = installSeed(seed, plugins, 'atelier');
    expect(copied).toBe(true);
    expect(fs.existsSync(path.join(plugins, 'atelier', 'plugin.json'))).toBe(true);
  });
  it('does not overwrite an already-installed pack', () => {
    fs.mkdirSync(path.join(plugins, 'atelier'), { recursive: true });
    fs.writeFileSync(path.join(plugins, 'atelier', 'VERSION'), '9.9.9');
    installSeed(seed, plugins, 'atelier');
    expect(fs.readFileSync(path.join(plugins, 'atelier', 'VERSION'), 'utf-8')).toBe('9.9.9');
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** Run: `npx vitest run tests/unit/marketplace-sync.test.ts`

- [ ] **Step 4: Implement the sync manager**

```ts
// src/marketplace/sync.ts
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as tar from 'tar';
import type { PackSource } from './types';
import { getPluginsRoot, getSeedRoot } from './paths';

/** Copy the bundled seed into pluginsRoot/<id> if that pack is not yet installed. Returns true if copied. */
export function installSeed(seedRoot: string, pluginsRoot: string, id: string): boolean {
  const dest = path.join(pluginsRoot, id);
  if (fs.existsSync(path.join(dest, 'plugin.json'))) return false; // already installed
  const src = path.join(seedRoot, id);
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

/** Latest commit sha for repo/branch via GitHub API (unauthenticated; 60 req/hr is plenty). */
export async function latestSha(repo: string, branch: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'pocket-agent' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch { return null; }
}

/** Download+extract the repo tarball into destDir (strips the top-level <repo>-<sha>/ folder). */
export async function updatePack(source: PackSource, destDir: string): Promise<void> {
  const url = `https://codeload.github.com/${source.repo}/tar.gz/refs/heads/${source.branch}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'pocket-agent' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok || !res.body) throw new Error(`tarball fetch failed: ${res.status}`);
  const tmp = `${destDir}.incoming`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // Only extract the content dirs we use.
  await pipeline(
    Readable.fromWeb(res.body as any),
    tar.x({ cwd: tmp, strip: 1, filter: (p) => /\/(agents|skills|commands|rules|memory)\/|\/(VERSION|\.claude-plugin\/plugin\.json)$/.test(`/${p}`) })
  );
  // flatten .claude-plugin/plugin.json → plugin.json
  const nested = path.join(tmp, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(nested)) fs.copyFileSync(nested, path.join(tmp, 'plugin.json'));
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.renameSync(tmp, destDir);
}

export class PackSyncManager {
  constructor(private sources: PackSource[]) {}

  async ensureInstalled(): Promise<void> {
    const seed = getSeedRoot(); const root = getPluginsRoot();
    fs.mkdirSync(root, { recursive: true });
    for (const s of this.sources) installSeed(seed, root, s.id);
  }

  async checkAndUpdate(): Promise<{ id: string; updated: boolean; sha: string }[]> {
    const root = getPluginsRoot();
    const out: { id: string; updated: boolean; sha: string }[] = [];
    for (const s of this.sources) {
      const dest = path.join(root, s.id);
      const shaFile = path.join(dest, '.sha');
      const remote = await latestSha(s.repo, s.branch);
      if (!remote) { out.push({ id: s.id, updated: false, sha: '' }); continue; }
      const local = fs.existsSync(shaFile) ? fs.readFileSync(shaFile, 'utf-8').trim() : '';
      if (remote === local) { out.push({ id: s.id, updated: false, sha: remote }); continue; }
      try {
        await updatePack(s, dest);
        fs.writeFileSync(shaFile, remote);
        out.push({ id: s.id, updated: true, sha: remote });
      } catch { out.push({ id: s.id, updated: false, sha: local }); } // keep last good copy
    }
    return out;
  }
}
```

- [ ] **Step 5: Run test — expect PASS.** Run: `npx vitest run tests/unit/marketplace-sync.test.ts`

- [ ] **Step 6: Wire startup + manual IPC**

In `src/main/index.ts`, after the app is ready and userData is known, add (non-blocking):
```ts
import { PackSyncManager } from '../marketplace/sync';
import { PACK_SOURCES } from '../marketplace/registry';
// ...
const sync = new PackSyncManager(PACK_SOURCES);
await sync.ensureInstalled();               // offline-safe: seeds if empty
void sync.checkAndUpdate().catch((e) => console.error('[marketplace] update failed', e)); // background
```
In `src/main/ipc/settings-ipc.ts`, add:
```ts
ipcMain.handle('marketplace:checkUpdates', async () => {
  const { PackSyncManager } = await import('../../marketplace/sync');
  const { PACK_SOURCES } = await import('../../marketplace/registry');
  return new PackSyncManager(PACK_SOURCES).checkAndUpdate();
});
```
(Expose a "Check for updates" button in the settings UI that calls this handler — UI wiring mirrors existing settings buttons.)

- [ ] **Step 7: typecheck + lint. Commit**

```bash
npm run typecheck && npm run lint
git add src/marketplace/sync.ts src/main/index.ts src/main/ipc/settings-ipc.ts package.json package-lock.json tests/unit/marketplace-sync.test.ts
git commit -m "feat(marketplace): sync manager — seed on first run, update from og repos"
```

---

## Task 2: Pack loader

**Files:**
- Create: `src/marketplace/loader.ts`
- Test: `tests/unit/marketplace-loader.test.ts`

**Interfaces:**
- Consumes: types from Task 1, `getPluginsRoot()`.
- Produces: `readPack(source: PackSource): LoadedPack`, `loadAllPacks(sources: PackSource[]): LoadedPack[]`, `parseFrontmatter(raw): {name,description,meta,body}`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/marketplace-loader.test.ts
import { describe, it, expect } from 'vitest';
import { PACK_SOURCES } from '../../src/marketplace/registry';
import { readPack } from '../../src/marketplace/loader';

describe('readPack', () => {
  it('loads atelier agents, skills, commands, rules', () => {
    const atelier = PACK_SOURCES.find((p) => p.id === 'atelier')!;
    const loaded = readPack(atelier);
    expect(loaded.agents.length).toBeGreaterThanOrEqual(14);
    expect(loaded.skills.length).toBeGreaterThanOrEqual(30);
    expect(loaded.commands.length).toBeGreaterThanOrEqual(30);
    expect(loaded.rules.length).toBeGreaterThanOrEqual(20);
    const dr = loaded.agents.find((a) => a.name === 'design-reviewer');
    expect(dr?.tools).toContain('Read');
    const rule = loaded.rules[0];
    expect(rule.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('skips malformed files without throwing', () => {
    const atelier = PACK_SOURCES.find((p) => p.id === 'atelier')!;
    expect(() => readPack(atelier)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`readPack`/`PACK_SOURCES` not defined). Run: `npx vitest run tests/unit/marketplace-loader.test.ts`

- [ ] **Step 3: Implement the loader**

```ts
// src/marketplace/loader.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PackSource, LoadedPack, PackAgent, RuleFile, MemoryTemplate, Skill } from './types';
import { getPluginsRoot } from './paths';

const FM_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function parseFrontmatter(raw: string): {
  name?: string; description?: string; meta: Record<string, string>; body: string;
} {
  const m = raw.match(FM_RE);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  }
  return { name: meta.name, description: meta.description, meta, body: m[2].trim() };
}

function readMd(file: string): string {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; }
}

function listFiles(dir: string, ext = '.md'): string[] {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f)); }
  catch { return []; }
}

function parseToolsField(v?: string): string[] {
  if (!v) return [];
  // frontmatter tools look like: ["Read", "Grep", "Glob"]
  const inner = v.replace(/^\[|\]$/g, '');
  return inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function loadAgents(dir: string): PackAgent[] {
  return listFiles(dir).map((file) => {
    const { name, description, meta, body } = parseFrontmatter(readMd(file));
    return {
      name: name || path.basename(file, '.md'),
      description: description || '',
      tools: parseToolsField(meta.tools),
      model: meta.model,
      prompt: body,
      source: file,
    };
  }).filter((a) => a.prompt.length > 0);
}

function loadSkills(dir: string): Skill[] {
  const out: Skill[] = [];
  let sub: string[] = [];
  try { sub = fs.readdirSync(dir); } catch { return out; }
  for (const name of sub) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { name: fmName, description, body } = parseFrontmatter(readMd(file));
    out.push({ name: fmName || name, description: description || '', content: body, source: file });
  }
  return out;
}

function loadCommands(dir: string): LoadedPack['commands'] {
  return listFiles(dir).map((file) => {
    const { name, description, body } = parseFrontmatter(readMd(file));
    return { name: name || path.basename(file, '.md'), description: description || '', filename: path.basename(file), content: body };
  });
}

function loadRules(dir: string): RuleFile[] {
  const out: RuleFile[] = [];
  let lanes: string[] = [];
  try { lanes = fs.readdirSync(dir); } catch { return out; }
  for (const lane of lanes) {
    const laneDir = path.join(dir, lane);
    if (!fs.statSync(laneDir).isDirectory()) continue;
    for (const file of listFiles(laneDir)) {
      const content = readMd(file);
      if (!content) continue;
      out.push({ lane, filename: path.basename(file), content, hash: crypto.createHash('sha256').update(content).digest('hex') });
    }
  }
  return out;
}

function loadMemoryTemplates(dir: string): MemoryTemplate[] {
  const out: MemoryTemplate[] = [];
  const walk = (d: string, base: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const rel = path.join(base, e.name);
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith('.md')) out.push({ relativePath: rel, content: readMd(abs) });
    }
  };
  walk(dir, '');
  return out;
}

export function readPack(source: PackSource): LoadedPack {
  const dir = path.join(getPluginsRoot(), source.id); // <userData>/plugins/<id> (or seed in tests)
  return {
    id: source.id,
    agents: loadAgents(path.join(dir, 'agents')),
    skills: loadSkills(path.join(dir, 'skills')),
    commands: loadCommands(path.join(dir, 'commands')),
    rules: loadRules(path.join(dir, 'rules')),
    memoryTemplates: loadMemoryTemplates(path.join(dir, 'memory')),
  };
}

export function loadAllPacks(sources: PackSource[]): LoadedPack[] {
  return sources.map(readPack);
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `npx vitest run tests/unit/marketplace-loader.test.ts` (requires Task 3's `registry.ts`; if running standalone, create `registry.ts` first per Task 3 Step 3).

- [ ] **Step 5: Commit**

```bash
git add src/marketplace/loader.ts tests/unit/marketplace-loader.test.ts
git commit -m "feat(packs): pure markdown loader for agents/skills/commands/rules/memory"
```

---

## Task 3: Registry + lane maps

**Files:**
- Create: `src/marketplace/registry.ts`
- Test: `tests/unit/marketplace-registry.test.ts`

**Interfaces:**
- Consumes: `readPack`, `getPluginsRoot`.
- Produces: `PACK_SOURCES: PackSource[]`, `skillsForLane(lane): Skill[]`, `agentsForLane(lane): PackAgent[]`, `rulesForLane(lane): RuleFile[]`, `commandsForPacks(): {ns, name, description, content}[]`, `allBannedAndToneRules(): RuleFile[]`.

- [ ] **Step 1: Note on lane maps**

Lane maps are **our** metadata, not pack content — the og repos don't ship them and a sync would clobber a JSON dropped in the pack dir. So they live **inline in `registry.ts`** (`LANE_MAPS` below), keyed by pack id, with a `defaultLane` fallback. Verify each skill/agent name against the seed dirs (`src/marketplace/seed/*`); design = how it looks, product = what/why, brand = how it sounds. No name may be absent without intentionally relying on `defaultLane`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/marketplace-registry.test.ts
import { describe, it, expect } from 'vitest';
import { PACK_SOURCES, skillsForLane, agentsForLane, rulesForLane, commandsForPacks } from '../../src/marketplace/registry';

describe('registry lane maps', () => {
  it('has two pack sources', () => {
    expect(PACK_SOURCES.map((p) => p.id).sort()).toEqual(['atelier', 'salon']);
  });
  it('splits atelier skills across lanes and puts salon in social', () => {
    expect(skillsForLane('design').some((s) => s.name === 'design-review')).toBe(true);
    expect(skillsForLane('product').some((s) => s.name === 'prd-writing')).toBe(true);
    expect(skillsForLane('social').length).toBeGreaterThanOrEqual(15);
  });
  it('assigns agents to lanes', () => {
    expect(agentsForLane('design').some((a) => a.name === 'design-reviewer')).toBe(true);
    expect(agentsForLane('social').length).toBeGreaterThanOrEqual(3);
  });
  it('social lane includes brand+copy rules', () => {
    const lanes = new Set(rulesForLane('social').map((r) => r.lane));
    expect(lanes.has('social')).toBe(true);
  });
  it('namespaces commands and de-dupes nothing across packs', () => {
    const cmds = commandsForPacks();
    expect(cmds.some((c) => c.ns === 'atelier:design-review')).toBe(true);
    expect(cmds.some((c) => c.ns === 'salon:campaign')).toBe(true);
  });
});
```

- [ ] **Step 3: Implement the registry**

```ts
// src/marketplace/registry.ts
import type { LaneId, PackSource, LoadedPack, Skill, PackAgent, RuleFile } from './types';
import { readPack } from './loader';

export const PACK_SOURCES: PackSource[] = [
  { id: 'atelier', name: 'Atelier', lanes: ['design', 'product', 'brand'], repo: 'lama-assaf/atelier', branch: 'main' },
  { id: 'salon',   name: 'Salon',   lanes: ['social'],                     repo: 'lama-assaf/salon',   branch: 'main' },
];

interface LaneMap { defaultLane: LaneId; skills: Record<string, LaneId>; agents: Record<string, LaneId>; }

// Our metadata about the packs (NOT pack content). Verify names against seed dirs.
const LANE_MAPS: Record<string, LaneMap> = {
  salon: { defaultLane: 'social', skills: {}, agents: {} },
  atelier: {
    defaultLane: 'product',
    skills: {
      'design-review': 'design', 'design-system-audit': 'design', 'accessibility-audit': 'design',
      'dark-mode-pairing': 'design', 'component-spec': 'design', 'data-viz-design': 'design',
      'iconography-system': 'design', 'motion-direction': 'design', 'figma-handoff-spec': 'design',
      'prd-writing': 'product', 'spec-writing': 'product', 'jtbd-framing': 'product',
      'roadmap-planning': 'product', 'feature-scoping': 'product', 'metric-design': 'product',
      'ab-test-design': 'product', 'competitive-analysis': 'product', 'launch-planning': 'product',
      'research-synthesis': 'product',
      'brand-voice-extraction': 'brand', 'naming-generation': 'brand', 'tagline-writing': 'brand',
      'positioning-statement': 'brand', 'messaging-architecture': 'brand', 'value-prop-writing': 'brand',
      'microcopy-writing': 'brand', 'landing-copy': 'brand', 'case-study-writing': 'brand',
      'release-narrative': 'brand', 'brand-identity-audit': 'brand', 'content-calendar': 'brand',
      'email-sequence': 'brand',
    },
    agents: {
      'design-reviewer': 'design', 'accessibility-reviewer': 'design', 'design-system-auditor': 'design',
      'product-strategist': 'product', 'competitor-analyst': 'product', 'ux-research-synthesizer': 'product',
      'taxonomy-architect': 'product', 'narrative-architect': 'product',
      'brand-voice-keeper': 'brand', 'copywriter': 'brand', 'microcopy-writer': 'brand',
      'naming-generator': 'brand', 'case-study-writer': 'brand', 'pitch-deck-writer': 'brand',
      'release-narrator': 'brand',
    },
  },
};

function laneMapFor(id: string): LaneMap {
  return LANE_MAPS[id] ?? { defaultLane: (PACK_SOURCES.find((p) => p.id === id)?.lanes[0] ?? 'product'), skills: {}, agents: {} };
}

// Which rules subdirs feed each lane (common always included).
const LANE_RULE_DIRS: Record<LaneId, string[]> = {
  design: ['design', 'common'],
  product: ['product', 'common'],
  brand: ['brand', 'copy', 'common'],
  social: ['social', 'brand', 'copy', 'common'],
};

const loaded: Map<string, LoadedPack> = new Map();
function ensureLoaded() {
  if (loaded.size) return;
  for (const p of PACK_SOURCES) loaded.set(p.id, readPack(p));
}

export function skillsForLane(lane: LaneId): Skill[] {
  ensureLoaded();
  const out: Skill[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!; const lm = laneMapFor(p.id);
    for (const s of lp.skills) if ((lm.skills[s.name] ?? lm.defaultLane) === lane) out.push(s);
  }
  return out;
}

export function agentsForLane(lane: LaneId): PackAgent[] {
  ensureLoaded();
  const out: PackAgent[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!; const lm = laneMapFor(p.id);
    for (const a of lp.agents) if ((lm.agents[a.name] ?? lm.defaultLane) === lane) out.push(a);
  }
  return out;
}

export function rulesForLane(lane: LaneId): RuleFile[] {
  ensureLoaded();
  const wanted = new Set(LANE_RULE_DIRS[lane]);
  const seen = new Set<string>();
  const out: RuleFile[] = [];
  for (const p of PACK_SOURCES) for (const r of loaded.get(p.id)!.rules) {
    if (!wanted.has(r.lane)) continue;
    if (seen.has(r.hash)) continue;        // de-dupe identical brand/copy rules
    seen.add(r.hash); out.push(r);
  }
  return out;
}

export function commandsForPacks(): { ns: string; name: string; description: string; content: string }[] {
  ensureLoaded();
  const out: { ns: string; name: string; description: string; content: string }[] = [];
  for (const p of PACK_SOURCES) for (const c of loaded.get(p.id)!.commands)
    out.push({ ns: `${p.id}:${c.name}`, name: c.name, description: c.description, content: c.content });
  return out;
}

export function allBannedAndToneRules(): RuleFile[] {
  ensureLoaded();
  const seen = new Set<string>(); const out: RuleFile[] = [];
  for (const p of PACK_SOURCES) for (const r of loaded.get(p.id)!.rules)
    if (/banned-words|anti-ai-tone/.test(r.filename) && !seen.has(r.hash)) { seen.add(r.hash); out.push(r); }
  return out;
}
```
> `loaded` is a module-level cache filled once from the seed/userData dir. After a sync updates `<userData>/plugins`, it refreshes on next app start (acceptable for v1; a `reload()` export can bust it later if hot-reload is wanted).

- [ ] **Step 4: Run both test files — expect PASS.**

Run: `npx vitest run tests/unit/marketplace-registry.test.ts tests/unit/marketplace-loader.test.ts`
Expected: PASS (both read seed content via the non-electron fallback in `getPluginsRoot`).

- [ ] **Step 5: `npm run typecheck && npm run lint` — expect clean. Commit**

```bash
git add src/marketplace/registry.ts tests/unit/marketplace-registry.test.ts
git commit -m "feat(marketplace): registry + inline lane maps for skills/agents/rules/commands"
```

---

## Task 4: Lane modes + display order

**Files:**
- Modify: `src/agent/agent-modes.ts`
- Modify: `src/main/ipc/settings-ipc.ts:306`
- Test: `tests/unit/lane-modes.test.ts`

**Interfaces:**
- Consumes: `LaneId`.
- Produces: `AgentModeId` extended with `'design'|'product'|'brand'|'social'`; `getAllModes()` returns modes in display order ending with `coder`; each lane mode has `lane: LaneId`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lane-modes.test.ts
import { describe, it, expect } from 'vitest';
import { AGENT_MODES, getAllModes, isValidModeId } from '../../src/agent/agent-modes';

describe('lane modes', () => {
  it('registers four lane modes', () => {
    for (const id of ['design', 'product', 'brand', 'social']) {
      expect(isValidModeId(id)).toBe(true);
      expect(AGENT_MODES[id as keyof typeof AGENT_MODES].engine).toBe('chat');
    }
  });
  it('tags each lane mode with its lane', () => {
    expect((AGENT_MODES.design as any).lane).toBe('design');
    expect((AGENT_MODES.social as any).lane).toBe('social');
  });
  it('orders coder last', () => {
    const ids = getAllModes().map((m) => m.id);
    expect(ids[ids.length - 1]).toBe('coder');
    expect(ids.indexOf('design')).toBeLessThan(ids.indexOf('coder'));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/lane-modes.test.ts`

- [ ] **Step 3: Extend `AgentModeId`, add `lane`, add four modes**

In `src/agent/agent-modes.ts`:
- Line 10 → `export type AgentModeId = 'general' | 'design' | 'product' | 'brand' | 'social' | 'coder' | 'researcher' | 'writer' | 'therapist';`
- Add to `AgentMode` interface: `lane?: import('../marketplace/types').LaneId;`
- Add a shared preamble constant and four mode entries. Example (design; replicate for product/brand/social with lane-specific one-liners):

```ts
const OPERATOR_PREAMBLE = `You are an operator, not a chat bot. Every request is one of four moves — review, build, decide, synthesize. Name the move, then use the matching skill or specialist. Produce structured artifacts, not vibes. The rules loaded for this lane hold across every output.`;

const DESIGN_PROMPT = `${OPERATOR_PREAMBLE}

## Design lane
How it looks and feels. Critique against hierarchy, spacing, type, color, alignment, density, affordance. Delegate deep critiques to the design-reviewer / accessibility-reviewer specialists. Do not redesign on a critique request; critique within the design's own intent.`;
```

Add entry:
```ts
  design: {
    id: 'design', name: 'Design', icon: '🎨', engine: 'chat', lane: 'design',
    systemPrompt: DESIGN_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent'],
    description: 'Design lane — critique, systems, accessibility',
    handoffDescription: 'Design critique, design systems, accessibility, visual work',
    canHandoffTo: ['product', 'brand', 'general'],
    technicalMode: false,
  },
```
(Repeat for `product` 📐, `brand` ✨, `social` 📣 with appropriate `canHandoffTo` and one-line lane bodies. `social`'s `canHandoffTo`: `['brand', 'general']`.)

- [ ] **Step 4: Enforce display order**

Replace `ALL_MODE_IDS` derivation with an explicit ordered array:
```ts
export const ALL_MODE_IDS: AgentModeId[] = [
  'general', 'design', 'product', 'brand', 'social', 'researcher', 'writer', 'therapist', 'coder',
];
```
(`getAllModes()` already maps over `ALL_MODE_IDS`, so it now yields Coder last.)

- [ ] **Step 5: Expose `order`/`lane` to UI**

In `src/main/ipc/settings-ipc.ts:306`, add `lane: m.lane` to the mapped object so the renderer can group lane modes.

- [ ] **Step 6: Run test + typecheck + lint — expect PASS/clean. Commit**

```bash
npx vitest run tests/unit/lane-modes.test.ts && npm run typecheck && npm run lint
git add src/agent/agent-modes.ts src/main/ipc/settings-ipc.ts tests/unit/lane-modes.test.ts
git commit -m "feat(modes): add design/product/brand/social lane modes, coder last"
```

---

## Task 5: Per-lane rule injection

**Files:**
- Modify: `src/config/system-guidelines.ts:112`
- Create: `src/agent/lane-context.ts` (rule composition half)
- Test: `tests/unit/lane-rules.test.ts`

**Interfaces:**
- Consumes: `rulesForLane`, `AGENT_MODES`.
- Produces: `composeLaneRules(lane: LaneId): string`; `buildSystemGuidelines(mode)` appends lane rules when the mode has a `lane`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lane-rules.test.ts
import { describe, it, expect } from 'vitest';
import { composeLaneRules } from '../../src/agent/lane-context';

describe('composeLaneRules', () => {
  it('includes design + common rules for the design lane', () => {
    const text = composeLaneRules('design');
    expect(text.length).toBeGreaterThan(100);
    expect(text.toLowerCase()).toContain('spacing');
  });
  it('does not duplicate identical brand/copy rules for social', () => {
    const text = composeLaneRules('social');
    const banned = (text.match(/banned-words/g) || []).length;
    expect(banned).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/lane-rules.test.ts`

- [ ] **Step 3: Implement `composeLaneRules`**

```ts
// src/agent/lane-context.ts
import type { LaneId } from '../marketplace/types';
import { rulesForLane } from '../marketplace/registry';

export function composeLaneRules(lane: LaneId): string {
  const rules = rulesForLane(lane);
  if (!rules.length) return '';
  const body = rules
    .map((r) => `### ${r.lane}/${r.filename}\n${r.content}`)
    .join('\n\n');
  return `## Operator rules (${lane} lane)\nThese hold across every output in this lane.\n\n${body}`;
}
```

- [ ] **Step 4: Wire into `buildSystemGuidelines`**

In `src/config/system-guidelines.ts`, at the end of `buildSystemGuidelines(mode)` (line 112+), before returning:
```ts
import { AGENT_MODES } from '../agent/agent-modes';
import { composeLaneRules } from '../agent/lane-context';
// ...
const laneId = AGENT_MODES[mode as keyof typeof AGENT_MODES]?.lane;
if (laneId) {
  const laneRules = composeLaneRules(laneId);
  if (laneRules) sections.push(laneRules); // append to whatever accumulator this fn uses
}
```
(Adapt `sections.push` to the function's existing string-assembly variable.)

- [ ] **Step 5: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/lane-rules.test.ts && npm run typecheck && npm run lint
git add src/agent/lane-context.ts src/config/system-guidelines.ts tests/unit/lane-rules.test.ts
git commit -m "feat(rules): inject per-lane operator rules into system prompt"
```

---

## Task 6: Skills wiring (enable dormant pipeline)

**Files:**
- Modify: `src/agent/chat-tools.ts` (`getChatAgentTools`)
- Modify: `src/agent/chat-engine.ts` (`buildSystemPrompt` static section + pass lane)
- Test: `tests/unit/lane-skills.test.ts`

**Interfaces:**
- Consumes: `skillsForLane`, ggcoder `createSkillTool`, `formatSkillsForPrompt`.
- Produces: `getChatAgentTools(config, cwd, lane?)` adds a `skill` tool for the lane; `formatLaneSkills(lane): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lane-skills.test.ts
import { describe, it, expect } from 'vitest';
import { formatLaneSkills } from '../../src/agent/lane-context';

describe('formatLaneSkills', () => {
  it('lists design skills by name+description only (not full body)', () => {
    const text = formatLaneSkills('design');
    expect(text).toContain('design-review');
    expect(text.length).toBeLessThan(8000); // descriptions, not bodies
  });
  it('returns empty string for a lane with no skills gracefully', () => {
    // @ts-expect-error intentionally invalid lane
    expect(formatLaneSkills('nonexistent')).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/lane-skills.test.ts`

- [ ] **Step 3: Implement `formatLaneSkills`** (in `src/agent/lane-context.ts`)

```ts
import { formatSkillsForPrompt } from '@kenkaiiii/ggcoder';
import { skillsForLane } from '../marketplace/registry';

export function formatLaneSkills(lane: LaneId): string {
  const skills = skillsForLane(lane);
  if (!skills.length) return '';
  return formatSkillsForPrompt(skills);
}
```

- [ ] **Step 4: Add the skill tool to chat tools**

In `src/agent/chat-tools.ts`, extend the signature and add the tool:
```ts
import { createSkillTool } from '@kenkaiiii/ggcoder';
import { skillsForLane } from '../marketplace/registry';
import type { LaneId } from '../marketplace/types';

export function getChatAgentTools(config: ToolsConfig, cwd: string, lane?: LaneId): AgentTool[] {
  // ...existing body...
  if (lane) {
    const skills = skillsForLane(lane);
    if (skills.length) tools.push(createSkillTool(skills));
  }
  // sub-agent tool line stays last
  return tools;
}
```

- [ ] **Step 5: Pass lane + inject skill list in the engine**

In `src/agent/chat-engine.ts`:
- Where `getChatAgentTools(this.toolsConfig, this.workspace)` is called (~line 342), pass the active lane:
```ts
const laneId = (this.memory.getSessionMode(sessionId) &&
  AGENT_MODES[this.memory.getSessionMode(sessionId) as AgentModeId]?.lane);
// ...
: getChatAgentTools(this.toolsConfig, this.workspace, laneId ?? undefined);
```
- In `buildSystemPrompt` static section (after the mode prompt push, ~line 795):
```ts
import { formatLaneSkills } from './lane-context';
const laneForSkills = getModeConfig(sessionMode).lane;
if (laneForSkills) {
  const skillList = formatLaneSkills(laneForSkills);
  if (skillList) staticParts.push(`## Available skills (${laneForSkills})\nInvoke by name via the \`skill\` tool when a request matches.\n\n${skillList}`);
}
```

- [ ] **Step 6: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/lane-skills.test.ts && npm run typecheck && npm run lint
git add src/agent/chat-tools.ts src/agent/chat-engine.ts src/agent/lane-context.ts tests/unit/lane-skills.test.ts
git commit -m "feat(skills): enable ggcoder skill discovery per lane in chat modes"
```

---

## Task 7: Named specialist subagents

**Files:**
- Modify: `src/tools/subagent.ts`
- Test: `tests/unit/subagent-named.test.ts`

**Interfaces:**
- Consumes: `agentsForLane`, `PackAgent`.
- Produces: `createSubAgentTool(parentTools, getStreamConfig, lane?)` — tool params gain optional `agent`; when set, uses that specialist's prompt + tool subset.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/subagent-named.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSpecialist, mapAgentTools } from '../../src/tools/subagent';

describe('named specialist resolution', () => {
  it('resolves a design specialist prompt for the design lane', () => {
    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.prompt.toLowerCase()).toContain('critique');
  });
  it('returns null for an agent not in the lane', () => {
    expect(resolveSpecialist('design', 'community-manager')).toBeNull();
  });
  it('maps Claude Code tool names to pocket tool names, dropping unknowns', () => {
    const mapped = mapAgentTools(['Read', 'Grep', 'Bogus']);
    expect(mapped).toContain('read');
    expect(mapped).not.toContain('Bogus');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/subagent-named.test.ts`

- [ ] **Step 3: Add resolution helpers + `agent` param**

In `src/tools/subagent.ts`:
```ts
import { agentsForLane } from '../marketplace/registry';
import type { LaneId } from '../marketplace/types';

const CC_TO_POCKET_TOOL: Record<string, string> = {
  Read: 'read', Write: 'write', Edit: 'edit', Grep: 'shell_command', Glob: 'shell_command',
  Bash: 'shell_command', WebFetch: 'web_fetch', WebSearch: 'web_fetch',
};

export function resolveSpecialist(lane: LaneId, name: string) {
  return agentsForLane(lane).find((a) => a.name === name) ?? null;
}

export function mapAgentTools(tools: string[]): string[] {
  const out = new Set<string>();
  for (const t of tools) { const m = CC_TO_POCKET_TOOL[t]; if (m) out.add(m); }
  return [...out];
}
```
Extend `SubAgentParams`:
```ts
const SubAgentParams = z.object({
  task: z.string().describe('The task to delegate to the sub-agent'),
  agent: z.string().optional().describe('Optional named specialist for this lane'),
});
```
Add `lane?: LaneId` param to `createSubAgentTool(parentTools, getStreamConfig, lane?)`. In `execute`, when `args.agent && lane`:
```ts
const spec = resolveSpecialist(lane, args.agent);
const system = spec ? spec.prompt : SUB_AGENT_SYSTEM_PROMPT;
const allow = spec ? new Set(mapAgentTools(spec.tools).concat([...ALLOWED_SUB_AGENT_TOOLS])) : ALLOWED_SUB_AGENT_TOOLS;
const subTools = parentTools.filter((t) => allow.has(t.name));
```
Use `system` for `agentOptions.system`. When no `agent`, behavior is unchanged. Update the tool `description` to mention available specialists: append `agentsForLane(lane).map(a => a.name).join(', ')` when `lane` is set.

- [ ] **Step 4: Thread `lane` from `getChatAgentTools`**

In `chat-tools.ts` where `createSubAgentTool(tools, getStreamConfig)` is called, pass the `lane` param through: `createSubAgentTool(tools, getStreamConfig, lane)`.

- [ ] **Step 5: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/subagent-named.test.ts && npm run typecheck && npm run lint
git add src/tools/subagent.ts src/agent/chat-tools.ts tests/unit/subagent-named.test.ts
git commit -m "feat(subagent): dispatch to named lane specialists with mapped tool subsets"
```

---

## Task 8: Hook 1 — prompt keyword→context injector

**Files:**
- Modify: `src/agent/lane-context.ts`
- Modify: `src/agent/chat-engine.ts` (dynamic prompt section)
- Test: `tests/unit/lane-injection.test.ts`

**Interfaces:**
- Consumes: `skillsForLane`, `rulesForLane`.
- Produces: `buildLaneContextInjection(userMessage: string, lane: LaneId): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lane-injection.test.ts
import { describe, it, expect } from 'vitest';
import { buildLaneContextInjection } from '../../src/agent/lane-context';

describe('buildLaneContextInjection', () => {
  it('pulls full accessibility skill/rule body on an a11y keyword hit', () => {
    const text = buildLaneContextInjection('can you run an a11y check on this?', 'design');
    expect(text.toLowerCase()).toContain('accessibility');
    expect(text.length).toBeGreaterThan(200); // full body, not just a name
  });
  it('returns empty when no keyword matches', () => {
    expect(buildLaneContextInjection('hello there', 'design')).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/lane-injection.test.ts`

- [ ] **Step 3: Port the keyword map + injector**

```ts
// src/agent/lane-context.ts (add)
// Ported from atelier/salon scripts/hooks/prompt-context.js KEYWORDS.
const KEYWORDS: Record<string, string[]> = {
  'design review': ['skill:design-review', 'rule:spacing', 'rule:type'],
  'accessibility': ['skill:accessibility-audit', 'rule:accessibility'],
  'a11y': ['skill:accessibility-audit', 'rule:accessibility'],
  'wcag': ['skill:accessibility-audit', 'rule:accessibility'],
  'dark mode': ['skill:dark-mode-pairing'],
  'prd': ['skill:prd-writing', 'rule:prd-structure'],
  'jtbd': ['skill:jtbd-framing', 'rule:jtbd'],
  'metric': ['skill:metric-design', 'rule:metrics'],
  'brand voice': ['skill:brand-voice-extraction', 'rule:voice'],
  'tagline': ['skill:tagline-writing'],
  'positioning': ['skill:positioning-statement'],
  'campaign': ['skill:campaign-brief'],
  'thread': ['skill:x-thread'],
  'linkedin': ['skill:linkedin-post'],
  // extend from the two hook scripts as needed
};

export function buildLaneContextInjection(userMessage: string, lane: LaneId): string {
  const msg = userMessage.toLowerCase();
  const refs = new Set<string>();
  for (const [kw, targets] of Object.entries(KEYWORDS))
    if (msg.includes(kw)) targets.forEach((t) => refs.add(t));
  if (!refs.size) return '';

  const skills = skillsForLane(lane);
  const rules = rulesForLane(lane);
  const parts: string[] = [];
  for (const ref of refs) {
    const [kind, key] = ref.split(':');
    if (kind === 'skill') {
      const s = skills.find((x) => x.name === key);
      if (s) parts.push(`### skill: ${s.name}\n${s.content}`);
    } else if (kind === 'rule') {
      const r = rules.find((x) => x.filename.includes(key));
      if (r) parts.push(`### rule: ${r.filename}\n${r.content}`);
    }
  }
  if (!parts.length) return '';
  return `## Relevant to this request (auto-surfaced)\n\n${parts.join('\n\n')}`;
}
```

- [ ] **Step 4: Inject into the dynamic prompt**

In `chat-engine.ts` `buildSystemPrompt`, dynamic section (uncached), when a lane + `userMessage` exist:
```ts
const laneForInject = getModeConfig(sessionMode).lane;
if (laneForInject && userMessage) {
  const inj = buildLaneContextInjection(userMessage, laneForInject);
  if (inj) dynamicParts.push(inj);
}
```

- [ ] **Step 5: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/lane-injection.test.ts && npm run typecheck && npm run lint
git add src/agent/lane-context.ts src/agent/chat-engine.ts tests/unit/lane-injection.test.ts
git commit -m "feat(hooks): port prompt keyword→context injector as native lane injection"
```

---

## Task 9: Hook 2 — anti-AI-tone / banned-words write guard

**Files:**
- Create: `src/agent/write-guards.ts`
- Modify: `src/agent/chat-tools.ts` (`wrapWithWritePathSafety` → also run tone guard)
- Test: `tests/unit/write-guards.test.ts`

**Interfaces:**
- Consumes: `allBannedAndToneRules`, `SettingsManager`.
- Produces: `scanForBannedTone(text: string): { hits: string[]; warning: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/write-guards.test.ts
import { describe, it, expect } from 'vitest';
import { scanForBannedTone } from '../../src/agent/write-guards';

describe('scanForBannedTone', () => {
  it('flags a banned filler word', () => {
    const { hits, warning } = scanForBannedTone('Let us delve into this to unlock synergy.');
    expect(hits.length).toBeGreaterThan(0);
    expect(warning).toContain('tone');
  });
  it('passes clean copy', () => {
    const { hits, warning } = scanForBannedTone('We shipped the login fix today.');
    expect(hits).toEqual([]);
    expect(warning).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/write-guards.test.ts`

- [ ] **Step 3: Implement the scanner**

```ts
// src/agent/write-guards.ts
import { allBannedAndToneRules } from '../marketplace/registry';

let cachedWords: string[] | null = null;

/** Extract banned words/phrases from the vendored banned-words rule (bullet or code list). */
function bannedWords(): string[] {
  if (cachedWords) return cachedWords;
  const words = new Set<string>();
  for (const r of allBannedAndToneRules()) {
    if (!/banned-words/.test(r.filename)) continue;
    for (const line of r.content.split('\n')) {
      const m = line.match(/^[-*]\s+`?([a-zA-Z][a-zA-Z '-]+)`?/);
      if (m) words.add(m[1].trim().toLowerCase());
    }
  }
  cachedWords = [...words];
  return cachedWords;
}

export function scanForBannedTone(text: string): { hits: string[]; warning: string | null } {
  const lower = text.toLowerCase();
  const hits = bannedWords().filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  if (!hits.length) return { hits: [], warning: null };
  return { hits, warning: `⚠️ tone guard: draft contains banned/AI-tone terms: ${hits.join(', ')}. Revise per the brand voice rules before finalizing.` };
}
```

- [ ] **Step 4: Run guard inside the write wrapper**

In `src/agent/chat-tools.ts`, in `wrapWithWritePathSafety` (rename intent → keep name, extend body). After the path-safety check, before delegating, scan the content being written:
```ts
import { scanForBannedTone } from './write-guards';
import { SettingsManager } from '../settings';
// inside execute, after path check:
const content = (args as { content?: string })?.content;
if (typeof content === 'string' && SettingsManager.get('features.operatorPacks') !== 'false') {
  const { warning } = scanForBannedTone(content);
  if (warning) {
    const hardBlock = SettingsManager.get('features.toneHardBlock') === 'true';
    if (hardBlock) return `Write blocked by tone guard: ${warning}`;
    const result = await originalExecute(args as never, context);
    return `${warning}\n\n${result}`; // non-blocking: warn + still write
  }
}
```

- [ ] **Step 5: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/write-guards.test.ts && npm run typecheck && npm run lint
git add src/agent/write-guards.ts src/agent/chat-tools.ts tests/unit/write-guards.test.ts
git commit -m "feat(hooks): anti-AI-tone/banned-words guard on write path (non-blocking)"
```

---

## Task 10: Memory bridge (file tree → SQLite mirror)

**Files:**
- Create: `src/memory/atelier-bridge.ts`
- Test: `tests/unit/atelier-bridge.test.ts`

**Interfaces:**
- Consumes: `MemoryManager` (`saveFact`, `getFactsByCategory`, `deleteFact`).
- Produces: `class AtelierMemoryBridge { syncProject(dir); onMemoryFileWritten(abs, dir); seed(dir, templates) }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/atelier-bridge.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AtelierMemoryBridge } from '../../src/memory/atelier-bridge';

function fakeMemory() {
  const facts: any[] = [];
  let id = 1;
  return {
    _facts: facts,
    saveFact: (category: string, subject: string, content: string) => { facts.push({ id: id, category, subject, content }); return id++; },
    getFactsByCategory: (c: string) => facts.filter((f) => f.category === c),
    deleteFact: (i: number) => { const idx = facts.findIndex((f) => f.id === i); if (idx >= 0) facts.splice(idx, 1); return idx >= 0; },
  } as any;
}

describe('AtelierMemoryBridge', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-'));
    fs.mkdirSync(path.join(dir, '.atelier', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.atelier', 'memory', 'instincts.md'), '# instincts\n- ship small');
  });

  it('mirrors memory files into SQLite facts tagged by source', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const res = await bridge.syncProject(dir);
    expect(res.files).toBe(1);
    expect(mem.getFactsByCategory('atelier-memory').length).toBe(1);
  });

  it('is idempotent — re-sync does not duplicate', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    await bridge.syncProject(dir);
    await bridge.syncProject(dir);
    expect(mem.getFactsByCategory('atelier-memory').length).toBe(1);
  });

  it('seed creates only missing files', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const created = await bridge.seed(dir, [
      { relativePath: 'instincts.md', content: 'template' }, // exists → skip
      { relativePath: 'voice.md', content: 'voice template' }, // missing → create
    ]);
    expect(created).toEqual(['voice.md']);
    expect(fs.readFileSync(path.join(dir, '.atelier', 'memory', 'instincts.md'), 'utf-8')).toContain('ship small');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/atelier-bridge.test.ts`

- [ ] **Step 3: Implement the bridge**

```ts
// src/memory/atelier-bridge.ts
import fs from 'fs';
import path from 'path';
import type { MemoryManager } from './index';
import type { MemoryTemplate } from '../marketplace/types';

const CATEGORY = 'atelier-memory';

interface MemoryLike {
  saveFact(category: string, subject: string, content: string): number;
  getFactsByCategory(category: string): { id: number; subject: string }[];
  deleteFact(id: number): boolean;
}

export class AtelierMemoryBridge {
  constructor(private memory: MemoryLike | MemoryManager) {}

  private memDir(projectDir: string): string {
    return path.join(projectDir, '.atelier', 'memory');
  }

  private listMemoryFiles(projectDir: string): string[] {
    const root = this.memDir(projectDir);
    const out: string[] = [];
    const walk = (d: string) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.endsWith('.md')) out.push(abs);
      }
    };
    walk(root);
    return out;
  }

  async syncProject(projectDir: string): Promise<{ files: number; chunks: number }> {
    const mem = this.memory as MemoryLike;
    const prefix = `${projectDir}::`;
    // delete existing mirror rows for this project (idempotent re-sync)
    for (const f of mem.getFactsByCategory(CATEGORY))
      if (f.subject.startsWith(prefix)) mem.deleteFact(f.id);

    const files = this.listMemoryFiles(projectDir);
    for (const abs of files) {
      const rel = path.relative(this.memDir(projectDir), abs);
      const content = fs.readFileSync(abs, 'utf-8').trim();
      if (content) mem.saveFact(CATEGORY, `${prefix}${rel}`, content); // saveFact triggers async embedding
    }
    return { files: files.length, chunks: files.length };
  }

  async onMemoryFileWritten(absPath: string, projectDir: string): Promise<void> {
    if (!absPath.includes(path.join('.atelier', 'memory'))) return;
    await this.syncProject(projectDir);
  }

  async seed(projectDir: string, templates: MemoryTemplate[]): Promise<string[]> {
    const created: string[] = [];
    for (const t of templates) {
      const abs = path.join(this.memDir(projectDir), t.relativePath);
      if (fs.existsSync(abs)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, t.content, 'utf-8');
      created.push(t.relativePath);
    }
    return created;
  }
}
```

- [ ] **Step 4: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/atelier-bridge.test.ts && npm run typecheck && npm run lint
git add src/memory/atelier-bridge.ts tests/unit/atelier-bridge.test.ts
git commit -m "feat(memory): one-way .atelier/memory → SQLite mirror bridge"
```

---

## Task 11: memory-init tool + Hook 3 (post-write sync)

**Files:**
- Create: `src/tools/atelier-memory-tools.ts`
- Modify: `src/tools/index.ts` (register tool)
- Modify: `src/agent/chat-tools.ts` (post-write mirror on `.atelier/memory` writes)
- Test: `tests/unit/atelier-memory-tools.test.ts`

**Interfaces:**
- Consumes: `AtelierMemoryBridge`, `PACK_SOURCES`/`loadAllPacks`, `getCurrentSessionId`, `MemoryManager`.
- Produces: `getAtelierMemoryTools()` → `[{ name: 'memory_init', ... }]`; post-write hook calls `bridge.onMemoryFileWritten`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/atelier-memory-tools.test.ts
import { describe, it, expect } from 'vitest';
import { getAtelierMemoryTools } from '../../src/tools/atelier-memory-tools';

describe('memory_init tool', () => {
  it('exposes a memory_init tool with a handler', () => {
    const tools = getAtelierMemoryTools();
    const init = tools.find((t) => t.name === 'memory_init');
    expect(init).toBeDefined();
    expect(typeof init!.handler).toBe('function');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/atelier-memory-tools.test.ts`

- [ ] **Step 3: Implement the tool**

```ts
// src/tools/atelier-memory-tools.ts
import { AtelierMemoryBridge } from '../memory/atelier-bridge';
import { loadAllPacks } from '../marketplace/loader';
import { PACK_SOURCES } from '../marketplace/registry';
import { getMemoryManager } from './memory-tools'; // existing accessor; add if absent

export function getAtelierMemoryTools() {
  return [{
    name: 'memory_init',
    description: 'Seed this project\'s .atelier/memory/ tree with any missing operator-memory templates (instincts, lessons, glossary, voice, campaigns). Never overwrites existing files.',
    input_schema: { type: 'object', properties: {}, required: [] },
    handler: async (): Promise<string> => {
      const memory = getMemoryManager();
      if (!memory) return 'Memory not available.';
      const projectDir = memory.getSessionWorkingDirectory(/* current */ '') || process.cwd();
      const bridge = new AtelierMemoryBridge(memory);
      const templates = loadAllPacks(PACK_SOURCES).flatMap((p) => p.memoryTemplates);
      const created = await bridge.seed(projectDir, templates);
      await bridge.syncProject(projectDir);
      return created.length
        ? `Seeded ${created.length} memory file(s): ${created.join(', ')}`
        : 'All operator-memory files already present.';
    },
  }];
}
```
> If `getMemoryManager()`/session accessor names differ, use the existing accessors in `memory-tools.ts` (`setMemoryManager` is exported at `src/tools/index.ts:29`; add a matching getter) and `getCurrentSessionId()` from `session-context.ts`.

- [ ] **Step 4: Register the tool** in `src/tools/index.ts` `getCustomTools()` (mirror the existing `projectTools` block):
```ts
import { getAtelierMemoryTools } from './atelier-memory-tools';
// ...
for (const tool of getAtelierMemoryTools()) tools.push({ name: tool.name, description: tool.description, input_schema: tool.input_schema as Record<string, unknown>, handler: tool.handler });
```

- [ ] **Step 5: Post-write mirror hook** in `chat-tools.ts` write/edit wrapper: after a successful write whose `file_path` is under `.atelier/memory/`, fire-and-forget the bridge sync + a `daily_log` line:
```ts
const fp = (args as { file_path?: string })?.file_path;
if (fp && fp.includes('.atelier/memory')) {
  const memory = getMemoryManager();
  if (memory) {
    const projectDir = fp.split('.atelier')[0];
    void new AtelierMemoryBridge(memory).onMemoryFileWritten(fp, projectDir);
  }
}
```

- [ ] **Step 6: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/atelier-memory-tools.test.ts && npm run typecheck && npm run lint
git add src/tools/atelier-memory-tools.ts src/tools/index.ts src/agent/chat-tools.ts tests/unit/atelier-memory-tools.test.ts
git commit -m "feat(memory): memory_init tool + post-write mirror sync"
```

---

## Task 12: Commands namespacing (desktop + Telegram)

**Files:**
- Modify: `src/config/commands-loader.ts`
- Test: `tests/unit/pack-commands.test.ts`

**Interfaces:**
- Consumes: `commandsForPacks()`.
- Produces: `loadWorkflowCommands()` result includes pack commands with namespaced `name` (e.g. `atelier:design-review`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pack-commands.test.ts
import { describe, it, expect } from 'vitest';
import { loadWorkflowCommands } from '../../src/config/commands-loader';

describe('pack commands', () => {
  it('includes namespaced atelier and salon commands', () => {
    const cmds = loadWorkflowCommands();
    const names = cmds.map((c) => c.name);
    expect(names).toContain('atelier:design-review');
    expect(names).toContain('salon:campaign');
  });
  it('has no colliding names across packs', () => {
    const names = loadWorkflowCommands().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/pack-commands.test.ts`

- [ ] **Step 3: Merge pack commands into the loader**

In `src/config/commands-loader.ts`, extend `loadWorkflowCommands()`:
```ts
import { commandsForPacks } from '../marketplace/registry';

export function loadWorkflowCommands(): WorkflowCommand[] {
  const userCmds = loadWorkflowCommandsFromDir(getCommandsDir());
  const packCmds: WorkflowCommand[] = commandsForPacks().map((c) => ({
    name: c.ns, description: c.description, filename: `${c.ns}.md`, content: c.content,
  }));
  return [...packCmds, ...userCmds];
}
```
(`findWorkflowCommand` continues to work since it filters by `name`, which is now the namespaced id.)

- [ ] **Step 4: Run test + typecheck + lint. Commit**

```bash
npx vitest run tests/unit/pack-commands.test.ts && npm run typecheck && npm run lint
git add src/config/commands-loader.ts tests/unit/pack-commands.test.ts
git commit -m "feat(commands): expose namespaced atelier/salon commands to desktop + telegram"
```

---

## Task 13: Full-suite verification + feature flag default

**Files:**
- Modify: `src/settings/index.ts` (default `features.operatorPacks='true'` if a defaults map exists)
- Test: run the whole suite

- [ ] **Step 1: Set the default flag** where settings defaults live (search `features.` in `src/settings/`), add `features.operatorPacks` default `'true'`. If defaults are implicit (read with fallback), ensure every `SettingsManager.get('features.operatorPacks')` call treats `undefined` as enabled (`!== 'false'`).

- [ ] **Step 2: Run the entire suite**

Run: `npm run test`
Expected: all pass, including the 11 new test files.

- [ ] **Step 3: Full quality gate**

Run: `npm run typecheck && npm run lint`
Expected: zero errors/warnings.

- [ ] **Step 4: Manual smoke (documented, not automated)**

Run the app (`npm run dev`), switch to **Design** mode, ask "run a design review on this button: [describe]" — verify: (a) lane rules present in prompt logs, (b) the `skill` tool fires or design-reviewer subagent dispatches, (c) switching modes shows Coder last. Then `/atelier:memory-init` in a project session → `.atelier/memory/` seeded and mirrored (facts UI shows `atelier-memory` rows).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(packs): default operator-packs feature flag on + suite green"
```

---

## Self-Review

**Spec coverage:**
- §2.1 marketplace (seed/sync/loader) → Tasks 1, 1B, 2, 3. §2.2 modes/order → Task 4. §2.3 specialist subagents → Task 7. §2.4 skills → Task 6. §2.5 commands → Task 12. §2.6 rules → Task 5. §3 memory both-layers → Tasks 10–11. §4.1/4.2/4.3 hooks → Tasks 8/9/11. Feature flag → Task 13. First-run seed + startup/manual update cadence → Task 1B. All covered.

**Placeholder scan:** No "TBD/TODO/handle edge cases". Two spec-level open questions (persona shape, memory-init auto-run) were resolved in the plan: shared `OPERATOR_PREAMBLE` + lane delta (Task 4), explicit `memory_init` tool (Task 11).

**Type consistency:** `LaneId` used identically across packs/registry/modes/subagent/lane-context. `Skill` shape matches ggcoder. `readPack`/`skillsForLane`/`agentsForLane`/`rulesForLane`/`commandsForPacks`/`composeLaneRules`/`formatLaneSkills`/`buildLaneContextInjection`/`scanForBannedTone`/`AtelierMemoryBridge` names are consistent between definition and use.

**Known follow-ups (out of v1 scope):** enforcing `allowedTools` per mode; syncing SQLite edits back to files; expanding the ported `KEYWORDS` map to full parity with both hook scripts (Task 8 seeds the common ones).
