/**
 * Bridges discovered MCP tools into the agent's AgentTool[] surface
 * (roadmap item 5, step 2). This is the seam src/marketplace/mcp-status.ts's
 * module doc pointed at: `ToolsConfig.mcpServers` used to be dead data with
 * no transport behind it — this module resolves which servers are actually
 * allowed to run for the *current session's context* (the entire gating
 * chain: settings-enabled + credentials complete + scope enablement),
 * lazily spawns/connects them via src/mcp/manager.ts, and wraps each
 * discovered tool as a namespaced AgentTool the model can call directly.
 */

import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';
import { SettingsManager } from '../settings';
import { allMcpCatalogs } from '../marketplace/registry';
import {
  parseMcpMarketplaceConfig,
  buildEnabledResolvedServers,
  type ResolvedMcpServer,
} from '../marketplace/mcp-status';
import { resolveMcpEnablement } from './enablement';
import { MCP_MARKETPLACE_CONFIG_KEY } from './mcp-marketplace';
import { getMcpServerManager, DEFAULT_MCP_CALL_TIMEOUT_MS } from '../mcp/manager';
import { jsonSchemaToZod } from './schema-utils';
import type { SessionContext } from '../memory/sessions';
import type { McpToolDescriptor } from '../mcp/client';

/** Sanitize a catalog entry id or tool name into a safe tool-name segment. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** `mcp_<entryId>_<toolName>` (e.g. `mcp_buffer_createPost`), pack-prefixed on collision. */
function namespacedToolName(serverId: string, toolName: string, usedNames: Set<string>): string {
  const entryId = serverId.split(':')[1] ?? serverId;
  const base = `mcp_${sanitizeSegment(entryId)}_${sanitizeSegment(toolName)}`;
  if (!usedNames.has(base)) return base;
  // Collision (two different servers exposing the same entryId/toolName combo,
  // e.g. same-named entry id reused across packs) — disambiguate with the pack id.
  const packId = serverId.split(':')[0] ?? '';
  return `mcp_${sanitizeSegment(packId)}_${sanitizeSegment(entryId)}_${sanitizeSegment(toolName)}`;
}

/**
 * Every marketplace MCP server enabled+configured (settings gate) AND not
 * disabled anywhere in the given context's visible-scope chain (Phase 4
 * scope enablement) — the full gate a server must clear before it's spawned
 * for this session. Omitting `sessionContext` (e.g. a boot-time or
 * context-less caller) resolves to {} — no server is spawned without a known
 * scope to gate against; this is a deliberately conservative default, unlike
 * `isAgentEnabledForCurrentSession`'s "default to enabled" for dispatch
 * checks, because spawning a process/making network calls is more consequential
 * than a soft capability check.
 */
export function resolveSessionMcpServers(
  sessionContext: SessionContext | undefined,
  sessionId: string
): Record<string, ResolvedMcpServer> {
  if (!sessionContext) return {};
  const config = parseMcpMarketplaceConfig(SettingsManager.get(MCP_MARKETPLACE_CONFIG_KEY));
  const marketplace = allMcpCatalogs();
  return buildEnabledResolvedServers({
    marketplace,
    config,
    scopeEnabled: (packId, entryId) =>
      resolveMcpEnablement(sessionContext, packId, entryId, sessionId).enabled,
  });
}

function buildAgentToolForMcpTool(
  serverId: string,
  tool: McpToolDescriptor,
  toolName: string,
  timeoutMs: number
): AgentTool {
  const properties = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  return {
    name: toolName,
    description: tool.description
      ? `[MCP: ${serverId}] ${tool.description}`
      : `MCP tool "${tool.name}" from server "${serverId}".`,
    parameters: jsonSchemaToZod(properties, required),
    execute: async (args: unknown, _context: ToolContext): Promise<string> => {
      const manager = getMcpServerManager();
      const result = await manager.callTool(
        serverId,
        tool.name,
        (args ?? {}) as Record<string, unknown>,
        timeoutMs
      );
      return result.isError ? `Error: ${result.text}` : result.text;
    },
  };
}

/**
 * Resolve gated servers for the session, lazily ensure each is connected
 * (spawn on first need), and return one namespaced AgentTool per discovered
 * MCP tool. A server that fails to connect (bad credentials, network error,
 * crashed binary) simply contributes no tools — crash isolation happens in
 * src/mcp/manager.ts, so one dead server can never throw out of this
 * function or block the others from connecting (all connects run in
 * parallel via Promise.allSettled).
 */
export async function getMcpBridgedTools(
  sessionContext: SessionContext | undefined,
  sessionId: string,
  timeoutMs: number = DEFAULT_MCP_CALL_TIMEOUT_MS
): Promise<AgentTool[]> {
  const gated = resolveSessionMcpServers(sessionContext, sessionId);
  const ids = Object.keys(gated);
  if (ids.length === 0) return [];

  const manager = getMcpServerManager();
  await Promise.allSettled(ids.map((id) => manager.ensureServer(id, gated[id])));

  const usedNames = new Set<string>();
  const tools: AgentTool[] = [];
  for (const id of ids) {
    if (manager.getStatus(id) !== 'running') continue; // failed/starting — contributes nothing
    for (const mcpTool of manager.getTools(id)) {
      const toolName = namespacedToolName(id, mcpTool.name, usedNames);
      usedNames.add(toolName);
      tools.push(buildAgentToolForMcpTool(id, mcpTool, toolName, timeoutMs));
    }
  }
  return tools;
}
