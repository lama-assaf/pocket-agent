/**
 * LinkedIn analytics sync orchestration: per-scope org-URN storage (as a
 * scoped fact, isolated like every other brand-specific config in this app),
 * and the fetch-then-record pipeline against a stubbed client layer — no
 * real HTTP. Graceful degradation (missing token, API error, empty org) is
 * covered explicitly since that's the task's core "no crashes" requirement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../../src/integrations/linkedin/client';
import { LinkedInApiError } from '../../src/integrations/linkedin/client';
import {
  getLinkedInOrgUrnForScope,
  setLinkedInOrgUrnForScope,
  allConfiguredLinkedInScopes,
  syncLinkedInAnalyticsForScope,
  autoSyncAllConfiguredLinkedInScopes,
  LINKEDIN_INTEGRATION_CATEGORY,
  LINKEDIN_ORG_URN_SUBJECT,
  LINKEDIN_CHANNEL,
} from '../../src/integrations/linkedin/sync';

interface FakeFact {
  category: string;
  subject: string;
  content: string;
  scope: string;
}

class FakeMemory {
  facts: FakeFact[] = [];
  recorded: Array<Record<string, unknown>> = [];

  getAllFacts(): FakeFact[] {
    return this.facts;
  }

  saveFact(category: string, subject: string, content: string, _sensitive?: boolean, scope = 'user'): number {
    // Mirror the real upsert-by-(scope,category,subject) semantics used elsewhere.
    const existing = this.facts.find((f) => f.scope === scope && f.category === category && f.subject === subject);
    if (existing) {
      existing.content = content;
    } else {
      this.facts.push({ category, subject, content, scope });
    }
    return this.facts.length;
  }

  recordPostAnalytics(input: Record<string, unknown>): number {
    this.recorded.push(input);
    return this.recorded.length;
  }
}

describe('LinkedIn org-URN per-scope storage', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
  });

  it('returns null when no org URN is configured for a scope', () => {
    expect(getLinkedInOrgUrnForScope(memory as never, 'client:zilliqa')).toBeNull();
  });

  it('stores and retrieves an org URN scoped to one client, isolated from another', () => {
    setLinkedInOrgUrnForScope(memory as never, 'client:zilliqa', 'urn:li:organization:111');
    setLinkedInOrgUrnForScope(memory as never, 'client:ltin', 'urn:li:organization:222');

    expect(getLinkedInOrgUrnForScope(memory as never, 'client:zilliqa')).toBe('urn:li:organization:111');
    expect(getLinkedInOrgUrnForScope(memory as never, 'client:ltin')).toBe('urn:li:organization:222');
  });

  it('treats an empty string as unset (clears the org URN)', () => {
    setLinkedInOrgUrnForScope(memory as never, 'client:zilliqa', 'urn:li:organization:111');
    setLinkedInOrgUrnForScope(memory as never, 'client:zilliqa', '');
    expect(getLinkedInOrgUrnForScope(memory as never, 'client:zilliqa')).toBeNull();
  });

  it('writes to the shared integration category/subject so export/sync tooling can find it uniformly', () => {
    setLinkedInOrgUrnForScope(memory as never, 'client:zilliqa', 'urn:li:organization:111');
    expect(memory.facts).toEqual([
      { category: LINKEDIN_INTEGRATION_CATEGORY, subject: LINKEDIN_ORG_URN_SUBJECT, content: 'urn:li:organization:111', scope: 'client:zilliqa' },
    ]);
  });

  it('allConfiguredLinkedInScopes lists every scope with a non-empty org URN', () => {
    setLinkedInOrgUrnForScope(memory as never, 'client:zilliqa', 'urn:li:organization:111');
    setLinkedInOrgUrnForScope(memory as never, 'client:ltin', '');
    expect(allConfiguredLinkedInScopes(memory as never)).toEqual([
      { scope: 'client:zilliqa', orgUrn: 'urn:li:organization:111' },
    ]);
  });
});

describe('syncLinkedInAnalyticsForScope', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
    vi.restoreAllMocks();
  });

  it('fetches posts + stats and records one analytics row per matched post', async () => {
    vi.spyOn(client, 'fetchOrganizationPosts').mockResolvedValue([
      { urn: 'urn:li:share:1', createdAtMs: 1, commentary: 'First post' },
      { urn: 'urn:li:share:2', createdAtMs: 2, commentary: 'Second post' },
    ]);
    vi.spyOn(client, 'fetchShareStatistics').mockResolvedValue([
      { shareUrn: 'urn:li:share:1', impressions: 100, clicks: 5, likes: 10, comments: 1, shares: 0 },
      { shareUrn: 'urn:li:share:2', impressions: 200, clicks: 8, likes: 20, comments: 2, shares: 1 },
    ]);

    const result = await syncLinkedInAnalyticsForScope(
      memory as never,
      'client:zilliqa',
      'urn:li:organization:1',
      'tok-abc'
    );

    expect(result).toEqual({ ok: true, postsWritten: 2 });
    expect(memory.recorded).toHaveLength(2);
    expect(memory.recorded[0]).toMatchObject({
      scope: 'client:zilliqa',
      channel: LINKEDIN_CHANNEL,
      externalRef: 'urn:li:share:1',
      title: 'First post',
      impressions: 100,
      likes: 10,
      comments: 1,
      shares: 0,
      clicks: 5,
      videoViews: 0,
      source: 'mcp',
    });
  });

  it('skips posts with no matching stats rather than fabricating zeros', async () => {
    vi.spyOn(client, 'fetchOrganizationPosts').mockResolvedValue([
      { urn: 'urn:li:share:1', createdAtMs: 1, commentary: 'Has stats' },
      { urn: 'urn:li:share:2', createdAtMs: 2, commentary: 'No stats yet' },
    ]);
    vi.spyOn(client, 'fetchShareStatistics').mockResolvedValue([
      { shareUrn: 'urn:li:share:1', impressions: 100, clicks: 0, likes: 0, comments: 0, shares: 0 },
    ]);

    const result = await syncLinkedInAnalyticsForScope(memory as never, 'client:zilliqa', 'urn:li:organization:1', 'tok');
    expect(result.postsWritten).toBe(1);
    expect(memory.recorded).toHaveLength(1);
    expect(memory.recorded[0].externalRef).toBe('urn:li:share:1');
  });

  it('returns ok:true with 0 written when the org has no posts (never an error)', async () => {
    vi.spyOn(client, 'fetchOrganizationPosts').mockResolvedValue([]);
    const fetchStatsSpy = vi.spyOn(client, 'fetchShareStatistics');

    const result = await syncLinkedInAnalyticsForScope(memory as never, 'client:zilliqa', 'urn:li:organization:1', 'tok');
    expect(result).toEqual({ ok: true, postsWritten: 0 });
    expect(fetchStatsSpy).not.toHaveBeenCalled(); // no point calling stats for zero posts
  });

  it('degrades to a clear, actionable error on 401/403 (expired/invalid token), never throws', async () => {
    vi.spyOn(client, 'fetchOrganizationPosts').mockRejectedValue(
      new LinkedInApiError('Unauthorized', 401)
    );

    const result = await syncLinkedInAnalyticsForScope(memory as never, 'client:zilliqa', 'urn:li:organization:1', 'expired-tok');
    expect(result.ok).toBe(false);
    expect(result.postsWritten).toBe(0);
    expect(result.error).toMatch(/reconnect linkedin/i);
  });

  it('degrades to the raw message on other API errors, never throws', async () => {
    vi.spyOn(client, 'fetchOrganizationPosts').mockRejectedValue(
      new LinkedInApiError('Rate limited', 429)
    );

    const result = await syncLinkedInAnalyticsForScope(memory as never, 'client:zilliqa', 'urn:li:organization:1', 'tok');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limited/i);
  });

  it('degrades gracefully on an unexpected non-API error (network failure etc.), never throws', async () => {
    vi.spyOn(client, 'fetchOrganizationPosts').mockRejectedValue(new Error('fetch failed: ECONNRESET'));

    const result = await syncLinkedInAnalyticsForScope(memory as never, 'client:zilliqa', 'urn:li:organization:1', 'tok');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/econnreset/i);
    expect(memory.recorded).toHaveLength(0);
  });
});

describe('autoSyncAllConfiguredLinkedInScopes', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
    vi.restoreAllMocks();
  });

  it('is a silent no-op when no scope has an org URN configured', async () => {
    const fetchPostsSpy = vi.spyOn(client, 'fetchOrganizationPosts');
    const results = await autoSyncAllConfiguredLinkedInScopes(memory as never, 'tok');
    expect(results).toEqual([]);
    expect(fetchPostsSpy).not.toHaveBeenCalled();
  });

  it('syncs every configured scope independently — one scope failing never blocks another', async () => {
    setLinkedInOrgUrnForScope(memory as never, 'client:zilliqa', 'urn:li:organization:1');
    setLinkedInOrgUrnForScope(memory as never, 'client:ltin', 'urn:li:organization:2');

    vi.spyOn(client, 'fetchOrganizationPosts').mockImplementation(async (orgUrn: string) => {
      if (orgUrn === 'urn:li:organization:1') throw new LinkedInApiError('Unauthorized', 401);
      return [{ urn: 'urn:li:share:9', createdAtMs: 1, commentary: 'ok' }];
    });
    vi.spyOn(client, 'fetchShareStatistics').mockResolvedValue([
      { shareUrn: 'urn:li:share:9', impressions: 50, clicks: 0, likes: 5, comments: 0, shares: 0 },
    ]);

    const results = await autoSyncAllConfiguredLinkedInScopes(memory as never, 'tok');
    expect(results).toHaveLength(2);
    const zilliqaResult = results.find((r) => r.scope === 'client:zilliqa')!;
    const ltinResult = results.find((r) => r.scope === 'client:ltin')!;
    expect(zilliqaResult.result.ok).toBe(false);
    expect(ltinResult.result.ok).toBe(true);
    expect(ltinResult.result.postsWritten).toBe(1);
  });
});
