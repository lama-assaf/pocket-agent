import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/memory/semantic', () => ({
  embedFactAsync: vi.fn(),
  embedSoulAspectAsync: vi.fn(),
  embedRollup: vi.fn(async () => {}),
  findNearDuplicateFacts: vi.fn(() => []),
  retrieveRelevantFacts: vi.fn(() => ''),
  retrieveRelevantSoul: vi.fn(() => ''),
  retrieveRelevantRollups: vi.fn(() => ''),
  semanticSearchFacts: vi.fn(() => []),
  backfillMissingEmbeddings: vi.fn(async () => {}),
}));

import { MemoryManager } from '../../src/memory/index';
import { clientScope, resolveVisibleScopes, USER_SCOPE, WORLD_SCOPE } from '../../src/memory/scope';

describe('selectResurfaceCandidate', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager(':memory:');
  });

  it('returns null when memory is empty', () => {
    expect(memory.selectResurfaceCandidate(new Date())).toBeNull();
  });

  it('prefers the higher importance × recency-gap stale fact', () => {
    const lowId = memory.saveFact('notes', 'low', 'low importance recent');
    const highId = memory.saveFact('user_info', 'goal', 'fix sleep schedule');

    // Make both stale (>14 days untouched) but high-importance scores higher.
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    memory['db'].prepare('UPDATE facts SET importance = 10, last_accessed_at = ? WHERE id = ?').run(
      old,
      lowId
    );
    memory['db']
      .prepare('UPDATE facts SET importance = 90, last_accessed_at = ? WHERE id = ?')
      .run(old, highId);

    const candidate = memory.selectResurfaceCandidate(new Date());
    expect(candidate).not.toBeNull();
    expect(candidate!.kind).toBe('fact');
    if (candidate!.kind === 'fact') {
      expect(candidate!.factId).toBe(highId);
    }
  });

  it('excludes sensitive facts from resurfacing', () => {
    const id = memory.saveFact('user_info', 'secret', 'private detail');
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    memory['db']
      .prepare('UPDATE facts SET importance = 95, sensitive = 1, last_accessed_at = ? WHERE id = ?')
      .run(old, id);

    expect(memory.selectResurfaceCandidate(new Date())).toBeNull();
  });

  it('does not resurface recently-accessed facts', () => {
    const id = memory.saveFact('user_info', 'fresh', 'just discussed');
    memory['db']
      .prepare('UPDATE facts SET importance = 95, last_accessed_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);

    expect(memory.selectResurfaceCandidate(new Date())).toBeNull();
  });
});

describe('resurface rate gate (memory_meta)', () => {
  it('records and blocks a second resurface on the same day', () => {
    const memory = new MemoryManager(':memory:');
    const todayKey = '2026-06-09';
    expect(memory.getMeta('last_resurface_date')).toBeNull();
    memory.setMeta('last_resurface_date', todayKey);
    expect(memory.getMeta('last_resurface_date')).toBe(todayKey);
  });
});

// ── F2: resurfacing must never leak another brand's (or personal) facts ──────
describe('selectResurfaceCandidate scope filtering (F2)', () => {
  let memory: MemoryManager;
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const makeStaleFact = (
    subject: string,
    content: string,
    scope: string,
    importance = 90
  ): number => {
    const id = memory.saveFact('user_info', subject, content, false, scope);
    memory['db']
      .prepare('UPDATE facts SET importance = ?, last_accessed_at = ? WHERE id = ?')
      .run(importance, old, id);
    return id;
  };

  beforeEach(() => {
    memory = new MemoryManager(':memory:');
  });

  it("a client fact is never selected for another client's session", () => {
    makeStaleFact('secret', 'Brand A confidential pricing', clientScope('brandA'));

    const candidate = memory.selectResurfaceCandidate(
      new Date(),
      resolveVisibleScopesFor('client', 'brandB')
    );
    expect(candidate).toBeNull();
  });

  it("a client fact is never selected for a personal session", () => {
    makeStaleFact('secret', 'Brand A confidential pricing', clientScope('brandA'));

    const candidate = memory.selectResurfaceCandidate(
      new Date(),
      resolveVisibleScopesFor('personal')
    );
    expect(candidate).toBeNull();
  });

  it('a personal (user) fact is never selected for a client session', () => {
    makeStaleFact('secret', 'operator personal detail', USER_SCOPE);

    const candidate = memory.selectResurfaceCandidate(
      new Date(),
      resolveVisibleScopesFor('client', 'brandA')
    );
    expect(candidate).toBeNull();
  });

  it("a client's own fact IS selected for that client's session", () => {
    const id = makeStaleFact('brand_note', 'Brand A launch retro', clientScope('brandA'));

    const candidate = memory.selectResurfaceCandidate(
      new Date(),
      resolveVisibleScopesFor('client', 'brandA')
    );
    expect(candidate).not.toBeNull();
    expect(candidate!.kind).toBe('fact');
    if (candidate!.kind === 'fact') expect(candidate!.factId).toBe(id);
  });

  it('world facts are visible from any shared (client/project/world) session', () => {
    const id = makeStaleFact('agency_note', 'Agency-wide style note', WORLD_SCOPE);

    const candidate = memory.selectResurfaceCandidate(
      new Date(),
      resolveVisibleScopesFor('client', 'brandA')
    );
    expect(candidate).not.toBeNull();
    if (candidate!.kind === 'fact') expect(candidate!.factId).toBe(id);
  });

  it('an empty visible-scope list yields no candidate at all (never falls through unfiltered)', () => {
    makeStaleFact('secret', 'anything', USER_SCOPE);
    expect(memory.selectResurfaceCandidate(new Date(), [])).toBeNull();
  });

  it('when scope resolution fails, restricting to user/world excludes client/project facts', () => {
    makeStaleFact('secret', 'Brand A confidential pricing', clientScope('brandA'));
    const userFactId = makeStaleFact('goal', 'operator personal goal', USER_SCOPE);

    // Simulates the scheduler's safe-fallback scope list (F2).
    const candidate = memory.selectResurfaceCandidate(new Date(), [USER_SCOPE, WORLD_SCOPE]);
    expect(candidate).not.toBeNull();
    if (candidate!.kind === 'fact') expect(candidate!.factId).toBe(userFactId);
  });
});

function resolveVisibleScopesFor(
  contextType: 'personal' | 'world' | 'client' | 'project',
  clientId: string | null = null,
  projectKey: string | null = null
): string[] {
  return resolveVisibleScopes({ contextType, clientId, projectKey }, 'test-session');
}
