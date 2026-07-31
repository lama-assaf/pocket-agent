/**
 * Parses a bridged X/Twitter MCP tool's free-text response into normalized
 * per-post analytics rows. Pure — directly unit-testable, no network/tool
 * dependency (mirrors src/integrations/linkedin/client.ts's
 * parsePostsResponse/parseShareStatisticsResponse split).
 *
 * Unlike LinkedIn's REST client, this app doesn't control the response shape
 * here — it's whatever the workspace's bridged MCP server (x-api,
 * x-api-bearer, twitter-community, or any other X-capable marketplace
 * server) returns as tool-call text (see content-tools.ts's own note that
 * "real MCP posting tools have wildly different schemas"). This parser is
 * best-effort against the two conventions most likely in practice:
 *
 *  1. The official X API v2 Tweet shape (x-api / x-api-bearer proxy
 *     api.x.com directly): `{ id, text, public_metrics: { impression_count,
 *     like_count, reply_count, retweet_count, quote_count, bookmark_count },
 *     organic_metrics: { url_link_clicks, video_view_count, impression_count } }`,
 *     usually wrapped in `{ data: [...] }`.
 *  2. Flatter/looser shapes from community servers (twitter-community etc.):
 *     top-level array or `{ tweets: [...] }` / `{ posts: [...] }` /
 *     `{ results: [...] }`, with flat metric keys (likes/comments/shares/
 *     views or *_count variants).
 *
 * Anything that doesn't parse as JSON, or parses but contains no
 * post-like array, degrades to an empty list rather than throwing — the
 * caller (syncXAnalyticsForScope) treats "found nothing to record" as a
 * successful zero-post sync, same as LinkedIn's empty-org case.
 */

export interface ParsedXPost {
  externalRef: string;
  text: string;
  url: string | null;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  videoViews: number;
}

/** First present numeric value among `keys` in `obj` (checked in order), else 0. Tolerates numeric strings. */
function firstNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

/** First present non-empty string among `keys` in `obj`, else ''. */
function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/** Locate the array of post-like objects inside a parsed JSON response, across the shapes described in the module doc above. */
function extractPostArray(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['data', 'tweets', 'posts', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

/** Parse one bridged tool's raw text response into normalized post analytics rows. */
export function parseXAnalyticsToolResponse(text: string): ParsedXPost[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return []; // not JSON — nothing we can safely extract structured metrics from
  }

  const items = extractPostArray(parsed);
  const out: ParsedXPost[] = [];
  for (const item of items) {
    const externalRef = firstString(item, ['id', 'tweet_id', 'rest_id', 'id_str']);
    if (!externalRef) continue; // no stable post identity — skip rather than fabricate one

    // Metrics may live flat on the item, or nested under public_metrics /
    // organic_metrics (X API v2) / metrics (generic). Merge nested
    // containers over the flat item so a nested value wins when both exist.
    const nested = [
      (item.public_metrics ?? {}) as Record<string, unknown>,
      (item.organic_metrics ?? {}) as Record<string, unknown>,
      (item.metrics ?? {}) as Record<string, unknown>,
    ];
    const metricsSources = [item, ...nested];
    const pick = (keys: string[]): number => {
      for (const source of metricsSources) {
        const value = firstNumber(source, keys);
        if (value !== 0) return value;
      }
      return 0;
    };

    out.push({
      externalRef,
      text: firstString(item, ['text', 'full_text', 'commentary']),
      url: firstString(item, ['url', 'post_url', 'permalink']) || null,
      impressions: pick(['impression_count', 'impressions', 'view_count', 'views']),
      likes: pick(['like_count', 'likes', 'favorite_count', 'favorites']),
      comments: pick(['reply_count', 'comments', 'replies']),
      shares: pick(['retweet_count', 'shares', 'reposts', 'quote_count']),
      clicks: pick(['url_link_clicks', 'clicks']),
      videoViews: pick(['video_view_count', 'video_views']),
    });
  }
  return out;
}
