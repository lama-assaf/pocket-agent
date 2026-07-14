/**
 * Post analytics data model: scope isolation, append-only snapshot behavior,
 * "latest per post" resolution, and the pure aggregate/engagement-rate math.
 * Same pattern as content-drafts.test.ts — real in-memory MemoryManager for
 * the DB-layer tests, hand-built rows for the pure summarizeAnalytics tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeEngagementRate, summarizeAnalytics, type PostAnalytics } from '../../src/memory/analytics';
import { clientScope, resolveVisibleScopes } from '../../src/memory/scope';

// Stub only the async embedding writes so MemoryManager needs no embedding model.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

// ── Pure math ───────────────────────────────────────────────────────────────
describe('computeEngagementRate', () => {
  it('computes (likes + comments + shares) / impressions', () => {
    const rate = computeEngagementRate({ impressions: 1000, likes: 40, comments: 8, shares: 2 });
    expect(rate).toBeCloseTo(0.05);
  });

  it('returns 0 when impressions is 0, never divides by zero', () => {
    expect(computeEngagementRate({ impressions: 0, likes: 5, comments: 1, shares: 1 })).toBe(0);
  });

  it('excludes clicks from the engagement calculation', () => {
    const withClicks = computeEngagementRate({ impressions: 100, likes: 10, comments: 0, shares: 0 });
    // clicks isn't even a param — this just documents the formula doesn't touch it
    expect(withClicks).toBeCloseTo(0.1);
  });
});

function row(over: Partial<PostAnalytics>): PostAnalytics {
  return {
    id: 1,
    scope: 'client:acme',
    channel: 'twitter',
    external_ref: 'post-1',
    content_post_id: null,
    title: '',
    impressions: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    clicks: 0,
    video_views: 0,
    source: 'manual',
    raw_json: null,
    captured_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('summarizeAnalytics', () => {
  it('sums totals across all rows', () => {
    const summary = summarizeAnalytics([
      row({ impressions: 1000, likes: 10, comments: 2, shares: 1, clicks: 5, video_views: 100 }),
      row({ impressions: 2000, likes: 20, comments: 4, shares: 2, clicks: 10, video_views: 200 }),
    ]);
    expect(summary.totalPosts).toBe(2);
    expect(summary.impressions).toBe(3000);
    expect(summary.likes).toBe(30);
    expect(summary.comments).toBe(6);
    expect(summary.shares).toBe(3);
    expect(summary.clicks).toBe(15);
    expect(summary.videoViews).toBe(300);
  });

  it('computes overall engagement rate from totals, not an average of rates', () => {
    // Row A: 100 impressions, 50 engagements (50% rate). Row B: 10000 impressions, 100 engagements (1% rate).
    // A naive average-of-rates would give 25.5%; the correct pooled rate is (50+100)/(100+10000).
    const summary = summarizeAnalytics([
      row({ impressions: 100, likes: 50 }),
      row({ impressions: 10000, likes: 100 }),
    ]);
    expect(summary.engagementRate).toBeCloseTo(150 / 10100);
  });

  it('breaks totals down by channel', () => {
    const summary = summarizeAnalytics([
      row({ channel: 'twitter', impressions: 1000, likes: 10 }),
      row({ channel: 'linkedin', impressions: 500, likes: 25 }),
    ]);
    expect(summary.byChannel.twitter.posts).toBe(1);
    expect(summary.byChannel.twitter.impressions).toBe(1000);
    expect(summary.byChannel.linkedin.posts).toBe(1);
    expect(summary.byChannel.linkedin.engagementRate).toBeCloseTo(0.05);
  });

  it('ranks topPosts by engagement rate, not raw counts', () => {
    const summary = summarizeAnalytics([
      row({ external_ref: 'big-raw', impressions: 100000, likes: 500 }), // 0.5% rate, huge raw count
      row({ external_ref: 'small-rate', impressions: 100, likes: 20 }), // 20% rate, tiny raw count
    ]);
    expect(summary.topPosts[0].external_ref).toBe('small-rate');
  });

  it('respects minImpressionsForRanking so noisy low-impression posts never top the list', () => {
    const summary = summarizeAnalytics(
      [
        row({ external_ref: 'noisy', impressions: 2, likes: 2 }), // 100% rate but meaningless sample
        row({ external_ref: 'real', impressions: 5000, likes: 250 }), // 5% rate, real sample
      ],
      { minImpressionsForRanking: 100 }
    );
    expect(summary.topPosts.map((p) => p.external_ref)).toEqual(['real']);
  });

  it('caps topPosts at topN', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ external_ref: `p${i}`, impressions: 100, likes: i }));
    const summary = summarizeAnalytics(rows, { topN: 3 });
    expect(summary.topPosts).toHaveLength(3);
  });

  it('handles an empty input without dividing by zero anywhere', () => {
    const summary = summarizeAnalytics([]);
    expect(summary.totalPosts).toBe(0);
    expect(summary.engagementRate).toBe(0);
    expect(summary.byChannel).toEqual({});
    expect(summary.topPosts).toEqual([]);
  });
});

// ── MemoryManager-level: append-only + scope isolation + latest-per-post ───
describe('MemoryManager post analytics — append-only + latest-per-post resolution', () => {
  let memory: import('../../src/memory/index').MemoryManager;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
  });

  it('recording a second snapshot for the same post does not overwrite the first', () => {
    memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 100 });
    memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 200 });

    const visible = resolveVisibleScopes({ contextType: 'personal', clientId: null, projectKey: null }, 'S');
    const full = memory.getPostAnalyticsForScopes(visible);
    expect(full).toHaveLength(2); // both snapshots kept — append-only
  });

  it('getLatestPostAnalyticsForScopes returns one row per post: the newest snapshot', () => {
    memory.recordPostAnalytics({
      scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 100,
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    memory.recordPostAnalytics({
      scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 500,
      capturedAt: '2026-01-02T00:00:00.000Z',
    });
    memory.recordPostAnalytics({
      scope: 'user', channel: 'twitter', externalRef: 'post-2', impressions: 50,
      capturedAt: '2026-01-01T00:00:00.000Z',
    });

    const visible = resolveVisibleScopes({ contextType: 'personal', clientId: null, projectKey: null }, 'S');
    const latest = memory.getLatestPostAnalyticsForScopes(visible);
    expect(latest).toHaveLength(2); // one row per distinct post
    const post1 = latest.find((r) => r.external_ref === 'post-1')!;
    expect(post1.impressions).toBe(500); // the newer snapshot, not the first
  });

  it("brand A's analytics never appear in brand B's scope", () => {
    memory.recordPostAnalytics({ scope: clientScope('brandA'), channel: 'twitter', externalRef: 'a-post', impressions: 10 });
    memory.recordPostAnalytics({ scope: clientScope('brandB'), channel: 'twitter', externalRef: 'b-post', impressions: 20 });

    const visibleForA = resolveVisibleScopes({ contextType: 'client', clientId: 'brandA', projectKey: null }, 'S');
    const rowsForA = memory.getLatestPostAnalyticsForScopes(visibleForA);
    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0].external_ref).toBe('a-post');
  });

  it('personal context never sees any brand analytics', () => {
    memory.recordPostAnalytics({ scope: clientScope('brandA'), channel: 'twitter', externalRef: 'a-post', impressions: 10 });
    memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'personal-post', impressions: 5 });

    const visiblePersonal = resolveVisibleScopes({ contextType: 'personal', clientId: null, projectKey: null }, 'S');
    const rows = memory.getLatestPostAnalyticsForScopes(visiblePersonal);
    expect(rows.map((r) => r.external_ref)).toEqual(['personal-post']);
  });

  it('an empty visible-scope list returns nothing (never falls through unfiltered)', () => {
    memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'x', impressions: 1 });
    expect(memory.getLatestPostAnalyticsForScopes([])).toEqual([]);
    expect(memory.getPostAnalyticsForScopes([])).toEqual([]);
  });

  it('a client sees its own analytics plus world (agency-wide) analytics, never another client', () => {
    memory.recordPostAnalytics({ scope: 'world', channel: 'blog', externalRef: 'agency-post', impressions: 1 });
    memory.recordPostAnalytics({ scope: clientScope('brandA'), channel: 'blog', externalRef: 'a-post', impressions: 1 });
    memory.recordPostAnalytics({ scope: clientScope('brandB'), channel: 'blog', externalRef: 'b-post', impressions: 1 });

    const visibleForA = resolveVisibleScopes({ contextType: 'client', clientId: 'brandA', projectKey: null }, 'S');
    const refs = memory.getLatestPostAnalyticsForScopes(visibleForA).map((r) => r.external_ref);
    expect(refs).toContain('agency-post');
    expect(refs).toContain('a-post');
    expect(refs).not.toContain('b-post');
  });

  it('channel filter narrows both the full-history and latest-per-post queries', () => {
    memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 't-1', impressions: 1 });
    memory.recordPostAnalytics({ scope: 'user', channel: 'linkedin', externalRef: 'l-1', impressions: 1 });

    const visible = resolveVisibleScopes({ contextType: 'personal', clientId: null, projectKey: null }, 'S');
    const twitterOnly = memory.getLatestPostAnalyticsForScopes(visible, 'twitter');
    expect(twitterOnly.map((r) => r.channel)).toEqual(['twitter']);
  });

  it('getPostAnalyticsHistory returns every snapshot for one post, newest first', () => {
    memory.recordPostAnalytics({
      scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 100,
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    memory.recordPostAnalytics({
      scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 300,
      capturedAt: '2026-01-03T00:00:00.000Z',
    });

    const history = memory.getPostAnalyticsHistory('user', 'twitter', 'post-1');
    expect(history).toHaveLength(2);
    expect(history[0].impressions).toBe(300); // newest first
  });

  it('deletePostAnalytics removes exactly the targeted snapshot', () => {
    const id = memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'post-1', impressions: 1 });
    expect(memory.deletePostAnalytics(id)).toBe(true);
    const visible = resolveVisibleScopes({ contextType: 'personal', clientId: null, projectKey: null }, 'S');
    expect(memory.getPostAnalyticsForScopes(visible)).toEqual([]);
  });

  it('records default source "manual" when omitted, and honors an explicit "mcp" source', () => {
    const manualId = memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'p1', impressions: 1 });
    const mcpId = memory.recordPostAnalytics({ scope: 'user', channel: 'twitter', externalRef: 'p2', impressions: 1, source: 'mcp' });
    const visible = resolveVisibleScopes({ contextType: 'personal', clientId: null, projectKey: null }, 'S');
    const rows = memory.getPostAnalyticsForScopes(visible);
    expect(rows.find((r) => r.id === manualId)!.source).toBe('manual');
    expect(rows.find((r) => r.id === mcpId)!.source).toBe('mcp');
  });
});
