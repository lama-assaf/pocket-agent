/**
 * Scoped-memory resolution: turn a session's *selected context* (chosen in the
 * UI, stored on the session) into the ordered list of memory scopes that are
 * visible for that context, plus the single scope new writes target.
 *
 * This is the load-bearing rule for "personal vs shared": the `user` (personal)
 * scope is visible ONLY in the personal context, and shared contexts never see
 * it — isolation by construction. Nothing here reads the filesystem; the scope
 * is purely a function of the selection.
 */

import type { SessionContext } from './sessions';

/** Operator's private memory (name, people, prefs). Never synced to any repo. */
export const USER_SCOPE = 'user';

/** Agency-wide shared knowledge, base of every brand. */
export const WORLD_SCOPE = 'world';

/** Scope key for one brand's memory. */
export function clientScope(clientId: string): string {
  return `client:${clientId}`;
}

/** Scope key for one project's memory (projectKey is a stable id, not a path). */
export function projectScope(projectKey: string): string {
  return `project:${projectKey}`;
}

/** Scope key for one conversation's memory. */
export function chatScope(sessionId: string): string {
  return `chat:${sessionId}`;
}

/**
 * Resolve the ordered scopes visible for a session's selected context, nearest
 * (most specific) first so callers can boost local memory on ties:
 *
 *   personal → [chat:S, user]
 *   world    → [chat:S, world]
 *   client   → [chat:S, client:C, world]
 *   project  → [chat:S, project:P, client:C, world]
 *
 * `user` appears only in the personal context; shared contexts never include it.
 * Malformed selections (e.g. a client context with no clientId) degrade to the
 * safest superset that still excludes personal.
 */
export function resolveVisibleScopes(context: SessionContext, sessionId: string): string[] {
  const chat = chatScope(sessionId);
  switch (context.contextType) {
    case 'world':
      return [chat, WORLD_SCOPE];
    case 'client':
      return context.clientId
        ? [chat, clientScope(context.clientId), WORLD_SCOPE]
        : [chat, WORLD_SCOPE];
    case 'project': {
      const scopes = [chat];
      if (context.projectKey) scopes.push(projectScope(context.projectKey));
      if (context.clientId) scopes.push(clientScope(context.clientId));
      scopes.push(WORLD_SCOPE);
      return scopes;
    }
    case 'personal':
    default:
      return [chat, USER_SCOPE];
  }
}

/**
 * The scope a new fact/lesson defaults to for the selected context — the chosen
 * *space*, not the conversation. A lesson saved while a Client is active lives
 * at that brand (shareable), not only in the current chat.
 *
 *   personal → user
 *   world    → world
 *   client   → client:C   (falls back to world if clientId missing)
 *   project  → project:P  (falls back to client:C, then world)
 */
export function resolveNearestScope(context: SessionContext): string {
  switch (context.contextType) {
    case 'world':
      return WORLD_SCOPE;
    case 'client':
      return context.clientId ? clientScope(context.clientId) : WORLD_SCOPE;
    case 'project':
      if (context.projectKey) return projectScope(context.projectKey);
      if (context.clientId) return clientScope(context.clientId);
      return WORLD_SCOPE;
    case 'personal':
    default:
      return USER_SCOPE;
  }
}

/**
 * The next broader scope up the ladder for promotion (chat → project → client →
 * world), derived from the session's ordered visibleScopes (nearest → base).
 * Returns null when already at the broadest visible scope or the scope isn't in
 * the chain. Personal (`user`) has no broader scope — it never promotes.
 */
export function nextBroaderScope(visibleScopes: string[], currentScope: string): string | null {
  if (currentScope === USER_SCOPE) return null;
  const idx = visibleScopes.indexOf(currentScope);
  if (idx === -1) return null;
  for (let i = idx + 1; i < visibleScopes.length; i++) {
    const next = visibleScopes[i];
    if (next && next !== USER_SCOPE) return next;
  }
  return null;
}

/**
 * Specificity rank for a scope key — higher wins ties during recall so nearer
 * memory (chat > project > client > world > user) surfaces first.
 */
export function scopeSpecificity(scope: string): number {
  if (scope.startsWith('chat:')) return 5;
  if (scope.startsWith('project:')) return 4;
  if (scope.startsWith('client:')) return 3;
  if (scope === WORLD_SCOPE) return 2;
  return 1; // user / unknown
}
