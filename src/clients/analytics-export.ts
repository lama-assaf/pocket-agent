// src/clients/analytics-export.ts
// Publish loop for post analytics: writes a scope's latest per-post metrics +
// aggregate summary out to its on-disk brain, alongside voice/lessons/facts
// (src/clients/export.ts), so a teammate pulling the client repo gets the
// team's shared analytics numbers without needing their own local snapshots.
//
// One-way by design: this is the export half only (DB -> files). There is no
// pull-side re-import into post_analytics — the exporting operator's local
// snapshots remain the source of truth; these files are a shareable,
// git-diffable READ surface for the team (and a `git log` history of how
// numbers moved over time), not a second write path into the analytics
// store. Re-importing snapshots on pull would need dedup/merge semantics
// this append-only table doesn't have (see src/memory/analytics.ts's module
// doc) — a deliberate scope cut, not an oversight.

import fs from 'fs';
import path from 'path';
import { rootDirForScope } from './export';
import { summarizeAnalytics, type PostAnalytics, type AnalyticsSummary } from '../memory/analytics';

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
  const lines = sorted.map((r) => {
    const rate = r.impressions ? (r.likes + r.comments + r.shares) / r.impressions : 0;
    const title = r.title || r.external_ref;
    return (
      `- **[${r.channel}] ${title}** \u2014 ${r.impressions} impressions, ${r.likes} likes, ` +
      `${r.comments} comments, ${r.shares} shares, ${r.clicks} clicks, ${pct(rate)} eng. ` +
      `(captured ${r.captured_at}, source: ${r.source})`
    );
  });
  return `${ANALYTICS_POSTS_HEADER}\n${lines.join('\n')}\n`;
}

/**
 * Build the rootDir-relative files for a scope's OWN analytics (the rows
 * passed in — callers pass exactly this scope's rows, never the visible-scope
 * chain, so a client's export never folds in world/agency aggregate numbers).
 * Pure — no I/O — directly testable. Returns {} when there is nothing to
 * export (an empty analytics store omits both files, matching
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
