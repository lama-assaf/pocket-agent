/**
 * LinkedIn Community Management API client — organization post analytics.
 *
 * Two calls per sync:
 *  1. GET /rest/posts?author={orgUrn}&q=author        — the org's recent posts
 *  2. GET /rest/organizationalEntityShareStatistics    — per-post stats,
 *     scoped to those same post URNs via the `shares` param
 *
 * Every LinkedIn REST call requires a `Linkedin-Version: YYYYMM` header (the
 * API version, not a date range) and `X-Restli-Protocol-Version: 2.0.0`.
 * Metrics available (organizationalEntityShareStatistics.totalShareStatistics):
 * impressionCount, uniqueImpressionsCounts, clickCount, likeCount,
 * commentCount, shareCount, engagement. No video-view metric is exposed here,
 * so video_views is always 0 for LinkedIn-sourced rows.
 *
 * Every exported function takes `fetchImpl` (default the ambient global
 * `fetch`) so tests can inject a stub without needing a network mock library
 * — see tests/unit/linkedin-client.test.ts.
 */

export interface LinkedInPost {
  urn: string;
  createdAtMs: number | null;
  /** Post text, truncated by LinkedIn's own commentary field length — used as the analytics row's display title. */
  commentary: string;
}

export interface LinkedInShareStats {
  shareUrn: string;
  impressions: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
}

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'LinkedInApiError';
  }
}

/** LinkedIn's required `Linkedin-Version` header value: current month as YYYYMM. */
export function linkedinVersionHeader(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': linkedinVersionHeader(),
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

async function getJson(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { headers: authHeaders(accessToken) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LinkedInApiError(`LinkedIn API request failed (${response.status}): ${body}`, response.status);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** Parse one /rest/posts response into typed post URNs + timestamps. Pure — directly unit-testable. */
export function parsePostsResponse(json: Record<string, unknown>): LinkedInPost[] {
  const elements = Array.isArray(json.elements) ? (json.elements as Record<string, unknown>[]) : [];
  return elements
    .map((el) => {
      // LinkedIn's Posts API nests the text under commentary.text in the
      // documented shape; degrade to '' if the response omits it rather than throwing.
      const commentaryField = el.commentary;
      const commentary =
        typeof commentaryField === 'string'
          ? commentaryField
          : typeof (commentaryField as { text?: unknown } | undefined)?.text === 'string'
            ? ((commentaryField as { text: string }).text)
            : '';
      return {
        urn: typeof el.id === 'string' ? el.id : '',
        createdAtMs: typeof el.createdAt === 'number' ? el.createdAt : null,
        commentary,
      };
    })
    .filter((p) => p.urn.length > 0);
}

/** Parse one organizationalEntityShareStatistics response into per-post stats. Pure — directly unit-testable. */
export function parseShareStatisticsResponse(json: Record<string, unknown>): LinkedInShareStats[] {
  const elements = Array.isArray(json.elements) ? (json.elements as Record<string, unknown>[]) : [];
  const out: LinkedInShareStats[] = [];
  for (const el of elements) {
    const shareUrn = typeof el.share === 'string' ? el.share : null;
    // Some responses key the whole-org aggregate under organizationalEntity
    // with no `share` field at all — skip those here; per-post stats are
    // what post_analytics needs (aggregate totals are computed in-app).
    if (!shareUrn) continue;
    const stats = (el.totalShareStatistics ?? {}) as Record<string, unknown>;
    const num = (key: string): number => (typeof stats[key] === 'number' ? (stats[key] as number) : 0);
    out.push({
      shareUrn,
      impressions: num('impressionCount'),
      clicks: num('clickCount'),
      likes: num('likeCount'),
      comments: num('commentCount'),
      shares: num('shareCount'),
    });
  }
  return out;
}

/** Fetch an org's recent posts. `count` caps how many are pulled (LinkedIn pages results; this app doesn't page further). */
export async function fetchOrganizationPosts(
  orgUrn: string,
  accessToken: string,
  count: number = 50,
  fetchImpl: typeof fetch = fetch
): Promise<LinkedInPost[]> {
  const url = `https://api.linkedin.com/rest/posts?q=author&author=${encodeURIComponent(orgUrn)}&count=${count}`;
  const json = await getJson(url, accessToken, fetchImpl);
  return parsePostsResponse(json);
}

/** Fetch per-post share statistics for a specific set of post URNs (batched into one call, LinkedIn's documented shape). */
export async function fetchShareStatistics(
  orgUrn: string,
  postUrns: string[],
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<LinkedInShareStats[]> {
  if (postUrns.length === 0) return [];
  const sharesParam = `List(${postUrns.map((u) => encodeURIComponent(u)).join(',')})`;
  const url =
    `https://api.linkedin.com/rest/organizationalEntityShareStatistics` +
    `?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}&shares=${sharesParam}`;
  const json = await getJson(url, accessToken, fetchImpl);
  return parseShareStatisticsResponse(json);
}
