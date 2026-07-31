// src/clients/analytics-import.ts
// Pull-side counterpart to analytics-export.ts: reads the structured
// analytics-posts.json a teammate published and inserts any snapshots this
// local DB doesn't already have into post_analytics, so after one
// git clone/pull the team's shared numbers are queryable OFFLINE — no live
// re-fetch, no server round-trip — the same way a fresh install already gets
// voice/lessons/facts via atelier-bridge's file->fact mirror.
//
// Idempotent by construction: dedupes on (channel, externalRef, capturedAt)
// against what's already stored locally for this scope, and only ever
// INSERTs rows that key doesn't match. It never UPDATEs/REPLACEs an existing
// row, so an operator's own locally-captured snapshot for the same post and
// timestamp is always left untouched — local data remains source of truth,
// exactly as analytics-export.ts's module doc promises. Two different
// captures of the same post at different times are NOT a collision — both
// are kept, which is the intended value of merging snapshot history across
// teammates who each ran their own capture at a different moment.
//
// Scope handling: import only ever writes into the SAME scope the pulled
// repo belongs to (the exact scope exportAnalyticsToDisk wrote from — never
// the visible-scope chain), so a client's shared numbers land in
// `client:<id>` and world's land in `world`; imported rows can never leak
// into `user` (personal) or another client's scope. `content_post_id` is
// deliberately never set from an imported row — it's a local-DB foreign key
// (autoincrement id into THIS install's own content_posts table) and isn't
// portable across machines; content-post linking for imported snapshots
// falls back to filterAnalyticsForContentPosts's scope+channel+external_ref
// heuristic, same as any other unlinked entry.

import fs from 'fs';
import path from 'path';
import { rootDirForScope } from './export';
import type { AnalyticsExportRow } from './analytics-export';
import type { PostAnalytics, RecordPostAnalyticsInput } from '../memory/analytics';

/** Memory-store surface the importer needs (a subset of MemoryManager). */
export interface AnalyticsImportMemory {
  getPostAnalyticsForScopes(visibleScopes: string[], channel?: string): PostAnalytics[];
  recordPostAnalytics(input: RecordPostAnalyticsInput): number;
}

/** Stable dedup key: same post, same channel, same captured moment. */
function dedupeKey(channel: string, externalRef: string, capturedAt: string): string {
  return `${channel}\u0000${externalRef}\u0000${capturedAt}`;
}

/** True when `row` has the minimum shape importAnalyticsFromBrain needs (tolerates a hand-edited or partially-written file). */
function isValidExportRow(row: unknown): row is AnalyticsExportRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.channel === 'string' &&
    r.channel.length > 0 &&
    typeof r.externalRef === 'string' &&
    r.externalRef.length > 0 &&
    typeof r.capturedAt === 'string'
  );
}

/** Normalize an untrusted `source` value to the DB's CHECK(source IN ('manual', 'mcp')) domain — anything else (hand-edited file, future export format) falls back to 'manual' rather than throwing a constraint violation. */
function normalizeSource(source: unknown): 'manual' | 'mcp' {
  return source === 'mcp' ? 'mcp' : 'manual';
}

/** Parse `.atelier/memory/analytics-posts.json` at rootDir. Returns [] when missing, empty, or malformed — never throws. */
function readAnalyticsJson(rootDir: string): AnalyticsExportRow[] {
  const abs = path.join(rootDir, '.atelier', 'memory', 'analytics-posts.json');
  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf-8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidExportRow) : [];
  } catch {
    return [];
  }
}

/**
 * Import a scope's shared analytics-posts.json into the local post_analytics
 * table. Only ever ADDS rows whose (channel, externalRef, capturedAt) key
 * isn't already present locally for this scope — never overwrites an
 * existing snapshot (see module doc). A no-op for scopes without a repo
 * (project/personal) or a missing/empty/malformed export file. Returns the
 * number of rows actually inserted.
 */
export function importAnalyticsFromBrain(memory: AnalyticsImportMemory, scope: string): number {
  const rootDir = rootDirForScope(scope);
  if (!rootDir) return 0;
  const rows = readAnalyticsJson(rootDir);
  if (rows.length === 0) return 0;

  const existingKeys = new Set(
    memory
      .getPostAnalyticsForScopes([scope])
      .map((r) => dedupeKey(r.channel, r.external_ref, r.captured_at))
  );

  let inserted = 0;
  for (const row of rows) {
    const key = dedupeKey(row.channel, row.externalRef, row.capturedAt);
    if (existingKeys.has(key)) continue;
    try {
      memory.recordPostAnalytics({
        scope,
        channel: row.channel,
        externalRef: row.externalRef,
        title: row.title,
        impressions: row.impressions,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        clicks: row.clicks,
        videoViews: row.videoViews,
        source: normalizeSource(row.source),
        rawJson: row.rawJson,
        postUrl: row.postUrl,
        threadText: row.threadText,
        topComments: row.topComments,
        mediaUrls: row.mediaUrls,
        capturedAt: row.capturedAt,
      });
      existingKeys.add(key); // guard against duplicate keys within the same import batch
      inserted++;
    } catch (e) {
      // One bad row (hand-edited file, unexpected type, DB constraint) must
      // never abort the rest of the batch — log and keep importing.
      console.error(
        `[Analytics] Skipped one malformed import row (${row.channel}/${row.externalRef}):`,
        e
      );
    }
  }
  return inserted;
}
