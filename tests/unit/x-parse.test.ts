/**
 * Pure parsing of a bridged X/Twitter MCP tool's free-text response into
 * normalized analytics rows — mirrors
 * tests/unit/linkedin-client.test.ts's split of "parse the response shape"
 * from "make the network call".
 */
import { describe, it, expect } from 'vitest';
import { parseXAnalyticsToolResponse } from '../../src/integrations/x/parse';

describe('parseXAnalyticsToolResponse', () => {
  it('parses the official X API v2 Tweet shape (data[] + public_metrics)', () => {
    const text = JSON.stringify({
      data: [
        {
          id: '111',
          text: 'Hello world',
          public_metrics: {
            impression_count: 100,
            like_count: 10,
            reply_count: 1,
            retweet_count: 2,
          },
        },
      ],
    });
    const posts = parseXAnalyticsToolResponse(text);
    expect(posts).toEqual([
      {
        externalRef: '111',
        text: 'Hello world',
        url: null,
        impressions: 100,
        likes: 10,
        comments: 1,
        shares: 2,
        clicks: 0,
        videoViews: 0,
      },
    ]);
  });

  it('prefers organic_metrics fields (url_link_clicks, video_view_count) when present', () => {
    const text = JSON.stringify({
      data: [
        {
          id: '111',
          text: 'Hello',
          public_metrics: { impression_count: 100, like_count: 10, reply_count: 0, retweet_count: 0 },
          organic_metrics: { url_link_clicks: 7, video_view_count: 42 },
        },
      ],
    });
    const [post] = parseXAnalyticsToolResponse(text);
    expect(post).toMatchObject({ clicks: 7, videoViews: 42 });
  });

  it('parses a top-level array (no wrapper object)', () => {
    const text = JSON.stringify([{ id: '1', text: 'a', likes: 3 }]);
    const posts = parseXAnalyticsToolResponse(text);
    expect(posts).toEqual([
      { externalRef: '1', text: 'a', url: null, impressions: 0, likes: 3, comments: 0, shares: 0, clicks: 0, videoViews: 0 },
    ]);
  });

  it('parses tweets/posts/results wrapper keys and flat metric names from community servers', () => {
    for (const key of ['tweets', 'posts', 'results']) {
      const text = JSON.stringify({
        [key]: [{ id: '1', full_text: 'flat', views: 50, favorites: 4, replies: 1, reposts: 2, clicks: 3 }],
      });
      const posts = parseXAnalyticsToolResponse(text);
      expect(posts).toEqual([
        { externalRef: '1', text: 'flat', url: null, impressions: 50, likes: 4, comments: 1, shares: 2, clicks: 3, videoViews: 0 },
      ]);
    }
  });

  it('captures the post URL when present under any known key', () => {
    const text = JSON.stringify({ data: [{ id: '1', text: 'x', url: 'https://x.com/user/status/1' }] });
    const [post] = parseXAnalyticsToolResponse(text);
    expect(post.url).toBe('https://x.com/user/status/1');
  });

  it('skips items with no recognizable id rather than fabricating one', () => {
    const text = JSON.stringify({ data: [{ text: 'no id here', likes: 5 }, { id: '2', text: 'has id' }] });
    const posts = parseXAnalyticsToolResponse(text);
    expect(posts).toHaveLength(1);
    expect(posts[0].externalRef).toBe('2');
  });

  it('returns an empty list (never throws) on non-JSON text', () => {
    expect(parseXAnalyticsToolResponse('not json at all')).toEqual([]);
  });

  it('returns an empty list when JSON parses but has no recognizable post array', () => {
    expect(parseXAnalyticsToolResponse(JSON.stringify({ status: 'ok' }))).toEqual([]);
  });

  it('degrades missing metric fields to 0 rather than throwing', () => {
    const text = JSON.stringify({ data: [{ id: '1', text: 'bare' }] });
    const [post] = parseXAnalyticsToolResponse(text);
    expect(post).toMatchObject({ impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0, videoViews: 0 });
  });
});
