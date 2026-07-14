/**
 * LinkedIn analytics sync orchestration: resolves which org a scope tracks,
 * fetches that org's post + share-statistics from the LinkedIn API, and
 * writes them into the shared post_analytics store (source: 'mcp' — see
 * note below) exactly like a manual entry would, just automated.
 *
 * The org URN a scope tracks is stored as a scoped FACT (category
 * 'integration', subject 'linkedin_org_urn') rather than a global Setting,
 * because it must isolate per client (zilliqa's org URN must never bleed
 * into ltin's), matching every other piece of brand-specific config in this
 * app (facts.scope). The LinkedIn app-level OAuth connection (client
 * id/secret/tokens) stays a single global Setting — one Developer app,
 * authorized once by whichever member administers these org pages.
 */

import type { MemoryManager } from '../../memory/index';
import { fetchOrganizationPosts, fetchShareStatistics, LinkedInApiError } from './client';

export const LINKEDIN_INTEGRATION_CATEGORY = 'integration';
export const LINKEDIN_ORG_URN_SUBJECT = 'linkedin_org_urn';
export const LINKEDIN_CHANNEL = 'linkedin';

/** The org URN this scope is configured to sync, or null if unset (empty content counts as unset). */
export function getLinkedInOrgUrnForScope(memory: MemoryManager, scope: string): string | null {
  const fact = memory
    .getAllFacts()
    .find(
      (f) =>
        f.scope === scope && f.category === LINKEDIN_INTEGRATION_CATEGORY && f.subject === LINKEDIN_ORG_URN_SUBJECT
    );
  const urn = fact?.content?.trim();
  return urn ? urn : null;
}

/** Set (or clear, by passing '') the org URN a scope syncs against. */
export function setLinkedInOrgUrnForScope(memory: MemoryManager, scope: string, orgUrn: string): void {
  memory.saveFact(LINKEDIN_INTEGRATION_CATEGORY, LINKEDIN_ORG_URN_SUBJECT, orgUrn.trim(), false, scope);
}

/** Every (scope, orgUrn) pair configured anywhere in the store, for the auto-sync sweep. */
export function allConfiguredLinkedInScopes(memory: MemoryManager): Array<{ scope: string; orgUrn: string }> {
  return memory
    .getAllFacts()
    .filter((f) => f.category === LINKEDIN_INTEGRATION_CATEGORY && f.subject === LINKEDIN_ORG_URN_SUBJECT)
    .map((f) => ({ scope: f.scope, orgUrn: f.content.trim() }))
    .filter((r) => r.orgUrn.length > 0);
}

export interface LinkedInSyncResult {
  ok: boolean;
  postsWritten: number;
  error?: string;
}

/**
 * Fetch and record analytics for one scope's configured org. Never throws —
 * an API failure (missing/expired token, bad org URN, rate limit, network
 * error) is returned as `{ ok: false, error }` so callers (IPC handler,
 * background sweep) can surface it without crashing anything.
 */
export async function syncLinkedInAnalyticsForScope(
  memory: MemoryManager,
  scope: string,
  orgUrn: string,
  accessToken: string
): Promise<LinkedInSyncResult> {
  try {
    const posts = await fetchOrganizationPosts(orgUrn, accessToken);
    if (posts.length === 0) return { ok: true, postsWritten: 0 };

    const stats = await fetchShareStatistics(
      orgUrn,
      posts.map((p) => p.urn),
      accessToken
    );
    const statsByUrn = new Map(stats.map((s) => [s.shareUrn, s]));

    let written = 0;
    for (const post of posts) {
      const stat = statsByUrn.get(post.urn);
      if (!stat) continue; // no stats returned for this post (too new, or excluded by LinkedIn) — skip, don't fabricate zeros
      // capturedAt is intentionally omitted (defaults to now) — this snapshot
      // records the CURRENT stats at sync time, not the post's original
      // publish time (post.createdAtMs), matching every other ingestion path.
      memory.recordPostAnalytics({
        scope,
        channel: LINKEDIN_CHANNEL,
        externalRef: post.urn,
        title: post.commentary.slice(0, 140),
        impressions: stat.impressions,
        likes: stat.likes,
        comments: stat.comments,
        shares: stat.shares,
        clicks: stat.clicks,
        videoViews: 0, // not exposed by this LinkedIn endpoint
        source: 'mcp', // "not manually typed" — see post_analytics's source doc comment
      });
      written += 1;
    }
    return { ok: true, postsWritten: written };
  } catch (error) {
    const message =
      error instanceof LinkedInApiError
        ? error.status === 401 || error.status === 403
          ? 'LinkedIn access token is missing, expired, or lacks org-admin access — reconnect LinkedIn in Settings.'
          : error.message
        : error instanceof Error
          ? error.message
          : 'Unknown LinkedIn sync error';
    return { ok: false, postsWritten: 0, error: message };
  }
}

/**
 * Sync every scope in the store that has an org URN configured. Used by the
 * periodic background refresh (main/index.ts) — each scope's failure is
 * independent so one bad token/org never blocks the others.
 */
export async function autoSyncAllConfiguredLinkedInScopes(
  memory: MemoryManager,
  accessToken: string
): Promise<Array<{ scope: string; result: LinkedInSyncResult }>> {
  const configured = allConfiguredLinkedInScopes(memory);
  const results: Array<{ scope: string; result: LinkedInSyncResult }> = [];
  for (const { scope, orgUrn } of configured) {
    const result = await syncLinkedInAnalyticsForScope(memory, scope, orgUrn, accessToken);
    results.push({ scope, result });
  }
  return results;
}
