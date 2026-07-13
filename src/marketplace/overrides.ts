// src/marketplace/overrides.ts
// Local overrides layer for marketplace pack agents — lets a user edit an
// agent's prompt/tools/model without touching the read-only synced pack
// content (which a `PackSyncManager.checkAndUpdate()` re-sync can replace at
// any time). Overrides are stored as scoped facts elsewhere
// (src/agent/agent-overrides.ts is the memory-aware glue that reads/writes
// them); this module holds the pure parse/merge logic only, so it stays
// testable without a MemoryManager and keeps the marketplace package's
// existing no-electron/no-DB contract (see marketplace/paths.ts, sync.ts).
//
// Storage shape: category `agent-override`, subject `<packId>:<agentName>`,
// content = JSON `{ prompt?, tools?, model? }`. Scoped like `how_to_act`
// (src/agent/how-to-act.ts) — nearer scope wins for the same subject, so a
// client's override wins over an agency-wide one for the same agent. Because
// overrides live in SQLite while synced pack content lives on disk under
// <userData>/plugins, a pack re-sync never touches them.

import type { PackAgent } from './types';
import { scopeSpecificity } from '../memory/scope';

/** Fact category that marks a row as a marketplace agent override. */
export const AGENT_OVERRIDE_CATEGORY = 'agent-override';

/** The fact subject key for one pack agent's override. */
export function overrideSubject(packId: string, agentName: string): string {
  return `${packId}:${agentName}`;
}

/** Editable subset of a PackAgent. Every field optional — an override may touch just the prompt. */
export interface AgentOverrideFields {
  prompt?: string;
  tools?: string[];
  model?: string;
}

/** Minimal fact-shaped row this module reads — duck-typed so callers don't need the full `Fact` type. */
export interface OverrideRow {
  scope: string;
  category: string;
  subject: string;
  content: string;
}

/** True when an override has no fields set (equivalent to no override at all). */
export function isEmptyOverride(fields: AgentOverrideFields): boolean {
  return fields.prompt === undefined && fields.tools === undefined && fields.model === undefined;
}

/** Parse a fact's JSON content into override fields. Malformed/partial content degrades gracefully. */
export function parseOverrideContent(content: string): AgentOverrideFields {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    const out: AgentOverrideFields = {};
    if (typeof obj.prompt === 'string') out.prompt = obj.prompt;
    if (Array.isArray(obj.tools) && obj.tools.every((t) => typeof t === 'string')) {
      out.tools = obj.tools as string[];
    }
    if (typeof obj.model === 'string') out.model = obj.model;
    return out;
  } catch {
    return {};
  }
}

/** Serialize override fields to a fact's JSON content, dropping unset fields. */
export function serializeOverrideContent(fields: AgentOverrideFields): string {
  const out: AgentOverrideFields = {};
  if (fields.prompt !== undefined) out.prompt = fields.prompt;
  if (fields.tools !== undefined) out.tools = fields.tools;
  if (fields.model !== undefined) out.model = fields.model;
  return JSON.stringify(out);
}

/**
 * Pick the nearest-scope override for one agent from a set of rows already
 * fetched for the visible scope chain. Ranks by `scopeSpecificity`, mirroring
 * how-to-act.ts's formatBrandVoice ("nearer scope wins" for the same subject).
 * Returns null when no row matches this agent's category+subject.
 */
export function pickNearestOverride(
  rows: OverrideRow[],
  packId: string,
  agentName: string
): { fields: AgentOverrideFields; scope: string } | null {
  const subject = overrideSubject(packId, agentName);
  let best: OverrideRow | null = null;
  for (const row of rows) {
    if (row.category !== AGENT_OVERRIDE_CATEGORY || row.subject !== subject) continue;
    if (!best || scopeSpecificity(row.scope) > scopeSpecificity(best.scope)) best = row;
  }
  if (!best) return null;
  return { fields: parseOverrideContent(best.content), scope: best.scope };
}

/** Merge an override over a base pack agent. Unset override fields fall through to the base. */
export function applyAgentOverride(
  base: PackAgent,
  override: AgentOverrideFields | null | undefined
): PackAgent {
  if (!override) return base;
  return {
    ...base,
    prompt: override.prompt ?? base.prompt,
    tools: override.tools ?? base.tools,
    model: override.model ?? base.model,
  };
}
