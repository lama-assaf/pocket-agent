/**
 * Pull-side counterpart to content-export.test.ts: reconstructing
 * content_drafts/content_posts and campaigns/campaign_deliverables locally
 * from a shared brain, so a fresh install (or a stale one) sees a teammate's
 * drafts and campaigns immediately after a git pull. Same guarantees promised
 * in src/clients/content-import.ts's module doc:
 *  1. Idempotent — re-importing the same files never duplicates rows.
 *  2. Never clobbers an operator's own existing local draft/campaign row,
 *     but still appends any missing nested posts/deliverables under it.
 *  3. Scoped — only ever writes into the exact scope being imported.
 *  4. A no-op for scopes without a repo, or missing/empty/malformed files.
 *  5. depends_on / campaign linkage: resolves dependsOnTitle to a local id,
 *     or skips (never crashes) when unresolvable.
 *  6. One malformed row never blocks the rest of the batch.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  importContentDraftsFromBrain,
  importCampaignsFromBrain,
  importContentFromBrain,
  type ContentImportMemory,
} from '../../src/clients/content-import';
import { clientPaths, getWorldRoot } from '../../src/clients/paths';
import type {
  ContentDraft,
  ContentPost,
  ImportContentDraftInput,
  RecordContentPostInput,
} from '../../src/memory/content-drafts';
import type {
  Campaign,
  CampaignDeliverable,
  ImportCampaignInput,
  ImportDeliverableInput,
} from '../../src/memory/campaigns';

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

/** In-memory fake of the MemoryManager surface the content importer needs. */
class FakeContentMemory implements ContentImportMemory {
  drafts: ContentDraft[] = [];
  posts: ContentPost[] = [];
  campaigns: Campaign[] = [];
  deliverables: CampaignDeliverable[] = [];
  recordedDraftInputs: ImportContentDraftInput[] = [];
  recordedPostInputs: RecordContentPostInput[] = [];
  recordedCampaignInputs: ImportCampaignInput[] = [];
  recordedDeliverableInputs: ImportDeliverableInput[] = [];
  private nextId = 100;

  getContentDraftsForScopes(visibleScopes: string[]): ContentDraft[] {
    return this.drafts.filter((d) => visibleScopes.includes(d.scope));
  }

  getContentPostsForDraft(draftId: number): ContentPost[] {
    return this.posts.filter((p) => p.draft_id === draftId);
  }

  importContentDraft(input: ImportContentDraftInput): number {
    this.recordedDraftInputs.push(input);
    const id = this.nextId++;
    this.drafts.push(
      draft({
        id,
        scope: input.scope,
        channel: input.channel,
        title: input.title,
        body: input.body,
        status: input.status,
        scheduled_for: input.scheduledFor ?? null,
        posted_at: input.postedAt ?? null,
        external_ref: input.externalRef ?? null,
        created_at: input.createdAt,
        updated_at: input.updatedAt ?? input.createdAt,
      })
    );
    return id;
  }

  recordContentPost(input: RecordContentPostInput): number {
    this.recordedPostInputs.push(input);
    const id = this.nextId++;
    this.posts.push(
      post({
        id,
        draft_id: input.draftId,
        scope: input.scope,
        channel: input.channel,
        status: input.status,
        detail: input.detail ?? null,
        external_ref: input.externalRef ?? null,
        created_at: input.createdAt ?? new Date().toISOString(),
      })
    );
    return id;
  }

  getCampaignsForScopes(visibleScopes: string[]): Campaign[] {
    return this.campaigns.filter((c) => visibleScopes.includes(c.scope));
  }

  getDeliverablesForCampaign(campaignId: number): CampaignDeliverable[] {
    return this.deliverables.filter((d) => d.campaign_id === campaignId);
  }

  importCampaign(input: ImportCampaignInput): number {
    this.recordedCampaignInputs.push(input);
    const id = this.nextId++;
    this.campaigns.push(
      campaign({
        id,
        scope: input.scope,
        name: input.name,
        brief: input.brief ?? '',
        status: input.status,
        created_at: input.createdAt,
        updated_at: input.updatedAt ?? input.createdAt,
      })
    );
    return id;
  }

  importCampaignDeliverable(input: ImportDeliverableInput): number {
    this.recordedDeliverableInputs.push(input);
    const id = this.nextId++;
    this.deliverables.push(
      deliverable({
        id,
        campaign_id: input.campaignId,
        lane: input.lane ?? null,
        title: input.title,
        description: input.description ?? '',
        status: input.status,
        assigned_specialist: input.assignedSpecialist ?? null,
        depends_on: input.dependsOn ?? null,
        result_ref: input.resultRef ?? null,
        created_at: input.createdAt,
        updated_at: input.updatedAt ?? input.createdAt,
      })
    );
    return id;
  }
}

function writeJson(rootDir: string, filename: string, entries: unknown[]): void {
  const abs = path.join(rootDir, '.atelier', 'memory', filename);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(entries, null, 2), 'utf-8');
}

const SHARED_DRAFT = {
  channel: 'twitter',
  title: 'Launch post',
  body: 'the body text',
  status: 'posted' as const,
  scheduledFor: null,
  postedAt: '2026-01-02T00:00:00.000Z',
  externalRef: 'https://x.com/acme/status/1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  posts: [
    {
      channel: 'twitter',
      status: 'posted' as const,
      detail: 'ok',
      externalRef: 'https://x.com/acme/status/1',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ],
};

const SHARED_CAMPAIGN = {
  name: 'Launch campaign',
  brief: 'Ship it',
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deliverables: [
    {
      lane: null,
      title: 'Draft copy',
      description: '',
      status: 'done' as const,
      assignedSpecialist: null,
      dependsOnTitle: null,
      resultRef: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      lane: null,
      title: 'Review copy',
      description: '',
      status: 'pending' as const,
      assignedSpecialist: null,
      dependsOnTitle: 'Draft copy',
      resultRef: null,
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
  ],
};

describe('importContentDraftsFromBrain', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('inserts a draft + its nested posts from content-drafts.json into the correct client scope', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [SHARED_DRAFT]);

    const memory = new FakeContentMemory();
    const result = importContentDraftsFromBrain(memory, 'client:acme');

    expect(result).toEqual({ drafts: 1, posts: 1 });
    expect(memory.drafts).toHaveLength(1);
    expect(memory.drafts[0]).toMatchObject({
      scope: 'client:acme',
      channel: 'twitter',
      title: 'Launch post',
      status: 'posted',
      external_ref: 'https://x.com/acme/status/1',
    });
    expect(memory.posts).toHaveLength(1);
    expect(memory.posts[0]).toMatchObject({
      draft_id: memory.drafts[0].id,
      status: 'posted',
      external_ref: 'https://x.com/acme/status/1',
    });
  });

  it('never sets a local id from an imported row (draftId/campaignId are always freshly assigned)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [SHARED_DRAFT]);

    const memory = new FakeContentMemory();
    importContentDraftsFromBrain(memory, 'client:acme');

    expect(memory.recordedPostInputs[0].draftId).toBe(memory.drafts[0].id);
  });

  it('is idempotent — importing the same file twice does not duplicate drafts or posts', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [SHARED_DRAFT]);

    const memory = new FakeContentMemory();
    const firstRun = importContentDraftsFromBrain(memory, 'client:acme');
    const secondRun = importContentDraftsFromBrain(memory, 'client:acme');

    expect(firstRun).toEqual({ drafts: 1, posts: 1 });
    expect(secondRun).toEqual({ drafts: 0, posts: 0 });
    expect(memory.drafts).toHaveLength(1);
    expect(memory.posts).toHaveLength(1);
  });

  it('is idempotent even when a post has a malformed status (dedupe key uses the NORMALIZED status, not the raw exported value)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [
      { ...SHARED_DRAFT, posts: [{ ...SHARED_DRAFT.posts[0], status: 'not-a-real-status' }] },
    ]);

    const memory = new FakeContentMemory();
    const firstRun = importContentDraftsFromBrain(memory, 'client:acme');
    const secondRun = importContentDraftsFromBrain(memory, 'client:acme');

    expect(firstRun.posts).toBe(1);
    expect(secondRun.posts).toBe(0); // must find its own previously-imported row, not duplicate it
    expect(memory.posts).toHaveLength(1);
    expect(memory.posts[0].status).toBe('dry_run'); // normalized fallback
  });

  it("never overwrites/clobbers an operator's own existing local draft for the same key", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    // Shared file has a different body than the operator's own already-edited local draft.
    writeJson(p.rootDir, 'content-drafts.json', [{ ...SHARED_DRAFT, body: 'imported body', posts: [] }]);

    const memory = new FakeContentMemory();
    // The operator already has a local draft at the exact same (channel, title, createdAt) key.
    memory.drafts.push(
      draft({
        id: 5,
        scope: 'client:acme',
        channel: SHARED_DRAFT.channel,
        title: SHARED_DRAFT.title,
        body: 'my own locally-edited body',
        status: 'approved',
        created_at: SHARED_DRAFT.createdAt,
      })
    );

    const result = importContentDraftsFromBrain(memory, 'client:acme');

    expect(result.drafts).toBe(0);
    expect(memory.drafts).toHaveLength(1);
    expect(memory.drafts[0].body).toBe('my own locally-edited body'); // untouched
    expect(memory.drafts[0].status).toBe('approved'); // untouched
  });

  it("still appends missing posts under an existing local draft (append-only sub-merge)", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [SHARED_DRAFT]);

    const memory = new FakeContentMemory();
    // Local draft already exists (same key) but has none of the shared file's posts yet.
    memory.drafts.push(
      draft({
        id: 5,
        scope: 'client:acme',
        channel: SHARED_DRAFT.channel,
        title: SHARED_DRAFT.title,
        body: 'my own locally-edited body',
        status: 'approved',
        created_at: SHARED_DRAFT.createdAt,
      })
    );

    const result = importContentDraftsFromBrain(memory, 'client:acme');

    expect(result.drafts).toBe(0); // draft row itself untouched
    expect(result.posts).toBe(1); // but its post got appended
    expect(memory.posts).toHaveLength(1);
    expect(memory.posts[0].draft_id).toBe(5);
    expect(memory.drafts[0].body).toBe('my own locally-edited body'); // still untouched
  });

  it('never imports into another scope (e.g. never leaks into a different client)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [SHARED_DRAFT]);

    const memory = new FakeContentMemory();
    importContentDraftsFromBrain(memory, 'client:acme');

    expect(memory.drafts.every((d) => d.scope === 'client:acme')).toBe(true);
    expect(memory.getContentDraftsForScopes(['client:other'])).toEqual([]);
  });

  it('is a no-op for scopes without a repo (project/personal)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory = new FakeContentMemory();
    expect(importContentDraftsFromBrain(memory, 'project:acme-site')).toEqual({ drafts: 0, posts: 0 });
    expect(importContentDraftsFromBrain(memory, 'user')).toEqual({ drafts: 0, posts: 0 });
    expect(memory.drafts).toEqual([]);
  });

  it('is a no-op when content-drafts.json is missing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    clientPaths('acme');
    const memory = new FakeContentMemory();
    expect(importContentDraftsFromBrain(memory, 'client:acme')).toEqual({ drafts: 0, posts: 0 });
  });

  it('is a no-op when content-drafts.json is malformed JSON', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    const abs = path.join(p.rootDir, '.atelier', 'memory', 'content-drafts.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ not valid json', 'utf-8');
    const memory = new FakeContentMemory();
    expect(importContentDraftsFromBrain(memory, 'client:acme')).toEqual({ drafts: 0, posts: 0 });
  });

  it('skips entries missing required fields but still imports the valid ones', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [
      SHARED_DRAFT,
      { channel: 'twitter' }, // missing title/body/createdAt — invalid
      { title: 'no channel' }, // missing channel/body/createdAt — invalid
    ]);

    const memory = new FakeContentMemory();
    const result = importContentDraftsFromBrain(memory, 'client:acme');
    expect(result.drafts).toBe(1);
  });

  it('normalizes an unexpected status value to "draft" instead of throwing (hand-edited/future-format file)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [{ ...SHARED_DRAFT, status: 'not-a-real-status', posts: [] }]);

    const memory = new FakeContentMemory();
    const result = importContentDraftsFromBrain(memory, 'client:acme');

    expect(result.drafts).toBe(1);
    expect(memory.drafts[0].status).toBe('draft');
  });

  it('one malformed draft never blocks the rest of the batch from importing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [
      SHARED_DRAFT,
      { ...SHARED_DRAFT, title: 'Second post', createdAt: '2026-01-03T00:00:00.000Z', posts: [] },
    ]);

    const memory = new FakeContentMemory();
    let call = 0;
    const originalImport = memory.importContentDraft.bind(memory);
    memory.importContentDraft = (input) => {
      call++;
      if (call === 1) throw new Error('simulated DB constraint failure');
      return originalImport(input);
    };

    const result = importContentDraftsFromBrain(memory, 'client:acme');
    expect(result.drafts).toBe(1); // first row failed, second still landed
    expect(memory.drafts).toHaveLength(1);
    expect(memory.drafts[0].title).toBe('Second post');
  });

  it('imports world-scope drafts from the world root', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
    writeJson(getWorldRoot(), 'content-drafts.json', [{ ...SHARED_DRAFT, title: 'Agency-wide post', posts: [] }]);

    const memory = new FakeContentMemory();
    const result = importContentDraftsFromBrain(memory, 'world');
    expect(result.drafts).toBe(1);
    expect(memory.drafts[0]).toMatchObject({ scope: 'world', title: 'Agency-wide post' });
  });
});

describe('importCampaignsFromBrain', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('inserts a campaign + its nested deliverables, resolving dependsOnTitle to a local id', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [SHARED_CAMPAIGN]);

    const memory = new FakeContentMemory();
    const result = importCampaignsFromBrain(memory, 'client:acme');

    expect(result).toEqual({ campaigns: 1, deliverables: 2 });
    const [draftCopy, reviewCopy] = memory.deliverables;
    expect(draftCopy).toMatchObject({ title: 'Draft copy', status: 'done', depends_on: null });
    expect(reviewCopy).toMatchObject({ title: 'Review copy', status: 'pending', depends_on: draftCopy.id });
  });

  it('imports a deliverable with no dependency (never crashes) when dependsOnTitle is unresolvable', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [
      {
        ...SHARED_CAMPAIGN,
        deliverables: [
          {
            lane: null,
            title: 'Orphan deliverable',
            description: '',
            status: 'pending',
            assignedSpecialist: null,
            dependsOnTitle: 'Nonexistent deliverable',
            resultRef: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);

    const memory = new FakeContentMemory();
    const result = importCampaignsFromBrain(memory, 'client:acme');

    expect(result).toEqual({ campaigns: 1, deliverables: 1 });
    expect(memory.deliverables[0]).toMatchObject({ title: 'Orphan deliverable', depends_on: null });
  });

  it('is idempotent — importing the same file twice does not duplicate campaigns or deliverables', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [SHARED_CAMPAIGN]);

    const memory = new FakeContentMemory();
    const firstRun = importCampaignsFromBrain(memory, 'client:acme');
    const secondRun = importCampaignsFromBrain(memory, 'client:acme');

    expect(firstRun).toEqual({ campaigns: 1, deliverables: 2 });
    expect(secondRun).toEqual({ campaigns: 0, deliverables: 0 });
    expect(memory.campaigns).toHaveLength(1);
    expect(memory.deliverables).toHaveLength(2);
  });

  it("never overwrites/clobbers an operator's own existing local campaign for the same key", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [{ ...SHARED_CAMPAIGN, brief: 'imported brief', deliverables: [] }]);

    const memory = new FakeContentMemory();
    memory.campaigns.push(
      campaign({
        id: 5,
        scope: 'client:acme',
        name: SHARED_CAMPAIGN.name,
        brief: 'my own locally-edited brief',
        status: 'paused',
        created_at: SHARED_CAMPAIGN.createdAt,
      })
    );

    const result = importCampaignsFromBrain(memory, 'client:acme');

    expect(result.campaigns).toBe(0);
    expect(memory.campaigns).toHaveLength(1);
    expect(memory.campaigns[0].brief).toBe('my own locally-edited brief');
    expect(memory.campaigns[0].status).toBe('paused');
  });

  it('still appends missing deliverables under an existing local campaign (append-only sub-merge)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [SHARED_CAMPAIGN]);

    const memory = new FakeContentMemory();
    memory.campaigns.push(
      campaign({
        id: 5,
        scope: 'client:acme',
        name: SHARED_CAMPAIGN.name,
        brief: 'my own locally-edited brief',
        created_at: SHARED_CAMPAIGN.createdAt,
      })
    );

    const result = importCampaignsFromBrain(memory, 'client:acme');

    expect(result.campaigns).toBe(0); // campaign row itself untouched
    expect(result.deliverables).toBe(2); // both deliverables appended
    expect(memory.deliverables.every((d) => d.campaign_id === 5)).toBe(true);
    expect(memory.campaigns[0].brief).toBe('my own locally-edited brief');
  });

  it('never imports into another scope', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [SHARED_CAMPAIGN]);

    const memory = new FakeContentMemory();
    importCampaignsFromBrain(memory, 'client:acme');

    expect(memory.campaigns.every((c) => c.scope === 'client:acme')).toBe(true);
    expect(memory.getCampaignsForScopes(['client:other'])).toEqual([]);
  });

  it('is a no-op for scopes without a repo (project/personal)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory = new FakeContentMemory();
    expect(importCampaignsFromBrain(memory, 'project:acme-site')).toEqual({ campaigns: 0, deliverables: 0 });
    expect(importCampaignsFromBrain(memory, 'user')).toEqual({ campaigns: 0, deliverables: 0 });
  });

  it('is a no-op when campaigns.json is missing or malformed', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    const memory = new FakeContentMemory();
    expect(importCampaignsFromBrain(memory, 'client:acme')).toEqual({ campaigns: 0, deliverables: 0 });

    const abs = path.join(p.rootDir, '.atelier', 'memory', 'campaigns.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'not json at all', 'utf-8');
    expect(importCampaignsFromBrain(memory, 'client:acme')).toEqual({ campaigns: 0, deliverables: 0 });
  });

  it('normalizes an unexpected status value instead of throwing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [{ ...SHARED_CAMPAIGN, status: 'not-a-real-status', deliverables: [] }]);

    const memory = new FakeContentMemory();
    const result = importCampaignsFromBrain(memory, 'client:acme');
    expect(result.campaigns).toBe(1);
    expect(memory.campaigns[0].status).toBe('active');
  });

  it('one malformed campaign never blocks the rest of the batch from importing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'campaigns.json', [
      SHARED_CAMPAIGN,
      { ...SHARED_CAMPAIGN, name: 'Second campaign', createdAt: '2026-01-05T00:00:00.000Z', deliverables: [] },
    ]);

    const memory = new FakeContentMemory();
    let call = 0;
    const originalImport = memory.importCampaign.bind(memory);
    memory.importCampaign = (input) => {
      call++;
      if (call === 1) throw new Error('simulated DB constraint failure');
      return originalImport(input);
    };

    const result = importCampaignsFromBrain(memory, 'client:acme');
    expect(result.campaigns).toBe(1);
    expect(memory.campaigns).toHaveLength(1);
    expect(memory.campaigns[0].name).toBe('Second campaign');
  });

  it('imports world-scope campaigns from the world root', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
    writeJson(getWorldRoot(), 'campaigns.json', [{ ...SHARED_CAMPAIGN, name: 'Agency-wide campaign', deliverables: [] }]);

    const memory = new FakeContentMemory();
    const result = importCampaignsFromBrain(memory, 'world');
    expect(result.campaigns).toBe(1);
    expect(memory.campaigns[0]).toMatchObject({ scope: 'world', name: 'Agency-wide campaign' });
  });
});

describe('importContentFromBrain (combined orchestrator)', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('imports both drafts/posts and campaigns/deliverables in one call', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-import-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const p = clientPaths('acme');
    writeJson(p.rootDir, 'content-drafts.json', [SHARED_DRAFT]);
    writeJson(p.rootDir, 'campaigns.json', [SHARED_CAMPAIGN]);

    const memory = new FakeContentMemory();
    const result = importContentFromBrain(memory, 'client:acme');

    expect(result).toEqual({ drafts: 1, posts: 1, campaigns: 1, deliverables: 2 });
    expect(memory.drafts).toHaveLength(1);
    expect(memory.campaigns).toHaveLength(1);
  });
});
