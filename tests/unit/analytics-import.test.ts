/**
 * Pull-side counterpart to analytics-export.test.ts: reconstructing
 * post_analytics rows locally from a shared analytics-posts.json, so a fresh
 * install (or a stale one) sees a teammate's captured numbers immediately
 * after a git pull — without a live re-fetch. Same guarantees promised in
 * src/clients/analytics-import.ts's module doc:
 *  1. Idempotent — re-importing the same file never duplicates rows.
 *  2. Never clobbers/overwrites an operator's own existing local snapshot.
 *  3. Scoped — only ever writes into the exact scope being imported.
 *  4. A no-op for scopes without a repo, or a missing/empty/malformed file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importAnalyticsFromBrain, type AnalyticsImportMemory } from '../../src/clients/analytics-import';
import { clientPaths, getWorldRoot } from '../../src/clients/paths';
import type { PostAnalytics, RecordPostAnalyticsInput } from '../../src/memory/analytics';

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

/** In-memory fake of the MemoryManager surface importAnalyticsFromBrain needs. */
class FakeAnalyticsMemory implements AnalyticsImportMemory {
  rows: PostAnalytics[] = [];
  recordedInputs: RecordPostAnalyticsInput[] = [];
  private nextId = 100;

  getPostAnalyticsForScopes(visibleScopes: string[]): PostAnalytics[] {
    return this.rows.filter((r) => visibleScopes.includes(r.scope));
  }

  recordPostAnalytics(input: RecordPostAnalyticsInput): number {
    this.recordedInputs.push(input);
    const id = this.nextId++;
    this.rows.push(
      row({
        id,
        scope: input.scope,
        channel: input.channel,
        external_ref: input.externalRef,
        content_post_id: input.contentPostId ?? null,
        title: input.title ?? '',
        impressions: input.impressions ?? 0,
        likes: input.likes ?? 0,
        comments: input.comments ?? 0,
        shares: input.shares ?? 0,
        clicks: input.clicks ?? 0,
        video_views: input.videoViews ?? 0,
        source: input.source ?? 'manual',
        raw_json: input.rawJson ?? null,
        post_url: input.postUrl ?? null,
        thread_text: input.threadText ?? '',
        top_comments: input.topComments ? JSON.stringify(input.topComments) : null,
        media_urls: input.mediaUrls ?? [],
        captured_at: input.capturedAt ?? new Date().toISOString(),
      })
    );
    return id;
  }
}

function writeAnalyticsJson(rootDir: string, entries: unknown[]): void {
  const abs = path.join(rootDir, '.atelier', 'memory', 'analytics-posts.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(entries, null, 2), 'utf-8');
}

const SHARED_ROW = {
  channel: 'twitter',
  externalRef: 'post-1',
  title: 'Launch post',
  impressions: 500,
  likes: 40,
  comments: 5,
  shares: 2,
  clicks: 10,
  videoViews: 0,
  source: 'mcp' as const,
  rawJson: null,
  postUrl: 'https://x.com/acme/status/1',
  threadText: 'Opening tweet',
  topComments: [{ author: '@a', text: 'nice', likes: 3 }],
  mediaUrls: ['https://cdn.example.com/a.png'],
  capturedAt: '2026-07-01T00:00:00.000Z',
};

describe('importAnalyticsFromBrain', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('inserts rows from analytics-posts.json into the correct client scope', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [SHARED_ROW]);

    const memory = new FakeAnalyticsMemory();
    const inserted = importAnalyticsFromBrain(memory, 'client:acme');

    expect(inserted).toBe(1);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0]).toMatchObject({
      scope: 'client:acme',
      channel: 'twitter',
      external_ref: 'post-1',
      title: 'Launch post',
      impressions: 500,
      post_url: 'https://x.com/acme/status/1',
      thread_text: 'Opening tweet',
      media_urls: ['https://cdn.example.com/a.png'],
    });
  });

  it('never sets content_post_id from an imported row (not portable across installs)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [SHARED_ROW]);

    const memory = new FakeAnalyticsMemory();
    importAnalyticsFromBrain(memory, 'client:acme');

    expect(memory.recordedInputs[0].contentPostId).toBeUndefined();
    expect(memory.rows[0].content_post_id).toBeNull();
  });

  it('is idempotent — importing the same file twice does not duplicate rows', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [SHARED_ROW]);

    const memory = new FakeAnalyticsMemory();
    const firstRun = importAnalyticsFromBrain(memory, 'client:acme');
    const secondRun = importAnalyticsFromBrain(memory, 'client:acme');

    expect(firstRun).toBe(1);
    expect(secondRun).toBe(0);
    expect(memory.rows).toHaveLength(1);
  });

  it('never overwrites/clobbers an operator\u2019s own existing local snapshot for the same key', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    // Shared file has different numbers than the operator's own already-recorded snapshot.
    writeAnalyticsJson(p.rootDir, [{ ...SHARED_ROW, impressions: 999999 }]);

    const memory = new FakeAnalyticsMemory();
    // The operator already recorded their OWN snapshot at the exact same
    // (channel, externalRef, capturedAt) key before the import runs.
    memory.recordPostAnalytics({
      scope: 'client:acme',
      channel: SHARED_ROW.channel,
      externalRef: SHARED_ROW.externalRef,
      impressions: 111,
      capturedAt: SHARED_ROW.capturedAt,
    });

    const inserted = importAnalyticsFromBrain(memory, 'client:acme');

    expect(inserted).toBe(0);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0].impressions).toBe(111); // untouched — the shared 999999 value never landed
  });

  it('adds a new snapshot when a teammate captured the SAME post at a DIFFERENT time (not a collision)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [{ ...SHARED_ROW, capturedAt: '2026-07-02T00:00:00.000Z' }]);

    const memory = new FakeAnalyticsMemory();
    memory.recordPostAnalytics({
      scope: 'client:acme',
      channel: SHARED_ROW.channel,
      externalRef: SHARED_ROW.externalRef,
      impressions: 111,
      capturedAt: '2026-07-01T00:00:00.000Z',
    });

    const inserted = importAnalyticsFromBrain(memory, 'client:acme');

    expect(inserted).toBe(1);
    expect(memory.rows).toHaveLength(2); // append-only history preserved, both snapshots kept
  });

  it('never imports into another scope (e.g. never leaks into a different client)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [SHARED_ROW]);

    const memory = new FakeAnalyticsMemory();
    importAnalyticsFromBrain(memory, 'client:acme');

    expect(memory.rows.every((r) => r.scope === 'client:acme')).toBe(true);
    expect(memory.getPostAnalyticsForScopes(['client:other'])).toEqual([]);
  });

  it('is a no-op for scopes without a repo (project/personal)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory = new FakeAnalyticsMemory();
    expect(importAnalyticsFromBrain(memory, 'project:acme-site')).toBe(0);
    expect(importAnalyticsFromBrain(memory, 'user')).toBe(0);
    expect(memory.rows).toEqual([]);
  });

  it('is a no-op when analytics-posts.json is missing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    // Ensure the client scaffold exists but the analytics file does not.
    clientPaths('acme');
    const memory = new FakeAnalyticsMemory();
    expect(importAnalyticsFromBrain(memory, 'client:acme')).toBe(0);
  });

  it('is a no-op when analytics-posts.json is malformed JSON', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    const abs = path.join(p.rootDir, '.atelier', 'memory', 'analytics-posts.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ not valid json', 'utf-8');
    const memory = new FakeAnalyticsMemory();
    expect(importAnalyticsFromBrain(memory, 'client:acme')).toBe(0);
  });

  it('skips entries missing required fields but still imports the valid ones', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [
      SHARED_ROW,
      { channel: 'twitter' }, // missing externalRef/capturedAt — invalid
      { externalRef: 'post-2' }, // missing channel/capturedAt — invalid
    ]);

    const memory = new FakeAnalyticsMemory();
    const inserted = importAnalyticsFromBrain(memory, 'client:acme');
    expect(inserted).toBe(1);
  });

  it('normalizes an unexpected source value to "manual" instead of throwing (hand-edited/future-format file)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [{ ...SHARED_ROW, source: 'not-a-real-source' }]);

    const memory = new FakeAnalyticsMemory();
    const inserted = importAnalyticsFromBrain(memory, 'client:acme');

    expect(inserted).toBe(1);
    expect(memory.rows[0].source).toBe('manual');
  });

  it('one row that throws during insert never blocks the rest of the batch from importing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeAnalyticsJson(p.rootDir, [
      SHARED_ROW,
      { ...SHARED_ROW, externalRef: 'post-2', capturedAt: '2026-07-03T00:00:00.000Z' },
    ]);

    const memory = new FakeAnalyticsMemory();
    const originalRecord = memory.recordPostAnalytics.bind(memory);
    let call = 0;
    memory.recordPostAnalytics = (input) => {
      call++;
      if (call === 1) throw new Error('simulated DB constraint failure');
      return originalRecord(input);
    };

    const inserted = importAnalyticsFromBrain(memory, 'client:acme');
    expect(inserted).toBe(1); // first row failed, second still landed
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0].external_ref).toBe('post-2');
  });

  it('imports world-scope analytics from the world root', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-import-'));
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
    writeAnalyticsJson(getWorldRoot(), [{ ...SHARED_ROW, title: 'Agency-wide post' }]);

    const memory = new FakeAnalyticsMemory();
    const inserted = importAnalyticsFromBrain(memory, 'world');
    expect(inserted).toBe(1);
    expect(memory.rows[0]).toMatchObject({ scope: 'world', title: 'Agency-wide post' });
  });
});
