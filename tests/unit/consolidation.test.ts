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

// ── Protected categories: how_to_act (voice), lesson, atelier-memory,
// enabled-agents/enabled-mcp must survive automatic consolidation untouched —
// they're operator-controlled or mechanically-synced sources of truth, not
// free-form knowledge a background LLM pass should compress or rewrite. ──────
describe('consolidateMemory — protected categories are never touched', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager(':memory:');
  });

  function padScopeOverBudget(scope: string): void {
    for (let i = 0; i < 40; i++) {
      memory.saveFact('notes', `fact${i}`, `Some knowledge fact number ${i} with enough text to add up.`, undefined, scope);
    }
  }

  it('never shows how_to_act (voice) facts to the compaction model, and refuses a delete/upsert targeting it', async () => {
    const voiceId = memory.saveFact(
      'how_to_act',
      'voice',
      'Understated, evidence-first, institutional.',
      undefined,
      'client:acme'
    );
    padScopeOverBudget('client:acme');

    const seenCategories: string[] = [];
    const summarizer = vi.fn(async (prompt: string) => {
      const matches = [...prompt.matchAll(/"category":\s*"([^"]+)"/g)].map((m) => m[1]!);
      seenCategories.push(...matches);
      // Try to sneak a delete of the voice fact + an upsert into how_to_act —
      // both must be refused regardless of what the model asks for.
      return JSON.stringify({
        facts: {
          delete_ids: [voiceId],
          upsert: [{ category: 'how_to_act', subject: 'voice', content: 'HACKED VOICE' }],
        },
      });
    });

    await consolidateMemory(memory, { force: true, summarizer });

    expect(seenCategories).not.toContain('how_to_act');
    const voiceFact = memory.getFact(voiceId);
    expect(voiceFact).not.toBeNull();
    expect(voiceFact!.content).toBe('Understated, evidence-first, institutional.');
    // The malicious upsert must not have created a second how_to_act row either.
    const howToActFacts = memory.getFactsByCategory('how_to_act');
    expect(howToActFacts).toHaveLength(1);
    expect(howToActFacts[0]!.content).toBe('Understated, evidence-first, institutional.');
  });

  it('never deletes or rewrites lesson facts via consolidation', async () => {
    const lessonId = memory.saveFact(
      'lesson',
      'canon sweep',
      'Sweep every surface, not just repo markdown.',
      undefined,
      'client:acme'
    );
    padScopeOverBudget('client:acme');

    const summarizer = vi.fn(async () =>
      JSON.stringify({
        facts: {
          delete_ids: [lessonId],
          upsert: [{ category: 'lesson', subject: 'canon sweep', content: 'shortened' }],
        },
      })
    );

    await consolidateMemory(memory, { force: true, summarizer });

    const lessonFact = memory.getFact(lessonId);
    expect(lessonFact).not.toBeNull();
    expect(lessonFact!.content).toBe('Sweep every surface, not just repo markdown.');
    expect(memory.getFactsByCategory('lesson')).toHaveLength(1);
  });

  it('never deletes atelier-memory mirror rows or enabled-agents/enabled-mcp toggles', async () => {
    const mirrorId = memory.saveFact(
      'atelier-memory',
      'voice.md',
      '# voice\n\nmirrored file content',
      undefined,
      'client:acme'
    );
    const agentId = memory.saveFact('enabled-agents', 'atelier:copywriter', 'true', undefined, 'client:acme');
    const mcpId = memory.saveFact('enabled-mcp', 'atelier:figma', 'true', undefined, 'client:acme');
    padScopeOverBudget('client:acme');

    const summarizer = vi.fn(async () =>
      JSON.stringify({
        facts: {
          delete_ids: [mirrorId, agentId, mcpId],
          upsert: [],
        },
      })
    );

    await consolidateMemory(memory, { force: true, summarizer });

    expect(memory.getFact(mirrorId)).not.toBeNull();
    expect(memory.getFact(agentId)).not.toBeNull();
    expect(memory.getFact(mcpId)).not.toBeNull();
  });
});
