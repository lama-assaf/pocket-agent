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
    post_url: null,
    thread_text: '',
    top_comments: null,
    media_urls: [],
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

  it('includes a media sub-line listing shared asset URLs when a post has media_urls', () => {
    const files = buildAnalyticsExportFiles(
      [
        row({
          title: 'Launch post',
          media_urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.mp4'],
        }),
      ],
      EXPORTED_AT
    );
    const posts = files['.atelier/memory/analytics-posts.md'];
    expect(posts).toContain('media: https://cdn.example.com/a.png, https://cdn.example.com/b.mp4');
  });

  it('omits the media sub-line entirely when a post has no media_urls', () => {
    const files = buildAnalyticsExportFiles([row({ title: 'No media post' })], EXPORTED_AT);
    expect(files['.atelier/memory/analytics-posts.md']).not.toContain('media:');
  });

  it('also emits a lossless analytics-posts.json alongside the markdown files', () => {
    const files = buildAnalyticsExportFiles(
      [
        row({
          channel: 'twitter',
          external_ref: 'post-1',
          title: 'Launch post',
          impressions: 100,
          likes: 10,
          comments: 2,
          shares: 1,
          clicks: 5,
          video_views: 20,
          source: 'mcp',
          post_url: 'https://x.com/acme/status/1',
          thread_text: 'Opening tweet',
          top_comments: JSON.stringify([{ author: '@a', text: 'nice', likes: 3 }]),
          media_urls: ['https://cdn.example.com/a.png'],
          captured_at: '2026-07-01T00:00:00.000Z',
        }),
      ],
      EXPORTED_AT
    );
    const json = files['.atelier/memory/analytics-posts.json'];
    expect(json).toBeDefined();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      {
        channel: 'twitter',
        externalRef: 'post-1',
        title: 'Launch post',
        impressions: 100,
        likes: 10,
        comments: 2,
        shares: 1,
        clicks: 5,
        videoViews: 20,
        source: 'mcp',
        rawJson: null,
        postUrl: 'https://x.com/acme/status/1',
        threadText: 'Opening tweet',
        topComments: [{ author: '@a', text: 'nice', likes: 3 }],
        mediaUrls: ['https://cdn.example.com/a.png'],
        capturedAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
  });

  it('never includes content_post_id or scope in the JSON export (not portable across installs)', () => {
    const files = buildAnalyticsExportFiles(
      [row({ content_post_id: 42, scope: 'client:acme' })],
      EXPORTED_AT
    );
    const json = files['.atelier/memory/analytics-posts.json'];
    expect(json).not.toContain('content_post_id');
    expect(json).not.toContain('contentPostId');
    expect(json).not.toMatch(/"scope"/);
  });

  it('JSON export is deterministic — same rows in any order produce byte-identical output', () => {
    const rows = [
      row({ id: 1, channel: 'twitter', title: 'Beta post', external_ref: 'b' }),
      row({ id: 2, channel: 'twitter', title: 'Alpha post', external_ref: 'a' }),
    ];
    const one = buildAnalyticsExportFiles(rows, EXPORTED_AT);
    const two = buildAnalyticsExportFiles([...rows].reverse(), EXPORTED_AT);
    expect(one['.atelier/memory/analytics-posts.json']).toBe(two['.atelier/memory/analytics-posts.json']);
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
    expect(written).toContain('.atelier/memory/analytics-posts.json');

    const p = clientPaths('acme');
    const postsFile = fs.readFileSync(path.join(p.memoryDir, 'analytics-posts.md'), 'utf-8');
    expect(postsFile).toContain('Acme post');
    expect(postsFile).not.toContain('Other post');

    const postsJson = JSON.parse(fs.readFileSync(path.join(p.memoryDir, 'analytics-posts.json'), 'utf-8'));
    expect(postsJson).toHaveLength(1);
    expect(postsJson[0]).toMatchObject({ title: 'Acme post', impressions: 100 });
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
