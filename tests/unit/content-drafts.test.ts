/**
 * Content workflow data model (roadmap item 6): status transitions and scope
 * isolation. Pure DB-layer tests against a real in-memory MemoryManager, same
 * pattern as scoped-memory.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { canTransition } from '../../src/memory/content-drafts';
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
describe('canTransition — status state machine', () => {
  it('allows draft -> pending_approval by an agent', () => {
    expect(canTransition('draft', 'pending_approval', 'agent').ok).toBe(true);
  });

  it('rejects an agent transitioning into approved', () => {
    const result = canTransition('pending_approval', 'approved', 'agent');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/human/i);
  });

  it('rejects an agent transitioning into rejected', () => {
    const result = canTransition('pending_approval', 'rejected', 'agent');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/human/i);
  });

  it('allows a human to approve a pending draft', () => {
    expect(canTransition('pending_approval', 'approved', 'human').ok).toBe(true);
  });

  it('allows a human to reject a pending draft', () => {
    expect(canTransition('pending_approval', 'rejected', 'human').ok).toBe(true);
  });

  it('rejects posting directly from draft (must go through approval)', () => {
    expect(canTransition('draft', 'posted', 'agent').ok).toBe(false);
    expect(canTransition('draft', 'posted', 'human').ok).toBe(false);
  });

  it('rejects posting from pending_approval (must be approved first)', () => {
    expect(canTransition('pending_approval', 'posted', 'agent').ok).toBe(false);
  });

  it('allows approved -> posted', () => {
    expect(canTransition('approved', 'posted', 'agent').ok).toBe(true);
  });

  it('allows approved -> scheduled', () => {
    expect(canTransition('approved', 'scheduled', 'agent').ok).toBe(true);
  });

  it('allows scheduled -> posted', () => {
    expect(canTransition('scheduled', 'posted', 'agent').ok).toBe(true);
  });

  it('rejects an already-posted draft transitioning anywhere', () => {
    expect(canTransition('posted', 'draft', 'human').ok).toBe(false);
    expect(canTransition('posted', 'approved', 'human').ok).toBe(false);
  });

  it('allows a rejected draft to be reworked back to draft', () => {
    expect(canTransition('rejected', 'draft', 'human').ok).toBe(true);
  });

  it('allows a human to cancel (reject) an approved draft directly', () => {
    expect(canTransition('approved', 'rejected', 'human').ok).toBe(true);
  });

  it('allows a human to cancel (reject) an already-scheduled draft directly', () => {
    expect(canTransition('scheduled', 'rejected', 'human').ok).toBe(true);
  });

  it('rejects an agent canceling an approved/scheduled draft (still human-only)', () => {
    expect(canTransition('approved', 'rejected', 'agent').ok).toBe(false);
    expect(canTransition('scheduled', 'rejected', 'agent').ok).toBe(false);
  });
});

// ── MemoryManager-level: status enforcement + scope isolation ──────────────
describe('MemoryManager content drafts — status transitions enforced', () => {
  let memory: import('../../src/memory/index').MemoryManager;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
  });

  it('a new draft starts in status "draft"', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    const draft = memory.getContentDraft(id);
    expect(draft!.status).toBe('draft');
  });

  it('cannot post an unapproved (draft) item — setContentDraftStatus rejects it', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    const result = memory.setContentDraftStatus(id, 'posted', 'agent');
    expect(result.ok).toBe(false);
    expect(memory.getContentDraft(id)!.status).toBe('draft');
  });

  it('cannot post a pending_approval item — still not approved', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    const result = memory.setContentDraftStatus(id, 'posted', 'agent');
    expect(result.ok).toBe(false);
    expect(memory.getContentDraft(id)!.status).toBe('pending_approval');
  });

  it('an agent cannot approve its own submitted draft', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    const result = memory.setContentDraftStatus(id, 'approved', 'agent');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/human/i);
    expect(memory.getContentDraft(id)!.status).toBe('pending_approval');
  });

  it('a human can approve, then the draft can be posted', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    const approve = memory.setContentDraftStatus(id, 'approved', 'human');
    expect(approve.ok).toBe(true);
    const post = memory.setContentDraftStatus(id, 'posted', 'agent');
    expect(post.ok).toBe(true);
    expect(memory.getContentDraft(id)!.status).toBe('posted');
  });

  it('editing is rejected once a draft leaves draft/rejected status', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    const result = memory.updateContentDraft(id, { body: 'sneaky edit' });
    expect(result.ok).toBe(false);
    expect(memory.getContentDraft(id)!.body).toBe('hello');
  });

  it('editing a rejected draft resets it to draft status', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'hello' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    memory.setContentDraftStatus(id, 'rejected', 'human');
    const result = memory.updateContentDraft(id, { body: 'reworked' });
    expect(result.ok).toBe(true);
    const draft = memory.getContentDraft(id)!;
    expect(draft.status).toBe('draft');
    expect(draft.body).toBe('reworked');
  });
});

describe('MemoryManager content drafts — scope isolation', () => {
  let memory: import('../../src/memory/index').MemoryManager;

  beforeEach(async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    memory = new MemoryManager(':memory:');
  });

  it("brand A's queue never shows brand B's drafts", () => {
    memory.createContentDraft({ scope: clientScope('brandA'), channel: 'twitter', body: 'A post' });
    memory.createContentDraft({ scope: clientScope('brandB'), channel: 'twitter', body: 'B post' });

    const visibleForA = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const draftsForA = memory.getContentDraftsForScopes(visibleForA);
    expect(draftsForA).toHaveLength(1);
    expect(draftsForA[0].body).toBe('A post');
  });

  it('personal context never sees any brand drafts', () => {
    memory.createContentDraft({ scope: clientScope('brandA'), channel: 'twitter', body: 'A post' });
    memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'personal post' });

    const visiblePersonal = resolveVisibleScopes(
      { contextType: 'personal', clientId: null, projectKey: null },
      'S'
    );
    const drafts = memory.getContentDraftsForScopes(visiblePersonal);
    expect(drafts.map((d) => d.body)).toEqual(['personal post']);
  });

  it('an empty visible-scope list returns nothing (never falls through unfiltered)', () => {
    memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    expect(memory.getContentDraftsForScopes([])).toEqual([]);
  });

  it('post history is also scope-isolated', () => {
    const idA = memory.createContentDraft({ scope: clientScope('brandA'), channel: 'x', body: 'a' });
    const idB = memory.createContentDraft({ scope: clientScope('brandB'), channel: 'x', body: 'b' });
    memory.recordContentPost({ draftId: idA, scope: clientScope('brandA'), channel: 'x', status: 'posted' });
    memory.recordContentPost({ draftId: idB, scope: clientScope('brandB'), channel: 'x', status: 'posted' });

    const visibleForA = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const historyForA = memory.getContentPostsForScopes(visibleForA);
    expect(historyForA).toHaveLength(1);
    expect(historyForA[0].draft_id).toBe(idA);
  });

  it('a client sees its own drafts plus world (agency-wide) drafts, never another client', () => {
    memory.createContentDraft({ scope: 'world', channel: 'blog', body: 'agency-wide announcement' });
    memory.createContentDraft({ scope: clientScope('brandA'), channel: 'blog', body: 'brand A post' });
    memory.createContentDraft({ scope: clientScope('brandB'), channel: 'blog', body: 'brand B post' });

    const visibleForA = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const bodies = memory.getContentDraftsForScopes(visibleForA).map((d) => d.body);
    expect(bodies).toContain('agency-wide announcement');
    expect(bodies).toContain('brand A post');
    expect(bodies).not.toContain('brand B post');
  });
});
