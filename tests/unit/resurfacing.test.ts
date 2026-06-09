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
