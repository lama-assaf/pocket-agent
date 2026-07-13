/**
 * MCP server status — merges first-party (native) server descriptors with
 * marketplace catalog templates (Atelier/Salon mcp-configs/mcp-servers.json,
 * see loader.ts's loadMcpCatalog) into one list, and resolves env-var gating +
 * `${VAR}` placeholder substitution. Pure logic, no electron/settings
 * dependency — the SettingsManager-backed store lives in
 * src/main/ipc/mcp-ipc.ts and src/agent/mcp-marketplace.ts, which are the only
 * callers that touch persisted config.
 *
 * IMPORTANT — runtime scope: this module computes which servers are enabled
 * and fully configured, and (for stdio/url entries) what their resolved
 * command/env or url/headers would be. It does NOT itself spawn processes or
 * speak the MCP protocol. This app's agent SDK (@kenkaiiii/gg-agent) has no
 * MCP client transport — `AgentOptions` only accepts in-process
 * `tools: AgentTool[]`, never a server list to connect to. Enabling a server
 * here marks it "enabled" and makes its resolved config available on
 * `ToolsConfig.mcpServers` (src/tools/index.ts) — the seam a future real MCP
 * client would consume — but it does not yet grant the model new callable
 * tools. See src/agent/mcp-marketplace.ts for where this is wired in.
 */

import type { McpCatalogEntry } from './types';

/** 'first-party' for native servers, or a marketplace pack id ('atelier' | 'salon'). */
export type McpSource = 'first-party' | string;

export interface McpServerStatus {
  /** Stable unique id: `first-party:<name>` or `<packId>:<entryId>`. */
  id: string;
  source: McpSource;
  kind: 'stdio' | 'url';
  name: string;
  description?: string;
  /** Env var names this server needs before it can be enabled. */
  requiredEnv: string[];
  /** True when every required env var has a stored value. */
  configured: boolean;
  /** Settings-level (Phase 3) enabled flag — global, not scoped. */
  enabled: boolean;
  /** False for first-party servers, which stay always-on. */
  toggleable: boolean;
  riskNote?: string;
  /** Scope-level (Phase 4) effective enabled state for the context this list was built for. Always true for non-toggleable (first-party) servers. */
  scopeEnabled: boolean;
  /** Scope the scope-level decision came from, or 'default' when nothing overrides the agency-wide baseline. */
  scopeEnablementScope: string;
}

/** Per-entry stored state: enabled flag + user-supplied env values (secrets). */
export interface McpEntryConfig {
  enabled: boolean;
  env: Record<string, string>;
}

/** The full settings-backed config blob (schema key `mcp.marketplace.config`). */
export type McpMarketplaceConfig = Record<string, McpEntryConfig>;

const PLACEHOLDER_RE = /\$\{([A-Z0-9_]+)\}/g;

/** All `${VAR}` placeholder names referenced anywhere in a catalog entry. */
export function extractRequiredEnv(entry: McpCatalogEntry): string[] {
  const names = new Set<string>();
  const scan = (s: string | undefined): void => {
    if (!s) return;
    for (const m of s.matchAll(PLACEHOLDER_RE)) names.add(m[1]);
  };
  scan(entry.url);
  if (entry.args) for (const a of entry.args) scan(a);
  if (entry.env) for (const v of Object.values(entry.env)) scan(v);
  if (entry.headers) for (const v of Object.values(entry.headers)) scan(v);
  return [...names];
}

/** Replace every `${VAR}` in `template` with `values[VAR]`; unknown placeholders pass through unchanged. */
export function substitutePlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  );
}

/** True when every required env var for `entry` has a non-empty stored value. */
export function isFullyConfigured(entry: McpCatalogEntry, env: Record<string, string>): boolean {
  return extractRequiredEnv(entry).every((name) => !!env[name]);
}

/** `<packId>:<entryId>` — the stable id used as both the settings-config key and the McpServerStatus id. */
export function marketplaceEntryId(packId: string, entryId: string): string {
  return `${packId}:${entryId}`;
}

/** Parse the settings-stored JSON blob. Malformed/partial content degrades to {}. */
export function parseMcpMarketplaceConfig(json: string): McpMarketplaceConfig {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: McpMarketplaceConfig = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as { enabled?: unknown; env?: unknown };
      const env: Record<string, string> = {};
      if (v.env && typeof v.env === 'object') {
        for (const [k, val] of Object.entries(v.env as Record<string, unknown>)) {
          if (typeof val === 'string') env[k] = val;
        }
      }
      out[id] = { enabled: v.enabled === true, env };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeMcpMarketplaceConfig(config: McpMarketplaceConfig): string {
  return JSON.stringify(config);
}

/** Minimal descriptor for a first-party (native) server entry in the unified list. */
export interface FirstPartyServerDescriptor {
  id: string;
  name: string;
  description?: string;
  kind: 'stdio' | 'url';
}

/**
 * Build the unified server status list for display (Settings UI / `mcp:listServers`).
 * First-party servers are always enabled/configured/non-toggleable. Marketplace
 * entries are toggleable and gated on their stored env values.
 *
 * `resolveScope`, when given, layers the Phase 4 scope-level enablement onto
 * each marketplace entry (`scopeEnabled`/`scopeEnablementScope`) — e.g. a
 * caller resolving against the active client/project context. Omitted
 * entirely, every marketplace entry defaults to `{ enabled: true, scope:
 * 'default' }` (no scope gate applied), preserving the Phase 3 shape.
 */
export function buildMcpServerStatusList(params: {
  firstParty: FirstPartyServerDescriptor[];
  marketplace: Array<{ packId: string; entry: McpCatalogEntry }>;
  config: McpMarketplaceConfig;
  resolveScope?: (packId: string, entryId: string) => { enabled: boolean; scope: string };
}): McpServerStatus[] {
  const out: McpServerStatus[] = [];

  for (const fp of params.firstParty) {
    out.push({
      id: `first-party:${fp.id}`,
      source: 'first-party',
      kind: fp.kind,
      name: fp.name,
      description: fp.description,
      requiredEnv: [],
      configured: true,
      enabled: true,
      toggleable: false,
      scopeEnabled: true,
      scopeEnablementScope: 'default',
    });
  }

  for (const { packId, entry } of params.marketplace) {
    const id = marketplaceEntryId(packId, entry.id);
    const stored = params.config[id];
    const env = stored?.env ?? {};
    const scope = params.resolveScope?.(packId, entry.id) ?? { enabled: true, scope: 'default' };
    out.push({
      id,
      source: packId,
      kind: entry.kind,
      name: entry.id,
      description: entry.description,
      requiredEnv: extractRequiredEnv(entry),
      configured: isFullyConfigured(entry, env),
      enabled: stored?.enabled === true,
      toggleable: true,
      riskNote: entry.riskNote,
      scopeEnabled: scope.enabled,
      scopeEnablementScope: scope.scope,
    });
  }

  return out;
}

/** Resolved, ready-to-use server spec for one entry once enabled + fully configured. */
export type ResolvedMcpServer =
  | { kind: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { kind: 'url'; url: string; headers: Record<string, string> };

/** Resolve one catalog entry's `${VAR}` template into a concrete spec using stored env values. */
export function resolveMcpServer(
  entry: McpCatalogEntry,
  env: Record<string, string>
): ResolvedMcpServer | null {
  if (entry.kind === 'stdio') {
    if (!entry.command) return null;
    const resolvedEnv: Record<string, string> = {};
    for (const [k, template] of Object.entries(entry.env ?? {})) {
      resolvedEnv[k] = substitutePlaceholders(template, env);
    }
    return {
      kind: 'stdio',
      command: entry.command,
      args: (entry.args ?? []).map((a) => substitutePlaceholders(a, env)),
      env: resolvedEnv,
    };
  }
  if (!entry.url) return null;
  const headers: Record<string, string> = {};
  for (const [k, template] of Object.entries(entry.headers ?? {})) {
    headers[k] = substitutePlaceholders(template, env);
  }
  return { kind: 'url', url: substitutePlaceholders(entry.url, env), headers };
}

/**
 * Every marketplace server that is enabled AND fully configured, resolved to
 * its concrete spec, keyed by its stable id. Disabled or under-configured
 * entries are excluded entirely — the gate that keeps an incomplete server
 * out of `ToolsConfig.mcpServers` (see src/agent/mcp-marketplace.ts).
 *
 * `scopeEnabled`, when given, is an additional predicate layered on top of
 * the settings gate (e.g. Phase 4's agency-wide/world-scope disablement) —
 * a server failing this predicate is excluded even if enabled+configured.
 * Omitted, every entry passes (Phase 3 behavior, unchanged).
 */
export function buildEnabledResolvedServers(params: {
  marketplace: Array<{ packId: string; entry: McpCatalogEntry }>;
  config: McpMarketplaceConfig;
  scopeEnabled?: (packId: string, entryId: string) => boolean;
}): Record<string, ResolvedMcpServer> {
  const out: Record<string, ResolvedMcpServer> = {};
  for (const { packId, entry } of params.marketplace) {
    const id = marketplaceEntryId(packId, entry.id);
    const stored = params.config[id];
    if (!stored?.enabled) continue;
    if (!isFullyConfigured(entry, stored.env)) continue;
    if (params.scopeEnabled && !params.scopeEnabled(packId, entry.id)) continue;
    const resolved = resolveMcpServer(entry, stored.env);
    if (resolved) out[id] = resolved;
  }
  return out;
}
