/**
 * Publish loop for content drafts/posts and campaigns/deliverables -> on-disk
 * brain files, so a teammate pulling the client repo gets the team's shared
 * drafts and campaigns. Same guarantees as analytics-export.test.ts:
 *  1. buildContentDraftsExportFiles / buildCampaignsExportFiles produce
 *     deterministic (byte-identical) output regardless of input row order.
 *  2. Output is omitted entirely for an empty store (no files).
 *  3. exportContentToDisk writes under the same rootDir exportScopeToDisk /
 *     exportAnalyticsToDisk use, and is a no-op for scopes without a repo.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildContentDraftsExportFiles,
  buildCampaignsExportFiles,
  exportContentToDisk,
  type ContentExportMemory,
} from '../../src/clients/content-export';
import { clientPaths, getWorldRoot } from '../../src/clients/paths';
import type { ContentDraft, ContentPost } from '../../src/memory/content-drafts';
import type { Campaign, CampaignDeliverable } from '../../src/memory/campaigns';

const EXPORTED_AT = '2026-07-14T00:00:00.000Z';

function draft(over: Partial<ContentDraft>): ContentDraft {
  return {
    id: 1,
    scope: 'client:acme',
    session_id: null,
    channel: 'twitter',
    title: '',
    body: 'hello world',
    status: 'draft',
    scheduled_for: null,
    posted_at: null,
    external_ref: null,
    cron_job_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function post(over: Partial<ContentPost>): ContentPost {
  return {
    id: 1,
    draft_id: 1,
    scope: 'client:acme',
    channel: 'twitter',
    status: 'posted',
    detail: null,
    external_ref: null,
    created_at: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

function campaign(over: Partial<Campaign>): Campaign {
  return {
    id: 1,
    scope: 'client:acme',
    name: 'Launch campaign',
    brief: '',
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function deliverable(over: Partial<CampaignDeliverable>): CampaignDeliverable {
  return {
    id: 1,
    campaign_id: 1,
    lane: null,
    title: 'Write the announcement',
    description: '',
    status: 'pending',
    assigned_specialist: null,
    depends_on: null,
    result_ref: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('buildContentDraftsExportFiles', () => {
  it('returns {} for an empty draft store (omits both files)', () => {
    expect(buildContentDraftsExportFiles([])).toEqual({});
  });

  it('writes a per-draft markdown summary including nested posts', () => {
    const files = buildContentDraftsExportFiles([
      {
        draft: draft({ channel: 'twitter', title: 'Launch post', status: 'posted' }),
        posts: [post({ status: 'posted', external_ref: 'https://x.com/acme/status/1' })],
      },
    ]);
    const md = files['.atelier/memory/content-drafts.md'];
    expect(md).toContain('[twitter] Launch post');
    expect(md).toContain('posted');
    expect(md).toContain('https://x.com/acme/status/1');
  });

  it('is deterministic — same drafts in any order produce byte-identical output', () => {
    const rows = [
      { draft: draft({ id: 1, title: 'Beta draft', channel: 'twitter' }), posts: [] },
      { draft: draft({ id: 2, title: 'Alpha draft', channel: 'twitter' }), posts: [] },
    ];
    const one = buildContentDraftsExportFiles(rows);
    const two = buildContentDraftsExportFiles([...rows].reverse());
    expect(one['.atelier/memory/content-drafts.md']).toBe(two['.atelier/memory/content-drafts.md']);
    expect(one['.atelier/memory/content-drafts.json']).toBe(two['.atelier/memory/content-drafts.json']);
    const body = one['.atelier/memory/content-drafts.md'];
    expect(body.indexOf('Alpha draft')).toBeLessThan(body.indexOf('Beta draft'));
  });

  it('emits a lossless content-drafts.json with nested posts, camelCase field names', () => {
    const files = buildContentDraftsExportFiles([
      {
        draft: draft({
          channel: 'twitter',
          title: 'Launch post',
          body: 'the body text',
          status: 'posted',
          scheduled_for: null,
          posted_at: '2026-01-02T00:00:00.000Z',
          external_ref: 'https://x.com/acme/status/1',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        }),
        posts: [
          post({
            channel: 'twitter',
            status: 'posted',
            detail: 'ok',
            external_ref: 'https://x.com/acme/status/1',
            created_at: '2026-01-02T00:00:00.000Z',
          }),
        ],
      },
    ]);
    const parsed = JSON.parse(files['.atelier/memory/content-drafts.json']);
    expect(parsed).toEqual([
      {
        channel: 'twitter',
        title: 'Launch post',
        body: 'the body text',
        status: 'posted',
        scheduledFor: null,
        postedAt: '2026-01-02T00:00:00.000Z',
        externalRef: 'https://x.com/acme/status/1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        posts: [
          {
            channel: 'twitter',
            status: 'posted',
            detail: 'ok',
            externalRef: 'https://x.com/acme/status/1',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      },
    ]);
  });

  it('never includes the local id / draft_id / session_id / cron_job_id (not portable across installs)', () => {
    const files = buildContentDraftsExportFiles([
      {
        draft: draft({ id: 42, session_id: 'sess-1', cron_job_id: 7 }),
        posts: [post({ id: 99, draft_id: 42 })],
      },
    ]);
    const json = files['.atelier/memory/content-drafts.json'];
    expect(json).not.toMatch(/"id"/);
    expect(json).not.toMatch(/draft_id|draftId/);
    expect(json).not.toMatch(/session_id|sessionId/);
    expect(json).not.toMatch(/cron_job_id|cronJobId/);
    expect(json).not.toMatch(/"scope"/);
  });
});

describe('buildCampaignsExportFiles', () => {
  it('returns {} for an empty campaign store', () => {
    expect(buildCampaignsExportFiles([])).toEqual({});
  });

  it('writes a per-campaign markdown summary including nested deliverables and dependency names', () => {
    const files = buildCampaignsExportFiles([
      {
        campaign: campaign({ name: 'Launch campaign', status: 'active' }),
        deliverables: [
          deliverable({ id: 1, title: 'Draft copy', status: 'done' }),
          deliverable({ id: 2, title: 'Review copy', status: 'pending', depends_on: 1 }),
        ],
      },
    ]);
    const md = files['.atelier/memory/campaigns.md'];
    expect(md).toContain('Launch campaign');
    expect(md).toContain('2 deliverables');
    expect(md).toContain('[done] Draft copy');
    expect(md).toContain('[pending] Review copy (depends on: Draft copy)');
  });

  it('emits a lossless campaigns.json translating depends_on into a portable dependsOnTitle', () => {
    const files = buildCampaignsExportFiles([
      {
        campaign: campaign({ name: 'Launch campaign', brief: 'Ship it', status: 'active' }),
        deliverables: [
          deliverable({ id: 10, title: 'Draft copy', status: 'done' }),
          deliverable({ id: 11, title: 'Review copy', status: 'pending', depends_on: 10, result_ref: 'content_draft:5' }),
        ],
      },
    ]);
    const parsed = JSON.parse(files['.atelier/memory/campaigns.json']);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: 'Launch campaign', brief: 'Ship it', status: 'active' });
    expect(parsed[0].deliverables).toEqual([
      expect.objectContaining({ title: 'Draft copy', status: 'done', dependsOnTitle: null }),
      expect.objectContaining({
        title: 'Review copy',
        status: 'pending',
        dependsOnTitle: 'Draft copy',
        resultRef: 'content_draft:5',
      }),
    ]);
  });

  it('never includes the local id / campaign_id (not portable across installs)', () => {
    const files = buildCampaignsExportFiles([
      { campaign: campaign({ id: 55 }), deliverables: [deliverable({ id: 1, campaign_id: 55 })] },
    ]);
    const json = files['.atelier/memory/campaigns.json'];
    expect(json).not.toMatch(/"id"/);
    expect(json).not.toMatch(/campaign_id|campaignId/);
    expect(json).not.toMatch(/"scope"/);
  });

  it('is deterministic — same campaigns in any order produce byte-identical output', () => {
    const rows = [
      { campaign: campaign({ id: 1, name: 'Beta campaign' }), deliverables: [] },
      { campaign: campaign({ id: 2, name: 'Alpha campaign' }), deliverables: [] },
    ];
    const one = buildCampaignsExportFiles(rows);
    const two = buildCampaignsExportFiles([...rows].reverse());
    expect(one['.atelier/memory/campaigns.json']).toBe(two['.atelier/memory/campaigns.json']);
  });
});

describe('exportContentToDisk (round-trips to a real client repo dir)', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a client scope's OWN drafts and campaigns under the client's memory dir, excluding other scopes", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');

    const acmeDraft = draft({ id: 1, scope: 'client:acme', title: 'Acme draft' });
    const otherDraft = draft({ id: 2, scope: 'client:other', title: 'Other draft' });
    const acmeCampaign = campaign({ id: 1, scope: 'client:acme', name: 'Acme campaign' });
    const otherCampaign = campaign({ id: 2, scope: 'client:other', name: 'Other campaign' });

    const memory: ContentExportMemory = {
      getContentDraftsForScopes: (scopes) => [acmeDraft, otherDraft].filter((d) => scopes.includes(d.scope)),
      getContentPostsForDraft: () => [],
      getCampaignsForScopes: (scopes) => [acmeCampaign, otherCampaign].filter((c) => scopes.includes(c.scope)),
      getDeliverablesForCampaign: () => [],
    };

    const written = exportContentToDisk(memory, 'client:acme');
    expect(written).toContain('.atelier/memory/content-drafts.md');
    expect(written).toContain('.atelier/memory/content-drafts.json');
    expect(written).toContain('.atelier/memory/campaigns.md');
    expect(written).toContain('.atelier/memory/campaigns.json');

    const p = clientPaths('acme');
    const draftsMd = fs.readFileSync(path.join(p.memoryDir, 'content-drafts.md'), 'utf-8');
    expect(draftsMd).toContain('Acme draft');
    expect(draftsMd).not.toContain('Other draft');

    const campaignsMd = fs.readFileSync(path.join(p.memoryDir, 'campaigns.md'), 'utf-8');
    expect(campaignsMd).toContain('Acme campaign');
    expect(campaignsMd).not.toContain('Other campaign');
  });

  it('is a no-op for scopes without a repo (project/personal)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory: ContentExportMemory = {
      getContentDraftsForScopes: () => [draft({})],
      getContentPostsForDraft: () => [],
      getCampaignsForScopes: () => [campaign({})],
      getDeliverablesForCampaign: () => [],
    };
    expect(exportContentToDisk(memory, 'project:acme-site')).toEqual([]);
    expect(exportContentToDisk(memory, 'user')).toEqual([]);
  });

  it('is a no-op (writes nothing) when the scope has zero drafts and zero campaigns', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory: ContentExportMemory = {
      getContentDraftsForScopes: () => [],
      getContentPostsForDraft: () => [],
      getCampaignsForScopes: () => [],
      getDeliverablesForCampaign: () => [],
    };
    expect(exportContentToDisk(memory, 'client:acme')).toEqual([]);
  });

  it('writes world scope content under the world root', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-export-'));
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
    const memory: ContentExportMemory = {
      getContentDraftsForScopes: () => [draft({ scope: 'world', title: 'Agency-wide draft' })],
      getContentPostsForDraft: () => [],
      getCampaignsForScopes: () => [],
      getDeliverablesForCampaign: () => [],
    };
    const written = exportContentToDisk(memory, 'world');
    expect(written).toContain('.atelier/memory/content-drafts.md');
    const draftsPath = path.join(getWorldRoot(), '.atelier', 'memory', 'content-drafts.md');
    expect(fs.readFileSync(draftsPath, 'utf-8')).toContain('Agency-wide draft');
  });
});
