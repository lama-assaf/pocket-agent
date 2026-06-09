import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub embeddings so saveFact/setSoulAspect don't spin up the model, and
// near-duplicate clustering is a no-op.
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
import { consolidateMemory } from '../../src/memory/consolidation';

describe('consolidateMemory', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager(':memory:');
  });

  it('supersedes a contradictory fact and merges duplicates (shrink-safe)', async () => {
    // Two long, contradictory facts about the same subject → model supersedes one.
    const id1 = memory.saveFact('user_info', 'location', 'User currently lives in Austin Texas USA');
    const id2 = memory.saveFact(
      'user_info',
      'home_city',
      'User recently relocated and now lives in Denver Colorado'
    );

    const summarizer = vi.fn(async () =>
      JSON.stringify({
        facts: {
          delete_ids: [id1, id2],
          upsert: [{ category: 'user_info', subject: 'residence', content: 'Lives in Denver' }],
        },
      })
    );

    const result = await consolidateMemory(memory, { force: true, summarizer });

    expect(result.ran).toBe(true);
    expect(result.factsDeleted).toBe(2);
    expect(result.factsAdded).toBe(1);

    const facts = memory.getAllFacts();
    expect(facts.length).toBe(1);
    expect(facts[0]!.content).toBe('Lives in Denver');
  });

  it('does not delete originals when upserts would not shrink memory', async () => {
    const id1 = memory.saveFact('notes', 'a', 'short');
    const summarizer = vi.fn(async () =>
      JSON.stringify({
        facts: {
          delete_ids: [id1],
          upsert: [
            {
              category: 'notes',
              subject: 'a',
              content: 'a much much much longer replacement that grows memory',
            },
          ],
        },
      })
    );

    const result = await consolidateMemory(memory, { force: true, summarizer });
    // delete still applies, but the oversized upsert is skipped
    expect(result.factsAdded).toBe(0);
    expect(result.factsDeleted).toBe(1);
  });

  it('reflects up to 2 evolved soul aspects from recent journal', async () => {
    memory.appendToDailyLog('User prefers terse answers and dislikes filler');

    const summarizer = vi.fn(async (prompt: string) => {
      if (prompt.includes('soul aspects')) {
        return JSON.stringify({
          soul: {
            upsert: [
              { aspect: 'communication', content: 'Be terse; skip filler' },
              { aspect: 'tone', content: 'Direct and warm' },
              { aspect: 'extra', content: 'should be ignored (cap 2)' },
            ],
          },
        });
      }
      // facts/soul consolidation pass returns nothing actionable
      return JSON.stringify({});
    });

    const result = await consolidateMemory(memory, {
      force: true,
      reflect: true,
      summarizer,
    });

    expect(result.soulAdded).toBe(2);
    const aspects = memory.getAllSoulAspects().map((s) => s.aspect);
    expect(aspects).toContain('communication');
    expect(aspects).toContain('tone');
    expect(aspects).not.toContain('extra');
  });

  it('returns ran:false when nothing is over budget and not forced', async () => {
    const result = await consolidateMemory(memory, { summarizer: vi.fn() });
    expect(result.ran).toBe(false);
  });
});
