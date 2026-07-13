/**
 * Marketplace agent overrides — local edits layered over synced pack agents
 * (Atelier/Salon), stored as scoped facts (category `agent-override`) so they
 * survive a `PackSyncManager` re-sync untouched: facts live in SQLite, synced
 * pack content lives on disk under <userData>/plugins — entirely separate
 * stores, so an update never clobbers an override. Follows the same
 * nearer-scope-wins rule as `how_to_act` (./how-to-act.ts): a client's
 * override wins over the agency (world) default for the same agent.
 *
 * This is the resolution point every dispatch/listing path should go through:
 * the subagent tool (src/tools/subagent.ts), and the marketplace IPC
 * (src/main/ipc/marketplace-ipc.ts) that backs the Agents panel.
 */

import { getMemoryManager } from '../tools/memory-tools';
import { getCurrentSessionId } from '../tools/session-context';
import { resolveVisibleScopes, resolveNearestScope } from '../memory/scope';
import type { SessionContext } from '../memory/sessions';
import type { PackAgent } from '../marketplace/types';
import {
  AGENT_OVERRIDE_CATEGORY,
  overrideSubject,
  pickNearestOverride,
  applyAgentOverride,
  serializeOverrideContent,
  parseOverrideContent,
  isEmptyOverride,
  type AgentOverrideFields,
} from '../marketplace/overrides';

export type { AgentOverrideFields } from '../marketplace/overrides';

/** Resolved override: the fields that apply, and the scope they were found at. */
export interface ResolvedOverride {
  fields: AgentOverrideFields;
  scope: string;
}

/**
 * The nearest-scope override for one pack agent, visible to the given context.
 * Returns null when no override exists anywhere in the visible scope chain, or
 * when memory isn't initialized / no context is given — degrades to "no
 * override" rather than throwing, so callers can resolve unconditionally.
 */
export function resolveAgentOverride(
  context: SessionContext | undefined,
  packId: string,
  agentName: string,
  sessionId: string
): ResolvedOverride | null {
  const memory = getMemoryManager();
  if (!memory || !context) return null;
  let scopes: string[];
  try {
    scopes = resolveVisibleScopes(context, sessionId);
  } catch {
    return null;
  }
  const scopeSet = new Set(scopes);
  const rows = memory
    .getAllFacts()
    .filter((f) => f.category === AGENT_OVERRIDE_CATEGORY && scopeSet.has(f.scope));
  return pickNearestOverride(rows, packId, agentName);
}

/** Merge the nearest-scope override (if any) over a base pack agent for the given context. */
export function resolvePackAgent(
  base: PackAgent,
  packId: string,
  context: SessionContext | undefined,
  sessionId: string
): PackAgent {
  const resolved = resolveAgentOverride(context, packId, base.name, sessionId);
  return applyAgentOverride(base, resolved?.fields ?? null);
}

/**
 * Resolve a pack agent's override using the *current* async-local session
 * (src/tools/session-context.ts) — the convenience path for tool dispatch
 * (subagent.ts), where only a sessionId is available, not an explicit
 * context object. Degrades to the base agent when memory isn't initialized
 * or the session has no selected context (e.g. tests that never call
 * setSessionContext) — never throws.
 */
export function resolvePackAgentForCurrentSession(packId: string, base: PackAgent): PackAgent {
  const memory = getMemoryManager();
  if (!memory) return base;
  const sessionId = getCurrentSessionId();
  let context: SessionContext;
  try {
    context = memory.getSessionContext(sessionId);
  } catch {
    return base;
  }
  return resolvePackAgent(base, packId, context, sessionId);
}

/**
 * The override fields set AT the exact scope resolved for `context` (not
 * merged/inherited from a broader scope) — used to prefill the edit form with
 * "what's set here", distinct from `resolveAgentOverride`'s merged view.
 */
export function getAgentOverrideAtScope(
  context: SessionContext,
  packId: string,
  agentName: string
): { scope: string; fields: AgentOverrideFields } | null {
  const memory = getMemoryManager();
  if (!memory) return null;
  const scope = resolveNearestScope(context);
  const subject = overrideSubject(packId, agentName);
  const fact = memory
    .getAllFacts()
    .find(
      (f) => f.category === AGENT_OVERRIDE_CATEGORY && f.subject === subject && f.scope === scope
    );
  if (!fact) return null;
  return { scope, fields: parseOverrideContent(fact.content) };
}

/**
 * Save (create or update) an override at the scope resolved for `context`.
 * Rejects an empty field set — use `clearAgentOverride` to remove one instead
 * of writing a no-op fact.
 */
export function setAgentOverride(
  context: SessionContext,
  packId: string,
  agentName: string,
  fields: AgentOverrideFields
): { success: boolean; scope?: string; error?: string } {
  const memory = getMemoryManager();
  if (!memory) return { success: false, error: 'Memory not initialized' };
  if (isEmptyOverride(fields)) {
    return { success: false, error: 'No fields to override' };
  }
  const scope = resolveNearestScope(context);
  const subject = overrideSubject(packId, agentName);
  memory.saveFact(AGENT_OVERRIDE_CATEGORY, subject, serializeOverrideContent(fields), false, scope);
  return { success: true, scope };
}

/**
 * Remove the override at the scope resolved for `context` — "Reset to
 * marketplace default". Only ever touches that one scope: a client's reset
 * never deletes an agency-level override, and vice versa (respects whichever
 * scope is active, same as the Brain workbench's per-space semantics).
 */
export function clearAgentOverride(
  context: SessionContext,
  packId: string,
  agentName: string
): { success: boolean; scope: string } {
  const scope = resolveNearestScope(context);
  const memory = getMemoryManager();
  if (!memory) return { success: false, scope };
  const subject = overrideSubject(packId, agentName);
  const fact = memory
    .getAllFacts()
    .find(
      (f) => f.category === AGENT_OVERRIDE_CATEGORY && f.subject === subject && f.scope === scope
    );
  if (!fact) return { success: true, scope }; // already clear
  memory.deleteFact(fact.id);
  return { success: true, scope };
}
