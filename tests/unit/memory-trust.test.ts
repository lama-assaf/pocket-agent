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

  it('saveFact with sensitive flag excludes the fact from resurfacing', () => {
    memory.saveFact('user_info', 'health', 'recovering from surgery', true);
    memory.saveFact('user_info', 'hobby', 'plays guitar');
    const candidate = memory.selectResurfaceCandidate(new Date());
    expect(candidate).not.toBeNull();
    expect(candidate!.text).not.toContain('surgery');
  });

  it('saveFact overwrite preserves the sensitive flag unless explicitly passed', () => {
    const id = memory.saveFact('user_info', 'health', 'recovering from surgery', true);
    // Overwrite same category+subject without the flag — must stay sensitive
    memory.saveFact('user_info', 'health', 'fully recovered now');
    const candidate = memory.selectResurfaceCandidate(new Date());
    expect(candidate === null || !candidate.text.includes('recovered')).toBe(true);
    // Explicitly unmark via updateFact → becomes eligible again
    expect(memory.updateFact(id, { sensitive: false })).toBe(true);
  });

  it('updateFact with only sensitive does not re-embed', () => {
    const id = memory.saveFact('notes', 'x', 'y');
    vi.clearAllMocks();
    expect(memory.updateFact(id, { sensitive: true })).toBe(true);
    expect(embedFactAsync).not.toHaveBeenCalled();
  });
});

describe('getFactsMemoryUsage (store budget)', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    memory = new MemoryManager(':memory:');
  });

  it('renders facts with an "as of" date for recency-based conflict resolution', () => {
    memory.saveFact('people', 'partner', 'reconciled before Thailand trip');
    const context = memory.getFactsForContext();
    expect(context).toMatch(/reconciled before Thailand trip _\(as of \d{4}-\d{2}-\d{2}\)_/);
  });

  it('measures the whole store without truncation', () => {
    // ~60 facts × ~70 chars ≈ 4,200 chars — would have exceeded the old
    // 3,000-char context budget, but is well under the 15,000 store budget
    for (let i = 0; i < 60; i++) {
      memory.saveFact('notes', `subject_${i}`, `some atomic fact content number ${i} with detail`);
    }
    const usage = memory.getFactsMemoryUsage();
    expect(usage.budgetChars).toBe(15000);
    expect(usage.usedChars).toBeGreaterThan(3000); // not capped at context budget
    expect(usage.pct).toBeLessThan(80); // no consolidation pressure yet
  });

  it('reports pct over 100 when the store exceeds the budget', () => {
    const filler = 'x'.repeat(200);
    for (let i = 0; i < 80; i++) {
      memory.saveFact('notes', `big_${i}`, filler);
    }
    const usage = memory.getFactsMemoryUsage();
    expect(usage.pct).toBeGreaterThan(100);
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
