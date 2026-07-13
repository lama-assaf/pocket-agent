// src/marketplace/enablement.ts
// Scoped enable/disable for marketplace agents and MCP servers — same
// nearer-scope-wins mechanics as src/marketplace/overrides.ts, but a plain
// boolean flag instead of a field-merge. Stored as scoped facts:
//   category 'enabled-agents', subject '<packId>:<agentName>'
//   category 'enabled-mcp',    subject '<packId>:<entryId>'  (marketplace
//     servers only — first-party MCP servers are never scoped, they stay
//     always-on; see src/marketplace/mcp-status.ts)
//
// Default (no fact anywhere in the visible scope chain): enabled = true —
// "everything enabled at world scope" in practice, since the absence of any
// fact behaves identically to an implicit world-scope enable. A client or
// project can write an explicit disable (or re-enable) fact that overrides a
// broader scope, exactly like agent-overrides.ts's prompt/tools/model merge.
//
// Memory-aware glue (reads/writes via MemoryManager) lives in
// src/agent/enablement.ts; this module is pure so it stays unit-testable
// without a MemoryManager, matching overrides.ts's contract.

import { scopeSpecificity } from '../memory/scope';

export const ENABLED_AGENTS_CATEGORY = 'enabled-agents';
export const ENABLED_MCP_CATEGORY = 'enabled-mcp';
export type EnablementCategory = typeof ENABLED_AGENTS_CATEGORY | typeof ENABLED_MCP_CATEGORY;

/** Subject key for one agent's enablement fact. */
export function agentEnablementSubject(packId: string, agentName: string): string {
  return `${packId}:${agentName}`;
}

/** Subject key for one marketplace MCP server's enablement fact (matches McpServerStatus.id shape). */
export function mcpEnablementSubject(packId: string, entryId: string): string {
  return `${packId}:${entryId}`;
}

/** Minimal fact-shaped row this module reads — duck-typed like overrides.ts's OverrideRow. */
export interface EnablementRow {
  scope: string;
  category: string;
  subject: string;
  content: string;
}

/** Parse a fact's content into a boolean. Only the literal 'false' means disabled — anything else (including malformed content) degrades to enabled. */
export function parseEnablementContent(content: string): boolean {
  return content.trim().toLowerCase() !== 'false';
}

export function serializeEnablementContent(enabled: boolean): string {
  return enabled ? 'true' : 'false';
}

/** Scope key where a resolved enablement decision came from, or 'default' when nothing overrides the implicit enabled-everywhere baseline. */
export type ResolvedScope = string | 'default';

export interface ResolvedEnablement {
  enabled: boolean;
  scope: ResolvedScope;
}

/**
 * Pick the nearest-scope enablement fact for one subject from a set of rows
 * already fetched for the visible scope chain. Ranks by `scopeSpecificity`,
 * mirroring overrides.ts's pickNearestOverride. Returns null when no fact
 * exists anywhere in the chain.
 */
export function pickNearestEnablement(
  rows: EnablementRow[],
  category: EnablementCategory,
  subject: string
): { enabled: boolean; scope: string } | null {
  let best: EnablementRow | null = null;
  for (const row of rows) {
    if (row.category !== category || row.subject !== subject) continue;
    if (!best || scopeSpecificity(row.scope) > scopeSpecificity(best.scope)) best = row;
  }
  if (!best) return null;
  return { enabled: parseEnablementContent(best.content), scope: best.scope };
}

/** Effective enablement for one subject: the nearest fact if any, otherwise the default (enabled, scope 'default'). */
export function resolveEnablement(
  rows: EnablementRow[],
  category: EnablementCategory,
  subject: string
): ResolvedEnablement {
  return pickNearestEnablement(rows, category, subject) ?? { enabled: true, scope: 'default' };
}
