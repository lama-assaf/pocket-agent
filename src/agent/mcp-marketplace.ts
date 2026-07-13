/**
 * Marketplace MCP servers — settings-backed enable/credential store, resolved
 * into the shape `ToolsConfig.mcpServers` (src/tools/index.ts) expects.
 *
 * Storage: a single encrypted settings key (`mcp.marketplace.config`, see
 * src/settings/schema.ts) holds a JSON blob of `{ [id]: { enabled, env } }`
 * for every marketplace-sourced MCP server the user has touched — never
 * written into synced pack files (src/marketplace/seed, <userData>/plugins),
 * which stay read-only-synced content. Resolution/gating logic is pure and
 * lives in src/marketplace/mcp-status.ts; this module is the only place that
 * reads the setting and calls it, so main/index.ts and mcp-ipc.ts share one
 * source of truth.
 *
 * See src/marketplace/mcp-status.ts's module doc for the runtime-scope caveat:
 * this closes the settings \u2192 ToolsConfig data flow, but @kenkaiiii/gg-agent
 * has no MCP client transport to actually spawn/connect these servers yet.
 *
 * Scope gating (Phase 4, src/agent/enablement.ts): this app builds ONE shared
 * `ToolsConfig.mcpServers` at agent boot, before any session/client is
 * selected — there is no "current client" at that point. So the only scope
 * gate this boot-time list can honor is the agency-wide (world) one, which
 * applies regardless of which client ends up active; a client/project-level
 * disable is a narrower, session-scoped decision surfaced instead via
 * `resolveMcpEnablement` (used by the Settings MCP list to preview what a
 * given context would see).
 */

import { SettingsManager } from '../settings';
import { allMcpCatalogs } from '../marketplace/registry';
import { isMcpEnabledAtWorldScope } from './enablement';
import {
  parseMcpMarketplaceConfig,
  buildEnabledResolvedServers,
  type ResolvedMcpServer,
} from '../marketplace/mcp-status';
import type { MCPServerConfig } from '../tools';

/** Settings key holding the marketplace MCP enable/credential blob (encrypted). */
export const MCP_MARKETPLACE_CONFIG_KEY = 'mcp.marketplace.config';

function toMCPServerConfig(resolved: ResolvedMcpServer): MCPServerConfig {
  if (resolved.kind === 'stdio') {
    return { command: resolved.command, args: resolved.args, env: resolved.env };
  }
  return { url: resolved.url, headers: resolved.headers };
}

/**
 * Every marketplace MCP server that's enabled and fully configured AND not
 * disabled at the agency-wide (world) scope, resolved to a concrete server
 * config keyed by its stable id (`<packId>:<entryId>`) — the value wired into
 * `ToolsConfig.mcpServers` at agent init (src/main/index.ts's
 * `initializeAgent`). A server missing required env, or explicitly disabled
 * for the whole agency, is never included here, regardless of its enabled flag.
 */
export function buildMarketplaceMcpServers(): Record<string, MCPServerConfig> {
  const config = parseMcpMarketplaceConfig(SettingsManager.get(MCP_MARKETPLACE_CONFIG_KEY));
  const marketplace = allMcpCatalogs();
  const resolved = buildEnabledResolvedServers({
    marketplace,
    config,
    scopeEnabled: isMcpEnabledAtWorldScope,
  });
  const out: Record<string, MCPServerConfig> = {};
  for (const [id, spec] of Object.entries(resolved)) out[id] = toMCPServerConfig(spec);
  return out;
}
