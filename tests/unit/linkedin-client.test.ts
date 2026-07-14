/**
 * LinkedIn Community Management API client: pure response parsing
 * (parsePostsResponse/parseShareStatisticsResponse) and the network calls
 * with an injected fetch stub — no real HTTP, no MCP, matches the
 * task's "mock HTTP" requirement without a network-mock library.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  linkedinVersionHeader,
  parsePostsResponse,
  parseShareStatisticsResponse,
  fetchOrganizationPosts,
  fetchShareStatistics,
  LinkedInApiError,
} from '../../src/integrations/linkedin/client';

describe('linkedinVersionHeader', () => {
  it('formats a date as YYYYMM', () => {
    expect(linkedinVersionHeader(new Date('2026-07-14T00:00:00Z'))).toBe('202607');
  });

  it('zero-pads single-digit months', () => {
    expect(linkedinVersionHeader(new Date('2026-03-01T00:00:00Z'))).toBe('202603');
  });
});

describe('parsePostsResponse', () => {
  it('extracts urn, createdAt, and commentary text from LinkedIn\u2019s documented shape', () => {
    const json = {
      elements: [
        { id: 'urn:li:share:111', createdAt: 1700000000000, commentary: { text: 'Hello world' } },
        { id: 'urn:li:share:222', createdAt: 1700000001000, commentary: 'Plain string commentary' },
      ],
    };
    const posts = parsePostsResponse(json);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({ urn: 'urn:li:share:111', createdAtMs: 1700000000000, commentary: 'Hello world' });
    expect(posts[1].commentary).toBe('Plain string commentary');
  });

  it('degrades to empty commentary/null createdAt rather than throwing on a malformed element', () => {
    const posts = parsePostsResponse({ elements: [{ id: 'urn:li:share:333' }] });
    expect(posts).toEqual([{ urn: 'urn:li:share:333', createdAtMs: null, commentary: '' }]);
  });

  it('filters out elements with no id at all', () => {
    const posts = parsePostsResponse({ elements: [{ createdAt: 123 }, { id: 'urn:li:share:444' }] });
    expect(posts.map((p) => p.urn)).toEqual(['urn:li:share:444']);
  });

  it('returns [] for a missing/malformed elements array', () => {
    expect(parsePostsResponse({})).toEqual([]);
    expect(parsePostsResponse({ elements: 'not-an-array' })).toEqual([]);
  });
});

describe('parseShareStatisticsResponse', () => {
  it('extracts per-post stats keyed by share URN', () => {
    const json = {
      elements: [
        {
          organizationalEntity: 'urn:li:organization:1',
          share: 'urn:li:share:111',
          totalShareStatistics: {
            impressionCount: 5287,
            clickCount: 78,
            likeCount: 14,
            commentCount: 24,
            shareCount: 5,
          },
        },
      ],
    };
    const stats = parseShareStatisticsResponse(json);
    expect(stats).toEqual([
      { shareUrn: 'urn:li:share:111', impressions: 5287, clicks: 78, likes: 14, comments: 24, shares: 5 },
    ]);
  });

  it('skips whole-org aggregate elements that carry no `share` field', () => {
    const json = {
      elements: [
        { organizationalEntity: 'urn:li:organization:1', totalShareStatistics: { impressionCount: 331 } },
      ],
    };
    expect(parseShareStatisticsResponse(json)).toEqual([]);
  });

  it('defaults every missing numeric field to 0 rather than throwing', () => {
    const json = { elements: [{ share: 'urn:li:share:1', totalShareStatistics: {} }] };
    expect(parseShareStatisticsResponse(json)).toEqual([
      { shareUrn: 'urn:li:share:1', impressions: 0, clicks: 0, likes: 0, comments: 0, shares: 0 },
    ]);
  });

  it('returns [] for a missing/malformed elements array', () => {
    expect(parseShareStatisticsResponse({})).toEqual([]);
  });
});

describe('fetchOrganizationPosts (injected fetch)', () => {
  it('sends the required headers and parses the response', async () => {
    const fetchStub = vi.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [{ id: 'urn:li:share:1', createdAt: 1, commentary: 'hi' }] }),
    })) as unknown as typeof fetch;

    const posts = await fetchOrganizationPosts('urn:li:organization:1', 'tok-abc', 50, fetchStub);
    expect(posts).toHaveLength(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, options] = (fetchStub as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('urn%3Ali%3Aorganization%3A1');
    expect(options.headers.Authorization).toBe('Bearer tok-abc');
    expect(options.headers['Linkedin-Version']).toMatch(/^\d{6}$/);
    expect(options.headers['X-Restli-Protocol-Version']).toBe('2.0.0');
  });

  it('throws a LinkedInApiError with the HTTP status on a non-ok response', async () => {
    const fetchStub = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })) as unknown as typeof fetch;

    await expect(fetchOrganizationPosts('urn:li:organization:1', 'bad-tok', 50, fetchStub)).rejects.toThrow(
      LinkedInApiError
    );
  });

  it('surfaces the response status on the thrown error for 401/403 handling upstream', async () => {
    const fetchStub = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    })) as unknown as typeof fetch;

    try {
      await fetchOrganizationPosts('urn:li:organization:1', 'bad-tok', 50, fetchStub);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LinkedInApiError);
      expect((e as LinkedInApiError).status).toBe(403);
    }
  });
});

describe('fetchShareStatistics (injected fetch)', () => {
  it('returns [] without calling fetch when there are no post URNs', async () => {
    const fetchStub = vi.fn();
    const stats = await fetchShareStatistics('urn:li:organization:1', [], 'tok', fetchStub as unknown as typeof fetch);
    expect(stats).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('batches multiple post URNs into one request and parses the stats', async () => {
    const fetchStub = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          { share: 'urn:li:share:1', totalShareStatistics: { impressionCount: 100, likeCount: 10, commentCount: 0, shareCount: 0, clickCount: 0 } },
          { share: 'urn:li:share:2', totalShareStatistics: { impressionCount: 200, likeCount: 20, commentCount: 0, shareCount: 0, clickCount: 0 } },
        ],
      }),
    })) as unknown as typeof fetch;

    const stats = await fetchShareStatistics(
      'urn:li:organization:1',
      ['urn:li:share:1', 'urn:li:share:2'],
      'tok',
      fetchStub
    );
    expect(stats).toHaveLength(2);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url] = (fetchStub as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('shares=List(');
  });
});
