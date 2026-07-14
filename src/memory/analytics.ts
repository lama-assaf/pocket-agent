/**
 * Post analytics data model: per-post performance metrics (impressions,
 * likes, comments, shares, clicks, video views) for X/LinkedIn/etc., scoped
 * like facts/content_drafts (`scope` = 'user' | 'world' | 'client:<id>' |
 * 'project:<key>') so one brand's numbers never leak into another's.
 *
 * `post_analytics` is append-only, same rationale as content_posts: a post's
 * numbers keep climbing for days after it ships, so each ingestion (manual
 * entry or MCP fetch) writes a NEW snapshot row rather than overwriting the
 * last one — "Show performance over time" has a real trail, and "current
 * numbers" is just "the latest snapshot per post" (see
 * getLatestPostAnalyticsForScopes), not a value callers destructively update.
 *
 * `external_ref` identifies "the post" on its platform (a URL or platform
 * post id) and is the grouping key alongside scope+channel; `content_post_id`
 * optionally links back to the content_posts audit-log row that made the
 * post, when analytics are being recorded for something Pocket Agent itself
 * published (never required — a human can also log analytics for a post
 * that was never drafted/posted through this app).
 */

import type Database from 'better-sqlite3';

/** Where a snapshot's numbers came from — surfaced in the UI so a human-entered guess is never confused with a live platform read. */
export type PostAnalyticsSource = 'manual' | 'mcp';

export interface PostAnalytics {
  id: number;
  scope: string;
  channel: string;
  external_ref: string;
  content_post_id: number | null;
  title: string;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  video_views: number;
  source: PostAnalyticsSource;
  raw_json: string | null;
  captured_at: string;
  created_at: string;
}

export interface RecordPostAnalyticsInput {
  scope: string;
  channel: string;
  externalRef: string;
  contentPostId?: number | null;
  title?: string;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  videoViews?: number;
  source?: PostAnalyticsSource;
  rawJson?: string | null;
  /** ISO timestamp this snapshot was captured at; defaults to now. Lets a backfill import record historical snapshots honestly. */
  capturedAt?: string;
}

/** Insert one analytics snapshot. Never upserts — see module doc for why this is append-only. */
export function recordPostAnalytics(db: Database.Database, input: RecordPostAnalyticsInput): number {
  const stmt = db.prepare(`
    INSERT INTO post_analytics (
      scope, channel, external_ref, content_post_id, title,
      impressions, likes, comments, shares, clicks, video_views,
      source, raw_json, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, (strftime('%Y-%m-%dT%H:%M:%fZ'))))
  `);
  const result = stmt.run(
    input.scope,
    input.channel,
    input.externalRef,
    input.contentPostId ?? null,
    input.title ?? '',
    input.impressions ?? 0,
    input.likes ?? 0,
    input.comments ?? 0,
    input.shares ?? 0,
    input.clicks ?? 0,
    input.videoViews ?? 0,
    input.source ?? 'manual',
    input.rawJson ?? null,
    input.capturedAt ?? null
  );
  return result.lastInsertRowid as number;
}

/**
 * Every snapshot visible to the given scopes (nearest-first chain from
 * resolveVisibleScopes), optionally filtered to one channel, newest first.
 * Mirrors content-drafts.ts's getContentDraftsForScopes isolation contract —
 * an empty scope list returns [] rather than falling through unfiltered.
 */
export function getPostAnalyticsForScopes(
  db: Database.Database,
  visibleScopes: string[],
  channel?: string
): PostAnalytics[] {
  if (visibleScopes.length === 0) return [];
  const scopeClause = visibleScopes.map(() => '?').join(', ');
  const channelClause = channel ? 'AND channel = ?' : '';
  const params = channel ? [...visibleScopes, channel] : visibleScopes;
  return db
    .prepare(
      `SELECT * FROM post_analytics WHERE scope IN (${scopeClause}) ${channelClause} ORDER BY captured_at DESC, id DESC`
    )
    .all(...params) as PostAnalytics[];
}

/**
 * One row per (scope, channel, external_ref) group — the latest snapshot for
 * each distinct post, which is what "current numbers" means for a post whose
 * metrics are refreshed over time. Groups on MAX(id) rather than MAX(captured_at)
 * so the pick is deterministic even if two snapshots share a captured_at
 * (manual entries default to "now", so bulk-entry in the same second is possible).
 */
export function getLatestPostAnalyticsForScopes(
  db: Database.Database,
  visibleScopes: string[],
  channel?: string
): PostAnalytics[] {
  if (visibleScopes.length === 0) return [];
  const scopeClause = visibleScopes.map(() => '?').join(', ');
  const channelClause = channel ? 'AND channel = ?' : '';
  const params = channel ? [...visibleScopes, channel] : visibleScopes;
  return db
    .prepare(
      `
      SELECT pa.* FROM post_analytics pa
      JOIN (
        SELECT scope, channel, external_ref, MAX(id) AS max_id
        FROM post_analytics
        WHERE scope IN (${scopeClause}) ${channelClause}
        GROUP BY scope, channel, external_ref
      ) latest ON pa.id = latest.max_id
      ORDER BY pa.captured_at DESC, pa.id DESC
      `
    )
    .all(...params) as PostAnalytics[];
}

/** Full snapshot history for one specific post, newest first. */
export function getPostAnalyticsHistory(
  db: Database.Database,
  scope: string,
  channel: string,
  externalRef: string
): PostAnalytics[] {
  return db
    .prepare(
      `SELECT * FROM post_analytics
       WHERE scope = ? AND channel = ? AND external_ref = ?
       ORDER BY captured_at DESC, id DESC`
    )
    .all(scope, channel, externalRef) as PostAnalytics[];
}

export function deletePostAnalytics(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM post_analytics WHERE id = ?').run(id).changes > 0;
}

// ============ Pure aggregate helpers (no DB — directly unit-testable) ============

/**
 * Engagement rate for one snapshot: (likes + comments + shares) / impressions,
 * matching the campaign-retro skill's organic engagement-rate formula (see
 * src/marketplace/seed/salon/skills/campaign-retro/SKILL.md). Clicks are
 * tracked separately (click-through, not an engagement signal) and excluded
 * here. Returns 0 when impressions is 0 rather than dividing by zero.
 */
export function computeEngagementRate(row: {
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
}): number {
  if (!row.impressions) return 0;
  return (row.likes + row.comments + row.shares) / row.impressions;
}

export interface ChannelSummary {
  posts: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  videoViews: number;
  engagementRate: number;
}

export interface AnalyticsSummary {
  totalPosts: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  videoViews: number;
  engagementRate: number;
  byChannel: Record<string, ChannelSummary>;
  /** Up to `topN` posts ranked by engagement rate, restricted to posts with at least `minImpressions` (avoids a 1-impression post with 1 like "winning" on a noisy rate). */
  topPosts: PostAnalytics[];
}

/**
 * Summarize a set of LATEST-per-post snapshots (pass getLatestPostAnalyticsForScopes's
 * output, not the full history — summing every historical snapshot of the
 * same post would double-count it). Pure — no DB — so it's directly
 * unit-testable against hand-built rows.
 */
export function summarizeAnalytics(
  rows: PostAnalytics[],
  options: { topN?: number; minImpressionsForRanking?: number } = {}
): AnalyticsSummary {
  const topN = options.topN ?? 5;
  const minImpressions = options.minImpressionsForRanking ?? 0;

  const totals = { impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0, videoViews: 0 };
  const byChannel: Record<string, ChannelSummary> = {};

  for (const row of rows) {
    totals.impressions += row.impressions;
    totals.likes += row.likes;
    totals.comments += row.comments;
    totals.shares += row.shares;
    totals.clicks += row.clicks;
    totals.videoViews += row.video_views;

    if (!byChannel[row.channel]) {
      byChannel[row.channel] = {
        posts: 0,
        impressions: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        videoViews: 0,
        engagementRate: 0,
      };
    }
    const c = byChannel[row.channel];
    c.posts += 1;
    c.impressions += row.impressions;
    c.likes += row.likes;
    c.comments += row.comments;
    c.shares += row.shares;
    c.clicks += row.clicks;
    c.videoViews += row.video_views;
  }

  for (const c of Object.values(byChannel)) {
    c.engagementRate = c.impressions ? (c.likes + c.comments + c.shares) / c.impressions : 0;
  }

  const topPosts = [...rows]
    .filter((r) => r.impressions >= minImpressions)
    .sort((a, b) => computeEngagementRate(b) - computeEngagementRate(a))
    .slice(0, topN);

  return {
    totalPosts: rows.length,
    ...totals,
    engagementRate: totals.impressions ? (totals.likes + totals.comments + totals.shares) / totals.impressions : 0,
    byChannel,
    topPosts,
  };
}

// ============ Campaign -> content -> analytics linking ============

/** Minimal shape of a content_posts row the campaign/content join needs — decoupled from content-drafts.ts's full ContentPost type for easy unit testing. */
export interface ContentPostRef {
  id: number;
  scope: string;
  channel: string;
  externalRef: string | null;
}

/**
 * Filter a set of (latest-per-post) analytics rows down to only the ones
 * linked to one of the given content posts — by explicit `content_post_id`
 * (the clean, intended link, set when analytics are recorded for something
 * this app posted), OR by a scope+channel+external_ref match as a best-effort
 * fallback (the same post URL/id was pasted both when the draft was posted
 * and when its analytics were recorded, even without an explicit link —
 * mirrors content-tools.ts's existing "best-effort heuristic" philosophy for
 * MCP posting-tool matching). Pure — no DB — directly unit-testable.
 */
export function filterAnalyticsForContentPosts(
  rows: PostAnalytics[],
  refs: ContentPostRef[]
): PostAnalytics[] {
  if (refs.length === 0) return [];
  const idSet = new Set(refs.map((r) => r.id));
  const refKeySet = new Set(
    refs.filter((r) => r.externalRef).map((r) => `${r.scope}\u0000${r.channel}\u0000${r.externalRef}`)
  );
  return rows.filter(
    (row) =>
      (row.content_post_id !== null && idSet.has(row.content_post_id)) ||
      refKeySet.has(`${row.scope}\u0000${row.channel}\u0000${row.external_ref}`)
  );
}
