// src/clients/analytics-export.ts
// Publish loop for post analytics: writes a scope's latest per-post metrics +
// aggregate summary out to its on-disk brain, alongside voice/lessons/facts
// (src/clients/export.ts), so a teammate pulling the client repo gets the
// team's shared analytics numbers without needing their own local snapshots.
//
// Two output shapes, one purpose: analytics-summary.md and analytics-posts.md
// are the human-readable, git-diffable READ surface; analytics-posts.json is
// the SAME data in a lossless, machine-readable shape so a pull can
// reconstruct rows locally (see src/clients/analytics-import.ts — the
// pull-side counterpart to this file). The exporting operator's local
// snapshots remain the source of truth: import only ever ADDS rows this
// install doesn't already have (dedup on scope+channel+externalRef+capturedAt),
// it never UPDATEs/REPLACEs — see analytics-import.ts's module doc for why
// that's safe against the append-only table's lack of a real unique
// constraint. `content_post_id` is deliberately omitted from the JSON: it's a
// local-DB foreign key (autoincrement id into this install's own
// content_posts table) and isn't portable across machines.

import fs from 'fs';
import path from 'path';
import { rootDirForScope } from './export';
import {
  summarizeAnalytics,
  type PostAnalytics,
  type AnalyticsSummary,
  type PostAnalyticsSource,
} from '../memory/analytics';

/**
 * Lossless, machine-readable shape of one exported snapshot — the JSON
 * counterpart to analytics-posts.md. Field names match RecordPostAnalyticsInput
 * (camelCase) so analytics-import.ts can feed a parsed row straight into
 * recordPostAnalytics with no remapping. `content_post_id` and `scope` are
 * intentionally excluded (see module doc); `scope` is implied by which
 * client/world repo the file lives in.
 */
export interface AnalyticsExportRow {
  channel: string;
  externalRef: string;
  title: string;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  videoViews: number;
  source: PostAnalyticsSource;
  rawJson: string | null;
  postUrl: string | null;
  threadText: string;
  topComments: Array<{ author: string; text: string; likes: number }> | null;
  mediaUrls: string[];
  capturedAt: string;
}

const ANALYTICS_SUMMARY_HEADER =
  '# Analytics summary\n\n_Aggregate post performance across channels. Exported from the Analytics page \u2014 team-shared, read-only here._\n';
const ANALYTICS_POSTS_HEADER =
  '# Analytics \u2014 per post\n\n_Latest snapshot per post. Exported from the Analytics page \u2014 team-shared, read-only here._\n';

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function summaryMarkdown(summary: AnalyticsSummary, exportedAt: string): string {
  const lines: string[] = [];
  lines.push(`_Exported ${exportedAt}._`);
  lines.push('');
  lines.push(`- **Total posts**: ${summary.totalPosts}`);
  lines.push(`- **Impressions**: ${summary.impressions}`);
  lines.push(`- **Likes**: ${summary.likes}`);
  lines.push(`- **Comments**: ${summary.comments}`);
  lines.push(`- **Shares**: ${summary.shares}`);
  lines.push(`- **Clicks**: ${summary.clicks}`);
  lines.push(`- **Video views**: ${summary.videoViews}`);
  lines.push(`- **Engagement rate**: ${pct(summary.engagementRate)}`);

  // Stable ordering (alphabetical by channel) so repeated exports produce
  // byte-identical files — same discipline as export.ts's buildScopeFiles.
  const channels = Object.keys(summary.byChannel).sort();
  for (const channel of channels) {
    const c = summary.byChannel[channel];
    lines.push('');
    lines.push(`## ${channel}`);
    lines.push(`- posts: ${c.posts}`);
    lines.push(`- impressions: ${c.impressions}`);
    lines.push(`- likes: ${c.likes}`);
    lines.push(`- comments: ${c.comments}`);
    lines.push(`- shares: ${c.shares}`);
    lines.push(`- clicks: ${c.clicks}`);
    lines.push(`- video views: ${c.videoViews}`);
    lines.push(`- engagement rate: ${pct(c.engagementRate)}`);
  }
  return `${ANALYTICS_SUMMARY_HEADER}\n${lines.join('\n')}\n`;
}

function postsMarkdown(rows: PostAnalytics[]): string {
  // Stable ordering (channel, then title/external_ref) so repeated exports
  // produce byte-identical files (clean diffs) — same discipline as
  // export.ts's buildScopeFiles.
  const sorted = [...rows].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      (a.title || a.external_ref).localeCompare(b.title || b.external_ref)
  );
  const lines = sorted.flatMap((r) => {
    const rate = r.impressions ? (r.likes + r.comments + r.shares) / r.impressions : 0;
    const title = r.title || r.external_ref;
    const summary =
      `- **[${r.channel}] ${title}** \u2014 ${r.impressions} impressions, ${r.likes} likes, ` +
      `${r.comments} comments, ${r.shares} shares, ${r.clicks} clicks, ${pct(rate)} eng. ` +
      `(captured ${r.captured_at}, source: ${r.source})`;
    if (!r.media_urls || r.media_urls.length === 0) return [summary];
    return [summary, `  - media: ${r.media_urls.join(', ')}`];
  });
  return `${ANALYTICS_POSTS_HEADER}\n${lines.join('\n')}\n`;
}

/**
 * Parse one row's stored `top_comments` JSON string back into the structured
 * array shape the export JSON wants (never a double-encoded string). `null`/
 * malformed input yields `null` — same "never throws" discipline as
 * analytics.ts's own media_urls parsing.
 */
function parseTopComments(
  raw: string | null
): Array<{ author: string; text: string; likes: number }> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as Array<{ author: string; text: string; likes: number }>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Build the lossless JSON array a pull re-imports from (see
 * src/clients/analytics-import.ts). Same stable sort as postsMarkdown so the
 * file diffs cleanly between exports.
 */
function analyticsJson(rows: PostAnalytics[]): AnalyticsExportRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      (a.title || a.external_ref).localeCompare(b.title || b.external_ref)
  );
  return sorted.map((r) => ({
    channel: r.channel,
    externalRef: r.external_ref,
    title: r.title,
    impressions: r.impressions,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    clicks: r.clicks,
    videoViews: r.video_views,
    source: r.source,
    rawJson: r.raw_json,
    postUrl: r.post_url,
    threadText: r.thread_text,
    topComments: parseTopComments(r.top_comments),
    mediaUrls: r.media_urls,
    capturedAt: r.captured_at,
  }));
}

/**
 * Build the rootDir-relative files for a scope's OWN analytics (the rows
 * passed in — callers pass exactly this scope's rows, never the visible-scope
 * chain, so a client's export never folds in world/agency aggregate numbers).
 * Pure — no I/O — directly testable. Returns {} when there is nothing to
 * export (an empty analytics store omits all three files, matching
 * export.ts's buildScopeFiles "omit empty buckets" convention).
 */
export function buildAnalyticsExportFiles(
  rows: PostAnalytics[],
  exportedAt: string = new Date().toISOString()
): Record<string, string> {
  if (rows.length === 0) return {};
  const summary = summarizeAnalytics(rows, { topN: rows.length });
  return {
    '.atelier/memory/analytics-summary.md': summaryMarkdown(summary, exportedAt),
    '.atelier/memory/analytics-posts.md': postsMarkdown(rows),
    '.atelier/memory/analytics-posts.json': `${JSON.stringify(analyticsJson(rows), null, 2)}\n`,
  };
}

/** Memory-store surface the exporter needs (a subset of MemoryManager). */
export interface AnalyticsExportMemory {
  getLatestPostAnalyticsForScopes(visibleScopes: string[], channel?: string): PostAnalytics[];
}

/**
 * Materialize a scope's OWN analytics (not the visible-scope chain) into its
 * on-disk brain, same "how" as export.ts's exportScopeToDisk: resolve
 * rootDir, write only non-empty files, create parent dirs as needed. A
 * no-op for scopes without a repo (project/personal) or with zero analytics
 * rows. Returns the rootDir-relative paths written.
 */
export function exportAnalyticsToDisk(memory: AnalyticsExportMemory, scope: string): string[] {
  const rootDir = rootDirForScope(scope);
  if (!rootDir) return [];
  const rows = memory.getLatestPostAnalyticsForScopes([scope]);
  const files = buildAnalyticsExportFiles(rows);
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    written.push(rel);
  }
  return written;
}
