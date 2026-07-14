/**
 * Campaign / plan data model (roadmap item 10): status transitions,
 * dependency enforcement, CRUD, and scope isolation. Pure logic tests
 * (canTransitionDeliverable / canStartDeliverable) plus MemoryManager-level
 * tests against a real in-memory DB, same pattern as content-drafts.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canTransitionDeliverable,
  canStartDeliverable,
  contentDraftIdFromResultRef,
} from '../../src/memory/campaigns';
import { clientScope, resolveVisibleScopes } from '../../src/memory/scope';

// Stub only the async embedding writes so MemoryManager needs no embedding model.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

// ── Pure transition-table tests ─────────────────────────────────────────────
describe('canTransitionDeliverable — status state machine', () => {
  it('allows pending -> in_progress', () => {
    expect(canTransitionDeliverable('pending', 'in_progress').ok).toBe(true);
  });

  it('allows pending -> blocked', () => {
    expect(canTransitionDeliverable('pending', 'blocked').ok).toBe(true);
  });

  it('allows in_progress -> review, done, blocked, pending', () => {
    expect(canTransitionDeliverable('in_progress', 'review').ok).toBe(true);
    expect(canTransitionDeliverable('in_progress', 'done').ok).toBe(true);
    expect(canTransitionDeliverable('in_progress', 'blocked').ok).toBe(true);
    expect(canTransitionDeliverable('in_progress', 'pending').ok).toBe(true);
  });

  it('allows review -> done, in_progress (revision), blocked', () => {
    expect(canTransitionDeliverable('review', 'done').ok).toBe(true);
    expect(canTransitionDeliverable('review', 'in_progress').ok).toBe(true);
    expect(canTransitionDeliverable('review', 'blocked').ok).toBe(true);
  });

  it('allows done -> review (reopen) only', () => {
    expect(canTransitionDeliverable('done', 'review').ok).toBe(true);
    expect(canTransitionDeliverable('done', 'pending').ok).toBe(false);
    expect(canTransitionDeliverable('done', 'in_progress').ok).toBe(false);
  });

  it('allows blocked -> pending, in_progress', () => {
    expect(canTransitionDeliverable('blocked', 'pending').ok).toBe(true);
    expect(canTransitionDeliverable('blocked', 'in_progress').ok).toBe(true);
  });

  it('rejects pending -> done (must go through in_progress/review)', () => {
    const result = canTransitionDeliverable('pending', 'done');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects pending -> review', () => {
    expect(canTransitionDeliverable('pending', 'review').ok).toBe(false);
  });
});

// ── Pure dependency enforcement tests ───────────────────────────────────────
describe('canStartDeliverable — dependency gate', () => {
  it('allows starting a deliverable with no dependency', () => {
    expect(canStartDeliverable(null).ok).toBe(true);
  });

  it('allows starting when the dependency is done', () => {
    expect(canStartDeliverable({ id: 1, status: 'done' }).ok).toBe(true);
  });

  it('rejects starting when the dependency is pending', () => {
    const result = canStartDeliverable({ id: 1, status: 'pending' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/depends on #1/);
    expect(result.error).toMatch(/pending/);
  });

  it('rejects starting when the dependency is in_progress', () => {
    expect(canStartDeliverable({ id: 2, status: 'in_progress' }).ok).toBe(false);
  });

  it('rejects starting when the dependency is blocked', () => {
    expect(canStartDeliverable({ id: 3, status: 'blocked' }).ok).toBe(false);
  });

  it('rejects starting when the dependency is in review (not yet done)', () => {
    expect(canStartDeliverable({ id: 4, status: 'review' }).ok).toBe(false);
  });
});

// ── MemoryManager-level: CRUD, dependency enforcement, scope isolation ──────
describe('MemoryManager campaigns — CRUD', () => {
  let memory: import('../../src/memory/index').MemoryManager;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
  });

  it('creates a campaign with status "active" by default', () => {
    const id = memory.createCampaign({ scope: 'user', name: 'Q3 Launch', brief: 'Ship the thing' });
    const campaign = memory.getCampaign(id);
    expect(campaign).toMatchObject({ name: 'Q3 Launch', brief: 'Ship the thing', status: 'active' });
  });

  it('updates campaign fields', () => {
    const id = memory.createCampaign({ scope: 'user', name: 'Q3 Launch' });
    const ok = memory.updateCampaign(id, { status: 'paused', brief: 'On hold' });
    expect(ok).toBe(true);
    const campaign = memory.getCampaign(id);
    expect(campaign?.status).toBe('paused');
    expect(campaign?.brief).toBe('On hold');
  });

  it('deletes a campaign and its deliverables', () => {
    const id = memory.createCampaign({ scope: 'user', name: 'Q3 Launch' });
    memory.addDeliverable({ campaignId: id, title: 'Write blog post' });
    expect(memory.getDeliverablesForCampaign(id)).toHaveLength(1);

    const deleted = memory.deleteCampaign(id);
    expect(deleted).toBe(true);
    expect(memory.getCampaign(id)).toBeNull();
    expect(memory.getDeliverablesForCampaign(id)).toEqual([]);
  });

  it('returns null for a missing campaign', () => {
    expect(memory.getCampaign(999999)).toBeNull();
  });
});

describe('MemoryManager campaigns — deliverable CRUD', () => {
  let memory: import('../../src/memory/index').MemoryManager;
  let campaignId: number;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
    campaignId = memory.createCampaign({ scope: 'user', name: 'Q3 Launch' });
  });

  it('adds a deliverable in "pending" status', () => {
    const result = memory.addDeliverable({ campaignId, title: 'Write blog post', lane: 'brand' });
    expect(result.ok).toBe(true);
    const deliverable = memory.getDeliverable(result.id!);
    expect(deliverable).toMatchObject({ title: 'Write blog post', lane: 'brand', status: 'pending' });
  });

  it('refuses to add a deliverable to a nonexistent campaign', () => {
    const result = memory.addDeliverable({ campaignId: 999999, title: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('refuses a dependsOn pointing at a deliverable in a DIFFERENT campaign', () => {
    const otherCampaignId = memory.createCampaign({ scope: 'user', name: 'Other Campaign' });
    const otherDeliverable = memory.addDeliverable({ campaignId: otherCampaignId, title: 'Other work' });

    const result = memory.addDeliverable({
      campaignId,
      title: 'Depends on other campaign',
      dependsOn: otherDeliverable.id,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/different campaign/);
  });

  it('refuses a dependsOn pointing at a nonexistent deliverable', () => {
    const result = memory.addDeliverable({ campaignId, title: 'x', dependsOn: 999999 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('accepts a valid same-campaign dependsOn', () => {
    const first = memory.addDeliverable({ campaignId, title: 'Research' });
    const second = memory.addDeliverable({ campaignId, title: 'Write', dependsOn: first.id });
    expect(second.ok).toBe(true);
    expect(memory.getDeliverable(second.id!)?.depends_on).toBe(first.id);
  });

  it('lists deliverables for a campaign in creation order', () => {
    memory.addDeliverable({ campaignId, title: 'First' });
    memory.addDeliverable({ campaignId, title: 'Second' });
    const list = memory.getDeliverablesForCampaign(campaignId);
    expect(list.map((d) => d.title)).toEqual(['First', 'Second']);
  });

  it('deletes a single deliverable', () => {
    const result = memory.addDeliverable({ campaignId, title: 'x' });
    expect(memory.deleteDeliverable(result.id!)).toBe(true);
    expect(memory.getDeliverable(result.id!)).toBeNull();
  });
});

describe('MemoryManager campaigns — dependency enforcement (setDeliverableStatus)', () => {
  let memory: import('../../src/memory/index').MemoryManager;
  let campaignId: number;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
    campaignId = memory.createCampaign({ scope: 'user', name: 'Q3 Launch' });
  });

  it('cannot move to in_progress while its dependency is not done', () => {
    const dep = memory.addDeliverable({ campaignId, title: 'Research' });
    const dependent = memory.addDeliverable({ campaignId, title: 'Write', dependsOn: dep.id });

    const result = memory.setDeliverableStatus(dependent.id!, 'in_progress');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/depends on/);
    expect(memory.getDeliverable(dependent.id!)?.status).toBe('pending');
  });

  it('CAN move to in_progress once the dependency is done', () => {
    const dep = memory.addDeliverable({ campaignId, title: 'Research' });
    const dependent = memory.addDeliverable({ campaignId, title: 'Write', dependsOn: dep.id });

    memory.setDeliverableStatus(dep.id!, 'in_progress');
    memory.setDeliverableStatus(dep.id!, 'review');
    const depDone = memory.setDeliverableStatus(dep.id!, 'done');
    expect(depDone.ok).toBe(true);

    const result = memory.setDeliverableStatus(dependent.id!, 'in_progress');
    expect(result.ok).toBe(true);
    expect(memory.getDeliverable(dependent.id!)?.status).toBe('in_progress');
  });

  it('a deliverable with no dependency can move to in_progress immediately', () => {
    const solo = memory.addDeliverable({ campaignId, title: 'Standalone task' });
    const result = memory.setDeliverableStatus(solo.id!, 'in_progress');
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid status-graph transition regardless of dependency state', () => {
    const solo = memory.addDeliverable({ campaignId, title: 'Standalone task' });
    // pending -> done is not a valid direct transition (status graph rule).
    const result = memory.setDeliverableStatus(solo.id!, 'done');
    expect(result.ok).toBe(false);
  });

  it('setDeliverableStatus with a missing deliverable id fails cleanly', () => {
    const result = memory.setDeliverableStatus(999999, 'in_progress');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('sets result_ref alongside a status transition', () => {
    const solo = memory.addDeliverable({ campaignId, title: 'Write copy' });
    memory.setDeliverableStatus(solo.id!, 'in_progress');
    const result = memory.setDeliverableStatus(solo.id!, 'review', 'Draft is ready for review');
    expect(result.ok).toBe(true);
    expect(memory.getDeliverable(solo.id!)?.result_ref).toBe('Draft is ready for review');
  });
});

describe('MemoryManager campaigns — content-draft linking (roadmap item 10, requirement 3)', () => {
  it('sets result_ref to the content_draft:<id> convention', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    const campaignId = memory.createCampaign({ scope: 'user', name: 'Social push' });
    const deliverable = memory.addDeliverable({ campaignId, title: 'Write tweet', lane: 'social' });

    const draftId = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'Big news!' });
    const link = memory.linkDeliverableToContentDraft(deliverable.id!, draftId);
    expect(link.ok).toBe(true);
    expect(memory.getDeliverable(deliverable.id!)?.result_ref).toBe(`content_draft:${draftId}`);
    memory.close();
  });

  it('fails cleanly for a missing deliverable', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    const result = memory.linkDeliverableToContentDraft(999999, 1);
    expect(result.ok).toBe(false);
    memory.close();
  });
});

describe('MemoryManager campaigns — getNextUnblockedDeliverable', () => {
  let memory: import('../../src/memory/index').MemoryManager;
  let campaignId: number;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
    campaignId = memory.createCampaign({ scope: 'user', name: 'Q3 Launch' });
  });

  it('returns null for a campaign with no deliverables', () => {
    expect(memory.getNextUnblockedDeliverable(campaignId)).toBeNull();
  });

  it('returns a pending deliverable with no dependency', () => {
    const d = memory.addDeliverable({ campaignId, title: 'Standalone' });
    const next = memory.getNextUnblockedDeliverable(campaignId);
    expect(next?.id).toBe(d.id);
  });

  it('skips a pending deliverable whose dependency is not done', () => {
    const dep = memory.addDeliverable({ campaignId, title: 'Research' });
    memory.addDeliverable({ campaignId, title: 'Write', dependsOn: dep.id });
    // dep itself is pending and unblocked -> it's the next one, not "Write".
    const next = memory.getNextUnblockedDeliverable(campaignId);
    expect(next?.title).toBe('Research');
  });

  it('surfaces the dependent once its dependency is done', () => {
    const dep = memory.addDeliverable({ campaignId, title: 'Research' });
    const dependent = memory.addDeliverable({ campaignId, title: 'Write', dependsOn: dep.id });
    memory.setDeliverableStatus(dep.id!, 'in_progress');
    memory.setDeliverableStatus(dep.id!, 'review');
    memory.setDeliverableStatus(dep.id!, 'done');

    const next = memory.getNextUnblockedDeliverable(campaignId);
    expect(next?.id).toBe(dependent.id);
  });

  it('returns null when every deliverable is already in progress/done/blocked', () => {
    const d = memory.addDeliverable({ campaignId, title: 'Only task' });
    memory.setDeliverableStatus(d.id!, 'in_progress');
    expect(memory.getNextUnblockedDeliverable(campaignId)).toBeNull();
  });
});

describe('MemoryManager campaigns — scope isolation', () => {
  let memory: import('../../src/memory/index').MemoryManager;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
  });

  it("brand A's campaign list never shows brand B's campaigns", () => {
    memory.createCampaign({ scope: clientScope('brandA'), name: 'A Campaign' });
    memory.createCampaign({ scope: clientScope('brandB'), name: 'B Campaign' });

    const visibleForA = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const campaignsForA = memory.getCampaignsForScopes(visibleForA);
    expect(campaignsForA).toHaveLength(1);
    expect(campaignsForA[0].name).toBe('A Campaign');
  });

  it('personal context never sees any brand campaigns', () => {
    memory.createCampaign({ scope: clientScope('brandA'), name: 'A Campaign' });
    memory.createCampaign({ scope: 'user', name: 'Personal Campaign' });

    const visiblePersonal = resolveVisibleScopes(
      { contextType: 'personal', clientId: null, projectKey: null },
      'S'
    );
    const campaigns = memory.getCampaignsForScopes(visiblePersonal);
    expect(campaigns.map((c) => c.name)).toEqual(['Personal Campaign']);
  });

  it('an empty visible-scope list returns nothing (never falls through unfiltered)', () => {
    memory.createCampaign({ scope: 'user', name: 'x' });
    expect(memory.getCampaignsForScopes([])).toEqual([]);
  });

  it('a client sees its own campaigns plus world (agency-wide), never another client', () => {
    memory.createCampaign({ scope: 'world', name: 'Agency-wide initiative' });
    memory.createCampaign({ scope: clientScope('brandA'), name: 'Brand A campaign' });
    memory.createCampaign({ scope: clientScope('brandB'), name: 'Brand B campaign' });

    const visibleForA = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const names = memory.getCampaignsForScopes(visibleForA).map((c) => c.name);
    expect(names).toContain('Agency-wide initiative');
    expect(names).toContain('Brand A campaign');
    expect(names).not.toContain('Brand B campaign');
  });
});

// ── contentDraftIdFromResultRef (pure) ─────────────────────────────────────
describe('contentDraftIdFromResultRef', () => {
  it('extracts the id from a well-formed content_draft:<id> ref', () => {
    expect(contentDraftIdFromResultRef('content_draft:42')).toBe(42);
  });

  it('returns null for a plain summary string', () => {
    expect(contentDraftIdFromResultRef('shipped the launch post manually')).toBeNull();
  });

  it('returns null for null/undefined/empty', () => {
    expect(contentDraftIdFromResultRef(null)).toBeNull();
    expect(contentDraftIdFromResultRef(undefined)).toBeNull();
    expect(contentDraftIdFromResultRef('')).toBeNull();
  });

  it('returns null for a near-miss format (no match, never partially parses)', () => {
    expect(contentDraftIdFromResultRef('content_draft:abc')).toBeNull();
    expect(contentDraftIdFromResultRef('content_draft:')).toBeNull();
    expect(contentDraftIdFromResultRef('draft:42')).toBeNull();
  });
});

// ── MemoryManager.getCampaignAnalytics (campaign -> content -> analytics join) ──
describe('MemoryManager.getCampaignAnalytics', () => {
  let memory: import('../../src/memory/index').MemoryManager;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
  });

  it('returns an empty summary and no posts for a campaign with no linked content', () => {
    const campaignId = memory.createCampaign({ scope: clientScope('acme'), name: 'No content yet' });
    const result = memory.getCampaignAnalytics(campaignId);
    expect(result.posts).toEqual([]);
    expect(result.summary.totalPosts).toBe(0);
  });

  it('returns no posts when linked content exists but has no analytics recorded yet', () => {
    const campaignId = memory.createCampaign({ scope: clientScope('acme'), name: 'Campaign' });
    const draftId = memory.createContentDraft({ scope: clientScope('acme'), channel: 'twitter', body: 'hello' });
    const added = memory.addDeliverable({ campaignId, title: 'Ship the post' });
    memory.linkDeliverableToContentDraft(added.id!, draftId);
    memory.recordContentPost({ draftId, scope: clientScope('acme'), channel: 'twitter', status: 'posted', externalRef: 'post-1' });

    const result = memory.getCampaignAnalytics(campaignId);
    expect(result.posts).toEqual([]);
    expect(result.summary.totalPosts).toBe(0);
  });

  it('joins campaign -> deliverable -> content draft -> content post -> analytics by content_post_id', () => {
    const campaignId = memory.createCampaign({ scope: clientScope('acme'), name: 'Campaign' });
    const draftId = memory.createContentDraft({ scope: clientScope('acme'), channel: 'twitter', body: 'hello' });
    const added = memory.addDeliverable({ campaignId, title: 'Ship the post' });
    memory.linkDeliverableToContentDraft(added.id!, draftId);
    const postId = memory.recordContentPost({
      draftId, scope: clientScope('acme'), channel: 'twitter', status: 'posted', externalRef: 'post-1',
    });
    memory.recordPostAnalytics({
      scope: clientScope('acme'), channel: 'twitter', externalRef: 'post-1', contentPostId: postId, impressions: 1000, likes: 50,
    });

    const result = memory.getCampaignAnalytics(campaignId);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].external_ref).toBe('post-1');
    expect(result.summary.totalPosts).toBe(1);
    expect(result.summary.impressions).toBe(1000);
  });

  it('falls back to a scope+channel+external_ref match when content_post_id was never explicitly linked', () => {
    const campaignId = memory.createCampaign({ scope: clientScope('acme'), name: 'Campaign' });
    const draftId = memory.createContentDraft({ scope: clientScope('acme'), channel: 'twitter', body: 'hello' });
    const added = memory.addDeliverable({ campaignId, title: 'Ship the post' });
    memory.linkDeliverableToContentDraft(added.id!, draftId);
    memory.recordContentPost({ draftId, scope: clientScope('acme'), channel: 'twitter', status: 'posted', externalRef: 'post-1' });
    // Analytics recorded WITHOUT a contentPostId — just the same URL pasted by hand.
    memory.recordPostAnalytics({ scope: clientScope('acme'), channel: 'twitter', externalRef: 'post-1', impressions: 500 });

    const result = memory.getCampaignAnalytics(campaignId);
    expect(result.posts).toHaveLength(1);
    expect(result.summary.impressions).toBe(500);
  });

  it('never includes analytics from a deliverable with a non-content_draft result_ref (e.g. a plain summary)', () => {
    const campaignId = memory.createCampaign({ scope: clientScope('acme'), name: 'Campaign' });
    const added = memory.addDeliverable({ campaignId, title: 'Done manually' });
    memory.setDeliverableStatus(added.id!, 'done', 'shipped it outside the app');
    memory.recordPostAnalytics({ scope: clientScope('acme'), channel: 'twitter', externalRef: 'unrelated-post', impressions: 999 });

    const result = memory.getCampaignAnalytics(campaignId);
    expect(result.posts).toEqual([]);
  });

  it('never leaks another campaign\u2019s linked-content analytics into this one\u2019s result', () => {
    const campaignA = memory.createCampaign({ scope: clientScope('acme'), name: 'Campaign A' });
    const campaignB = memory.createCampaign({ scope: clientScope('acme'), name: 'Campaign B' });
    const draftA = memory.createContentDraft({ scope: clientScope('acme'), channel: 'twitter', body: 'a' });
    const draftB = memory.createContentDraft({ scope: clientScope('acme'), channel: 'twitter', body: 'b' });
    const addedA = memory.addDeliverable({ campaignId: campaignA, title: 'A' });
    const addedB = memory.addDeliverable({ campaignId: campaignB, title: 'B' });
    memory.linkDeliverableToContentDraft(addedA.id!, draftA);
    memory.linkDeliverableToContentDraft(addedB.id!, draftB);
    const postIdA = memory.recordContentPost({ draftId: draftA, scope: clientScope('acme'), channel: 'twitter', status: 'posted', externalRef: 'post-a' });
    const postIdB = memory.recordContentPost({ draftId: draftB, scope: clientScope('acme'), channel: 'twitter', status: 'posted', externalRef: 'post-b' });
    memory.recordPostAnalytics({ scope: clientScope('acme'), channel: 'twitter', externalRef: 'post-a', contentPostId: postIdA, impressions: 100 });
    memory.recordPostAnalytics({ scope: clientScope('acme'), channel: 'twitter', externalRef: 'post-b', contentPostId: postIdB, impressions: 200 });

    const resultA = memory.getCampaignAnalytics(campaignA);
    expect(resultA.posts.map((p) => p.external_ref)).toEqual(['post-a']);
  });
});
