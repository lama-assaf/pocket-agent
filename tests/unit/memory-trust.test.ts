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
import { embedFactAsync, embedSoulAspectAsync } from '../../src/memory/semantic';

describe('updateFact', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new MemoryManager(':memory:');
  });

  it('updates content and re-embeds', () => {
    const id = memory.saveFact('user_info', 'city', 'Austin');
    const ok = memory.updateFact(id, { content: 'Denver' });
    expect(ok).toBe(true);
    const fact = memory.getAllFacts().find((f) => f.id === id);
    expect(fact!.content).toBe('Denver');
    // saveFact embeds once, updateFact embeds again
    expect(embedFactAsync).toHaveBeenCalledWith(expect.anything(), id);
    expect((embedFactAsync as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it('returns false when no fields are given', () => {
    const id = memory.saveFact('notes', 'x', 'y');
    expect(memory.updateFact(id, {})).toBe(false);
  });

  it('updateSoulAspect updates and re-embeds', () => {
    const id = memory.setSoulAspect('tone', 'formal');
    const ok = memory.updateSoulAspect(id, { content: 'casual' });
    expect(ok).toBe(true);
    expect(memory.getSoulAspect('tone')!.content).toBe('casual');
    expect(embedSoulAspectAsync).toHaveBeenCalledWith(expect.anything(), id);
  });

  it('setFactSensitive flags a fact', () => {
    const id = memory.saveFact('user_info', 'secret', 'private');
    expect(memory.setFactSensitive(id, true)).toBe(true);
  });
});

describe('exportMemory', () => {
  it('exports facts, soul, daily logs, and rollups as JSON', () => {
    const memory = new MemoryManager(':memory:');
    memory.saveFact('user_info', 'name', 'Ken');
    memory.setSoulAspect('tone', 'warm');
    memory.appendToDailyLog('shipped the memory upgrade');

    const data = memory.exportMemory();
    expect(data.facts.length).toBe(1);
    expect(data.facts[0]!.subject).toBe('name');
    expect(data.soul.length).toBe(1);
    expect(data.dailyLogs.length).toBe(1);
    expect(Array.isArray(data.rollups)).toBe(true);
    expect(typeof data.exportedAt).toBe('string');

    const md = memory.exportMemoryMarkdown();
    expect(md).toContain('# Pocket Agent Memory Export');
    expect(md).toContain('Ken');
    expect(md).toContain('## Soul');
  });
});
