/**
 * X/Twitter analytics sync orchestration — the auto-sync counterpart to
 * src/integrations/linkedin/sync.ts, built to the same contract (per-scope
 * config as a scoped FACT, never-throws sync function, independent-per-scope
 * sweep) but sourced differently: LinkedIn gets a dedicated REST client
 * (src/integrations/linkedin/client.ts) behind this app's own OAuth app,
 * because LinkedIn's Community Management API needs partnership-gated
 * app-level credentials this app owns end to end.
 *
 * X has no such first-party integration in this app — exactly like the
 * content-posting side (src/tools/content-tools.ts's postApprovedDraft),
 * which posts to X through whichever marketplace MCP server the workspace
 * has bridged in (x-api, x-api-bearer, twitter-community, etc. — see
 * src/marketplace/seed/salon/mcp-configs/mcp-servers.json), not a bespoke
 * client. This module mirrors that: it discovers an already-bridged,
 * analytics-shaped MCP tool for the workspace (see findXAnalyticsMcpTool)
 * and calls it, instead of talking to api.x.com directly. That keeps X
 * auto-sync working with whichever X-capable MCP server the operator has
 * actually configured, matching the tooling already supported for this
 * channel rather than inventing a second, parallel credential path.
 *
 * The X handle a scope tracks is stored as a scoped FACT (category
 * 'integration', subject 'x_handle'), same isolation rationale as LinkedIn's
 * org URN — one client's handle must never bleed into another's.
 */

import type { MemoryManager } from '../../memory/index';
import { getMcpBridgedTools } from '../../agent/mcp-bridge';
import { USER_SCOPE } from '../../memory/scope';
import type { SessionContext } from '../../memory/sessions';
import { parseXAnalyticsToolResponse } from './parse';

export const X_INTEGRATION_CATEGORY = 'integration';
export const X_HANDLE_SUBJECT = 'x_handle';
export const X_CHANNEL = 'twitter';

/** Synthetic session id for MCP-enablement resolution during a background sweep — no real chat session backs an auto-sync run (same pattern as analytics-ipc.ts's ANALYTICS_UI_SESSION_ID). */
export const X_SYNC_SESSION_ID = 'ipc:x-sync';

/** The X handle (no leading '@') this scope is configured to sync, or null if unset (empty content counts as unset). */
export function getXHandleForScope(memory: MemoryManager, scope: string): string | null {
  const fact = memory
    .getAllFacts()
    .find(
      (f) =>
        f.scope === scope && f.category === X_INTEGRATION_CATEGORY && f.subject === X_HANDLE_SUBJECT
    );
  const handle = fact?.content?.trim();
  return handle ? handle : null;
}

/** Set (or clear, by passing '') the X handle a scope syncs against. */
export function setXHandleForScope(memory: MemoryManager, scope: string, handle: string): void {
  memory.saveFact(
    X_INTEGRATION_CATEGORY,
    X_HANDLE_SUBJECT,
    handle.trim().replace(/^@/, ''),
    false,
    scope
  );
}

/** Every (scope, handle) pair configured anywhere in the store, for the auto-sync sweep. */
export function allConfiguredXScopes(
  memory: MemoryManager
): Array<{ scope: string; handle: string }> {
  return memory
    .getAllFacts()
    .filter((f) => f.category === X_INTEGRATION_CATEGORY && f.subject === X_HANDLE_SUBJECT)
    .map((f) => ({ scope: f.scope, handle: f.content.trim() }))
    .filter((r) => r.handle.length > 0);
}

/**
 * Rebuild the SessionContext a scope key implies, so the background sweep
 * (which has no real chat session) can still gate MCP-server enablement the
 * same way a live session would (resolveSessionMcpServers needs a
 * SessionContext, not a bare scope string). For a project scope, resolves
 * the owning client via memory.getProject so the full gating chain
 * (project -> client -> world) still applies — a client-scope-disabled MCP
 * server must stay disabled for that client's projects too.
 */
export function sessionContextForScope(memory: MemoryManager, scope: string): SessionContext {
  if (scope === USER_SCOPE) return { contextType: 'personal', clientId: null, projectKey: null };
  if (scope.startsWith('client:')) {
    return { contextType: 'client', clientId: scope.slice('client:'.length), projectKey: null };
  }
  if (scope.startsWith('project:')) {
    const projectKey = scope.slice('project:'.length);
    const project = memory.getProject(projectKey);
    return { contextType: 'project', clientId: project?.client_id ?? null, projectKey };
  }
  // WORLD_SCOPE and any unrecognized scope both degrade to world — the
  // safest superset that still excludes personal (mirrors resolveVisibleScopes's
  // own "malformed selections degrade to the safest superset" convention).
  return { contextType: 'world', clientId: null, projectKey: null };
}

/** Tool-name heuristic for a bridged MCP tool that plausibly returns X/Twitter post analytics (read), not a posting/write action. */
const X_ANALYTICS_TOOL_NAME_RE =
  /analytics|metrics|insights|stats|(get|list|search|fetch).*(tweet|post)/i;

/**
 * Whether `toolName` looks like it belongs to the given channel. Plain
 * substring matching (content-tools.ts's findMcpPostingTool approach) is
 * fine for long, specific channel words like "twitter" or "linkedin", but
 * breaks for a one-letter channel like "x" — "context" and "text" both
 * contain "x". Short channels (<4 chars) instead require a token boundary
 * (`_x_`, `mcp_x_...`, `..._x`) so "x-api"/"x_api" matches but "context"
 * doesn't.
 */
export function channelTokenMatches(toolName: string, channel: string): boolean {
  const norm = channel.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return false;
  const name = toolName.toLowerCase();
  if (norm.length >= 4) return name.includes(norm);
  const boundary = new RegExp(`(^|[^a-z0-9])${norm}([^a-z0-9]|$)`, 'i');
  return boundary.test(name);
}

/**
 * Find a bridged MCP tool that looks like a read/analytics action for X or
 * Twitter. Checks both channel aliases ("twitter" and "x") since marketplace
 * catalog entries and third-party MCP servers use either name inconsistently
 * (e.g. entry id "x-api" vs. tool names mentioning "twitter").
 */
export async function findXAnalyticsMcpTool(sessionContext: SessionContext, sessionId: string) {
  const tools = await getMcpBridgedTools(sessionContext, sessionId);
  return (
    tools.find(
      (t) =>
        (channelTokenMatches(t.name, 'twitter') || channelTokenMatches(t.name, 'x')) &&
        X_ANALYTICS_TOOL_NAME_RE.test(t.name)
    ) ?? null
  );
}

export interface XSyncResult {
  ok: boolean;
  postsWritten: number;
  error?: string;
}

/**
 * Fetch and record analytics for one scope's configured X handle. Never
 * throws — a missing/misconfigured MCP tool, an MCP-level error response, or
 * an unexpected exception all come back as `{ ok: false, error }` so callers
 * (IPC handler, background sweep) can surface it without crashing anything —
 * same contract as syncLinkedInAnalyticsForScope.
 */
export async function syncXAnalyticsForScope(
  memory: MemoryManager,
  scope: string,
  handle: string,
  sessionContext: SessionContext,
  sessionId: string = X_SYNC_SESSION_ID
): Promise<XSyncResult> {
  try {
    const tool = await findXAnalyticsMcpTool(sessionContext, sessionId);
    if (!tool) {
      return {
        ok: false,
        postsWritten: 0,
        error:
          'No bridged MCP analytics tool found for X/Twitter. Enable and configure an X-capable ' +
          'marketplace MCP server (e.g. x-api, x-api-bearer, twitter-community) for this workspace.',
      };
    }

    const raw = await tool.execute(
      {
        username: handle,
        handle,
        user: handle,
        query: `from:${handle}`,
        max_results: 50,
        count: 50,
      },
      { signal: new AbortController().signal, toolCallId: `x-analytics-sync-${scope}` }
    );
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (text.startsWith('Error:')) {
      return { ok: false, postsWritten: 0, error: text.slice('Error:'.length).trim() || text };
    }

    const posts = parseXAnalyticsToolResponse(text);
    let written = 0;
    for (const post of posts) {
      // capturedAt is intentionally omitted (defaults to now) — same
      // "records the CURRENT stats at sync time" convention as LinkedIn.
      memory.recordPostAnalytics({
        scope,
        channel: X_CHANNEL,
        externalRef: post.externalRef,
        title: post.text.slice(0, 140),
        impressions: post.impressions,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        clicks: post.clicks,
        videoViews: post.videoViews,
        postUrl: post.url,
        source: 'mcp',
      });
      written += 1;
    }
    return { ok: true, postsWritten: written };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown X/Twitter sync error';
    return { ok: false, postsWritten: 0, error: message };
  }
}

/**
 * Sync every scope in the store that has an X handle configured. Used by the
 * periodic background refresh (main/index.ts) — each scope's failure is
 * independent so one bad handle/tool never blocks the others.
 */
export async function autoSyncAllConfiguredXScopes(
  memory: MemoryManager
): Promise<Array<{ scope: string; result: XSyncResult }>> {
  const configured = allConfiguredXScopes(memory);
  const results: Array<{ scope: string; result: XSyncResult }> = [];
  for (const { scope, handle } of configured) {
    const sessionContext = sessionContextForScope(memory, scope);
    const result = await syncXAnalyticsForScope(memory, scope, handle, sessionContext);
    results.push({ scope, result });
  }
  return results;
}
