# Sub-Agent Spawning for Pocket Agent

## Overview

Add the ability for the main agent to spawn parallel sub-agents that run independently with their own context, tools, and system prompts. Adapted from the working `createSubAgentTool` in `gg-coder`, but running **in-process** via `agentLoop()` instead of spawning CLI child processes.

## Architecture

The gg-coder version spawns a child process of itself with `--json` mode and reads NDJSON events. For Pocket Agent (Electron desktop app), we'll run sub-agents in-process using `agentLoop()` from `@kenkaiiii/gg-agent` directly. This is cleaner — no binary to spawn, shared tool access, and we can reuse existing tool infrastructure.

Each sub-agent:
- Gets its own `agentLoop()` call with independent messages array
- Has a configurable tool set (subset of parent's tools)
- Runs as a background async task
- Reports progress via `onUpdate` callbacks
- Has turn limits to prevent runaway costs
- Returns results to the parent agent

## Files to Create

### 1. `src/tools/subagent.ts` — Sub-Agent Tool

New file. Core implementation adapted from `gg-coder/packages/ggcoder/src/tools/subagent.ts`.

**Key differences from gg-coder version:**
- **In-process**: Uses `agentLoop()` directly instead of `spawn()`ing a child process
- **Tool access**: Sub-agent gets a subset of the parent's `AgentTool[]` (browser, memory, shell, web_fetch)
- **System prompt**: Configurable per-agent via agent definitions or inline
- **Progress tracking**: Same `onUpdate` pattern with toolUseCount, tokenUsage, currentActivity

```typescript
// Parameters
const SubAgentParams = z.object({
  task: z.string().describe("The task to delegate to the sub-agent"),
  agent: z.string().optional().describe("Named agent type: 'researcher', 'coder', 'writer', or custom"),
  tools: z.array(z.string()).optional().describe("Specific tools to give the sub-agent (defaults to safe subset)"),
});

// Factory
export function createSubAgentTool(
  parentTools: AgentTool[],
  getStreamConfig: () => Promise<StreamConfig>,
): AgentTool<typeof SubAgentParams>
```

**Sub-agent tool subset (safe defaults):**
- `web_fetch`, `shell_command`, `web_search` (server tool)
- Memory tools (`remember`, `forget`, `list_facts`, `memory_search`)
- Browser tool
- Notify tool (so it can alert when done)

**NOT included by default (parent-only):**
- `switch_agent` (only parent switches modes)
- `subagent` (no recursive spawning)
- Scheduler tools (parent manages scheduling)

**Constants:**
- `SUB_AGENT_MAX_TURNS = 15` (slightly higher than gg-coder's 10 since we're in-process)
- `SUB_AGENT_MAX_OUTPUT_CHARS = 100_000`
- `SUB_AGENT_TIMEOUT_MS = 300_000` (5 min hard timeout)

### 2. `src/tools/subagent-registry.ts` — Active Sub-Agent Tracking

New file. Tracks running sub-agents for status display and management.

```typescript
interface SubAgentEntry {
  id: string;
  task: string;
  agent: string;
  status: 'running' | 'done' | 'error';
  startedAt: Date;
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  currentActivity?: string;
  result?: string;
  error?: string;
}

// Simple in-memory registry
const registry = new Map<string, SubAgentEntry>();

export function registerSubAgent(entry: SubAgentEntry): void;
export function updateSubAgent(id: string, update: Partial<SubAgentEntry>): void;
export function getSubAgent(id: string): SubAgentEntry | undefined;
export function listSubAgents(): SubAgentEntry[];
export function removeSubAgent(id: string): void;
```

## Files to Modify

### 3. `src/agent/chat-tools.ts` — Register sub-agent tool

In `getChatAgentTools()`, add the sub-agent tool to the tools array:

```typescript
import { createSubAgentTool } from '../tools/subagent';

// After building existing tools...
tools.push(createSubAgentTool(tools, getStreamConfigFn));
```

The sub-agent tool receives the parent's tool array so it can select a subset for sub-agents. We pass a reference to the already-built tools — the sub-agent tool filters out `switch_agent` and `subagent` itself to prevent recursion.

### 4. `src/agent/agent-modes.ts` — Add subagent to allowed tools

Add `'subagent'` to the `allowedTools` arrays for modes that should be able to spawn sub-agents:

- `general` — yes (orchestrator role)
- `coder` — yes (can delegate research subtasks)  
- `researcher` — yes (can parallelize research)
- `writer` — no (focused writing, no delegation)
- `therapist` — no (focused conversation)

## Implementation Order

1. **`src/tools/subagent-registry.ts`** — Create the registry (no dependencies)
2. **`src/tools/subagent.ts`** — Create the sub-agent tool (depends on registry)
3. **`src/agent/chat-tools.ts`** — Wire sub-agent tool into chat tools
4. **`src/agent/agent-modes.ts`** — Add to allowed tool lists
5. **Typecheck + lint** — Verify everything compiles

## Design Decisions

- **In-process, not child process**: Electron app has no CLI binary to spawn. `agentLoop()` is stateless and lightweight — perfect for parallel execution.
- **Same provider/model as parent**: Sub-agents inherit the parent's model config. No separate API key management.
- **No recursive spawning**: Sub-agents can't spawn their own sub-agents. The `subagent` tool is excluded from the sub-agent's tool set.
- **Blocking by default**: Like gg-coder, the sub-agent tool blocks until the sub-agent completes and returns results to the parent. The parent's agent loop handles this naturally — it can call multiple sub-agents in parallel if it makes multiple tool calls in one turn.
- **Output truncation**: Same approach as gg-coder — cap output chars and lines to prevent blowing up the parent's context window.

## Risks

- **Token cost**: Each sub-agent is a full agent loop with its own context. Multiple sub-agents = multiple API calls. Mitigated by turn limits.
- **Concurrent tool access**: Multiple sub-agents + parent all sharing tools like browser could cause conflicts. Browser tool already handles this with locking. Memory tools are safe for concurrent reads.
- **Context overflow**: Sub-agent results injected into parent context could push it over limits. Mitigated by output truncation (100k char cap).

## Verification

1. `npm run typecheck` — no errors
2. `npm run lint` — no warnings  
3. Manual test: Ask the agent to "research X and Y in parallel" — should spawn sub-agents
4. Check that sub-agents complete and return results to parent
5. Verify abort signal propagation (stopping parent should stop sub-agents)
