/**
 * Publish loop for post analytics: latest per-post rows -> on-disk brain
 * files, so a teammate pulling the client repo gets the team's shared
 * analytics numbers. Same guarantees as clients-export.test.ts:
 *  1. buildAnalyticsExportFiles produces deterministic (byte-identical)
 *     output regardless of input row order.
 *  2. Output is omitted entirely for an empty analytics store (no files).
 *  3. exportAnalyticsToDisk writes under the same rootDir exportScopeToDisk
 *     uses, and is a no-op for scopes without a repo (project/personal).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildAnalyticsExportFiles,
  exportAnalyticsToDisk,
  type AnalyticsExportMemory,
} from '../../src/clients/analytics-export';
import { clientPaths, getWorldRoot } from '../../src/clients/paths';
import type { PostAnalytics } from '../../src/memory/analytics';

const EXPORTED_AT = '2026-07-14T00:00:00.000Z';

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

describe('buildAnalyticsExportFiles', () => {
  it('returns {} for an empty analytics store (omits both files, matching buildScopeFiles convention)', () => {
    expect(buildAnalyticsExportFiles([], EXPORTED_AT)).toEqual({});
  });

  it('writes a summary file with totals and a per-channel breakdown', () => {
    const files = buildAnalyticsExportFiles(
      [
        row({ channel: 'twitter', impressions: 1000, likes: 40, comments: 5, shares: 2 }),
        row({ channel: 'linkedin', impressions: 500, likes: 25, comments: 0, shares: 0 }),
      ],
      EXPORTED_AT
    );
    const summary = files['.atelier/memory/analytics-summary.md'];
    expect(summary).toContain('Total posts**: 2');
    expect(summary).toContain('Impressions**: 1500');
    expect(summary).toContain('## twitter');
    expect(summary).toContain('## linkedin');
    expect(summary).toContain(EXPORTED_AT);
  });

  it('writes a per-post file with one line per post, including engagement rate', () => {
    const files = buildAnalyticsExportFiles(
      [row({ title: 'Launch post', channel: 'twitter', impressions: 100, likes: 10 })],
      EXPORTED_AT
    );
    const posts = files['.atelier/memory/analytics-posts.md'];
    expect(posts).toContain('[twitter] Launch post');
    expect(posts).toContain('100 impressions');
    expect(posts).toContain('10.00% eng.');
  });

  it('is deterministic — same rows in any order produce byte-identical output', () => {
    const rows = [
      row({ id: 1, channel: 'twitter', title: 'Beta post', external_ref: 'b' }),
      row({ id: 2, channel: 'twitter', title: 'Alpha post', external_ref: 'a' }),
    ];
    const one = buildAnalyticsExportFiles(rows, EXPORTED_AT);
    const two = buildAnalyticsExportFiles([...rows].reverse(), EXPORTED_AT);
    expect(one['.atelier/memory/analytics-posts.md']).toBe(two['.atelier/memory/analytics-posts.md']);
    const body = one['.atelier/memory/analytics-posts.md'];
    expect(body.indexOf('Alpha post')).toBeLessThan(body.indexOf('Beta post'));
  });

  it('falls back to external_ref as the display title when no title is set', () => {
    const files = buildAnalyticsExportFiles([row({ title: '', external_ref: 'https://x.com/p/1' })], EXPORTED_AT);
    expect(files['.atelier/memory/analytics-posts.md']).toContain('https://x.com/p/1');
  });
});

describe('exportAnalyticsToDisk (round-trips to a real client repo dir)', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a client scope's OWN analytics under the client's memory dir, excluding other scopes", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');

    const memory: AnalyticsExportMemory = {
      getLatestPostAnalyticsForScopes: (scopes: string[]) => {
        // Real behavior: only rows in the exact requested scope(s) come back.
        const all = [
          row({ scope: 'client:acme', title: 'Acme post', impressions: 100 }),
          row({ scope: 'client:other', title: 'Other post', impressions: 999 }),
        ];
        return all.filter((r) => scopes.includes(r.scope));
      },
    };

    const written = exportAnalyticsToDisk(memory, 'client:acme');
    expect(written).toContain('.atelier/memory/analytics-summary.md');
    expect(written).toContain('.atelier/memory/analytics-posts.md');

    const p = clientPaths('acme');
    const postsFile = fs.readFileSync(path.join(p.memoryDir, 'analytics-posts.md'), 'utf-8');
    expect(postsFile).toContain('Acme post');
    expect(postsFile).not.toContain('Other post');
  });

  it('is a no-op for scopes without a repo (project/personal)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory: AnalyticsExportMemory = {
      getLatestPostAnalyticsForScopes: () => [row({})],
    };
    expect(exportAnalyticsToDisk(memory, 'project:acme-site')).toEqual([]);
    expect(exportAnalyticsToDisk(memory, 'user')).toEqual([]);
  });

  it('is a no-op (writes nothing) when the scope has zero analytics rows', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory: AnalyticsExportMemory = { getLatestPostAnalyticsForScopes: () => [] };
    expect(exportAnalyticsToDisk(memory, 'client:acme')).toEqual([]);
  });

  it('writes world scope analytics under the world root', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-export-'));
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
    const memory: AnalyticsExportMemory = {
      getLatestPostAnalyticsForScopes: () => [row({ scope: 'world', title: 'Agency-wide post' })],
    };
    const written = exportAnalyticsToDisk(memory, 'world');
    expect(written).toContain('.atelier/memory/analytics-posts.md');
    const postsPath = path.join(getWorldRoot(), '.atelier', 'memory', 'analytics-posts.md');
    expect(fs.readFileSync(postsPath, 'utf-8')).toContain('Agency-wide post');
  });
});
