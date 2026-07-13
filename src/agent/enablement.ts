/**
 * Scoped enable/disable resolution for marketplace agents and MCP servers —
 * memory-aware glue over src/marketplace/enablement.ts's pure logic, same
 * shape as src/agent/agent-overrides.ts. Facts live in SQLite (scoped,
 * nearer-scope-wins); a pack re-sync or the Phase 3 settings gate
 * (src/agent/mcp-marketplace.ts) never touches them — this is a second,
 * independent gate layered on top.
 *
 * Consumption points:
 *  - src/tools/subagent.ts (resolveSpecialist + the subagent tool's
 *    specialist list) — a disabled agent must not be dispatchable.
 *  - src/main/ipc/marketplace-ipc.ts (Agents panel listing) — shows the
 *    active context's effective enabled state + which scope it came from.
 *  - src/agent/mcp-marketplace.ts (buildMarketplaceMcpServers) — a
 *    world-scope-disabled MCP server is excluded from ToolsConfig.mcpServers
 *    even when the Phase 3 settings gate (enabled + fully configured) passes.
 *  - src/main/ipc/mcp-ipc.ts (Settings MCP list) — shows scope state for the
 *    active context alongside the settings-level enabled/configured state.
 */

import { getMemoryManager } from '../tools/memory-tools';
import { getCurrentSessionId } from '../tools/session-context';
import { resolveVisibleScopes, resolveNearestScope, WORLD_SCOPE } from '../memory/scope';
import type { SessionContext } from '../memory/sessions';
import {
  ENABLED_AGENTS_CATEGORY,
  ENABLED_MCP_CATEGORY,
  agentEnablementSubject,
  mcpEnablementSubject,
  resolveEnablement,
  serializeEnablementContent,
  parseEnablementContent,
  type EnablementCategory,
  type ResolvedEnablement,
} from '../marketplace/enablement';

export type { ResolvedEnablement } from '../marketplace/enablement';

/** Fetch the fact rows for `category`, restricted to the context's visible scopes. Degrades to [] on any failure (memory unset, no context, malformed selection). */
function visibleRows(
  context: SessionContext | undefined,
  sessionId: string,
  category: EnablementCategory
): EnablementRowLike[] {
  const memory = getMemoryManager();
  if (!memory || !context) return [];
  let scopes: string[];
  try {
    scopes = resolveVisibleScopes(context, sessionId);
  } catch {
    return [];
  }
  const scopeSet = new Set(scopes);
  return memory.getAllFacts().filter((f) => f.category === category && scopeSet.has(f.scope));
}

interface EnablementRowLike {
  scope: string;
  category: string;
  subject: string;
  content: string;
}

// ── Agents ──

/** Effective enablement for one marketplace agent, visible to the given context. Defaults to enabled. */
export function resolveAgentEnablement(
  context: SessionContext | undefined,
  packId: string,
  agentName: string,
  sessionId: string
): ResolvedEnablement {
  const rows = visibleRows(context, sessionId, ENABLED_AGENTS_CATEGORY);
  return resolveEnablement(rows, ENABLED_AGENTS_CATEGORY, agentEnablementSubject(packId, agentName));
}

/**
 * Convenience: true when the agent is dispatchable (not disabled) for the
 * *current* async-local session (src/tools/session-context.ts) — the
 * dispatch-time check subagent.ts uses, mirroring
 * resolvePackAgentForCurrentSession's session-context resolution. Degrades to
 * enabled when memory isn't initialized or the session has no selected
 * context — never throws, never silently blocks dispatch on a plumbing gap.
 */
export function isAgentEnabledForCurrentSession(packId: string, agentName: string): boolean {
  const memory = getMemoryManager();
  if (!memory) return true;
  const sessionId = getCurrentSessionId();
  let context: SessionContext;
  try {
    context = memory.getSessionContext(sessionId);
  } catch {
    return true;
  }
  return resolveAgentEnablement(context, packId, agentName, sessionId).enabled;
}

// ── MCP servers ──

/** Effective enablement for one marketplace MCP server, visible to the given context. Defaults to enabled. */
export function resolveMcpEnablement(
  context: SessionContext | undefined,
  packId: string,
  entryId: string,
  sessionId: string
): ResolvedEnablement {
  const rows = visibleRows(context, sessionId, ENABLED_MCP_CATEGORY);
  return resolveEnablement(rows, ENABLED_MCP_CATEGORY, mcpEnablementSubject(packId, entryId));
}

/**
 * True unless a fact explicitly disables this MCP server at the agency-wide
 * (world) scope specifically. No session/context needed — world is the one
 * scope that applies regardless of which client is active, so this is the
 * gate `buildMarketplaceMcpServers` (src/agent/mcp-marketplace.ts) can safely
 * apply to the single shared boot-time server config (which has no notion of
 * "the current client"). Client/project-level disablement is a narrower,
 * session-scoped decision surfaced via `resolveMcpEnablement` instead —
 * see that module's doc comment for why per-session MCP gating isn't wired
 * into the live agent loop yet. Degrades to enabled when memory isn't set.
 */
export function isMcpEnabledAtWorldScope(packId: string, entryId: string): boolean {
  const memory = getMemoryManager();
  if (!memory) return true;
  const subject = mcpEnablementSubject(packId, entryId);
  const fact = memory
    .getAllFacts()
    .find(
      (f) => f.category === ENABLED_MCP_CATEGORY && f.subject === subject && f.scope === WORLD_SCOPE
    );
  if (!fact) return true;
  return parseEnablementContent(fact.content);
}

// ── Get / set / clear at the resolved scope (Agents panel + Settings MCP list) ──

function getEnablementAtScope(
  context: SessionContext,
  category: EnablementCategory,
  subject: string
): { scope: string; enabled: boolean } | null {
  const memory = getMemoryManager();
  if (!memory) return null;
  const scope = resolveNearestScope(context);
  const fact = memory
    .getAllFacts()
    .find((f) => f.category === category && f.subject === subject && f.scope === scope);
  if (!fact) return null;
  return { scope, enabled: parseEnablementContent(fact.content) };
}

function setEnablement(
  context: SessionContext,
  category: EnablementCategory,
  subject: string,
  enabled: boolean
): { success: boolean; scope?: string; error?: string } {
  const memory = getMemoryManager();
  if (!memory) return { success: false, error: 'Memory not initialized' };
  const scope = resolveNearestScope(context);
  memory.saveFact(category, subject, serializeEnablementContent(enabled), false, scope);
  return { success: true, scope };
}

function clearEnablement(
  context: SessionContext,
  category: EnablementCategory,
  subject: string
): { success: boolean; scope: string } {
  const scope = resolveNearestScope(context);
  const memory = getMemoryManager();
  if (!memory) return { success: false, scope };
  const fact = memory
    .getAllFacts()
    .find((f) => f.category === category && f.subject === subject && f.scope === scope);
  if (!fact) return { success: true, scope }; // already inheriting — nothing to clear
  memory.deleteFact(fact.id);
  return { success: true, scope };
}

export function getAgentEnablementAtScope(
  context: SessionContext,
  packId: string,
  agentName: string
): { scope: string; enabled: boolean } | null {
  return getEnablementAtScope(context, ENABLED_AGENTS_CATEGORY, agentEnablementSubject(packId, agentName));
}

export function setAgentEnablement(
  context: SessionContext,
  packId: string,
  agentName: string,
  enabled: boolean
): { success: boolean; scope?: string; error?: string } {
  return setEnablement(context, ENABLED_AGENTS_CATEGORY, agentEnablementSubject(packId, agentName), enabled);
}

export function clearAgentEnablement(
  context: SessionContext,
  packId: string,
  agentName: string
): { success: boolean; scope: string } {
  return clearEnablement(context, ENABLED_AGENTS_CATEGORY, agentEnablementSubject(packId, agentName));
}

export function getMcpEnablementAtScope(
  context: SessionContext,
  packId: string,
  entryId: string
): { scope: string; enabled: boolean } | null {
  return getEnablementAtScope(context, ENABLED_MCP_CATEGORY, mcpEnablementSubject(packId, entryId));
}

export function setMcpEnablement(
  context: SessionContext,
  packId: string,
  entryId: string,
  enabled: boolean
): { success: boolean; scope?: string; error?: string } {
  return setEnablement(context, ENABLED_MCP_CATEGORY, mcpEnablementSubject(packId, entryId), enabled);
}

export function clearMcpEnablement(
  context: SessionContext,
  packId: string,
  entryId: string
): { success: boolean; scope: string } {
  return clearEnablement(context, ENABLED_MCP_CATEGORY, mcpEnablementSubject(packId, entryId));
}
