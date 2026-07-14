/**
 * Bundled client seeds (Zilliqa, LTIN): every bundled client is voiced via
 * `how_to_act` facts, given starter `lesson` facts, and wired to the right
 * marketplace agents via explicit `enabled-agents` facts. Backfills a client
 * row that already exists but has no voice yet (e.g. hand-created via the
 * Clients picker, or seeded by a build that only wrote the bare row) —
 * idempotent so re-running never clobbers an operator's real edits.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_CLIENT_SEEDS,
  seedDefaultClients,
  type ClientSeed,
  type SeedMemory,
  type SeedFactRow,
} from '../../src/clients/seed';
import { clientScope } from '../../src/memory/scope';
import { HOW_TO_ACT_CATEGORY, VOICE_SUBJECT_ORDER } from '../../src/agent/how-to-act';
import { ENABLED_AGENTS_CATEGORY, agentEnablementSubject } from '../../src/marketplace/enablement';

interface FakeFact extends SeedFactRow {
  subject: string;
  content: string;
}

class FakeMemory implements SeedMemory {
  clients: { id: string; name: string }[] = [];
  facts: FakeFact[] = [];

  getClients(): { id: string }[] {
    return this.clients;
  }

  createClient(input: { id: string; name: string }): { id: string; name: string } {
    if (this.clients.some((c) => c.id === input.id)) {
      throw new Error(`Client "${input.id}" already exists`);
    }
    const client = { id: input.id, name: input.name };
    this.clients.push(client);
    return client;
  }

  getAllFacts(): SeedFactRow[] {
    return this.facts;
  }

  saveFact(category: string, subject: string, content: string, _sensitive?: boolean, scope = 'user'): number {
    this.facts.push({ category, subject, content, scope });
    return this.facts.length;
  }
}

describe('DEFAULT_CLIENT_SEEDS', () => {
  it('bundles zilliqa and ltin', () => {
    const ids = DEFAULT_CLIENT_SEEDS.map((s) => s.id);
    expect(ids).toEqual(['zilliqa', 'ltin']);
  });

  it('every seed carries the full voice fact set (voice/tone/instincts/banned_words) and at least one agent', () => {
    for (const seed of DEFAULT_CLIENT_SEEDS) {
      const subjects = seed.facts.map((f) => f.subject);
      for (const s of VOICE_SUBJECT_ORDER) expect(subjects).toContain(s);
      expect(subjects).toContain('banned_words');
      expect(seed.facts.every((f) => f.content.trim().length > 0)).toBe(true);
      expect(seed.agents.length).toBeGreaterThan(0);
    }
  });

  it('every seed carries at least one starter lesson', () => {
    for (const seed of DEFAULT_CLIENT_SEEDS) {
      expect(seed.lessons.length).toBeGreaterThan(0);
      expect(seed.lessons.every((l) => l.content.trim().length > 0)).toBe(true);
    }
  });

  it('only wires atelier/salon agents (the packs pocket-agent bundles)', () => {
    for (const seed of DEFAULT_CLIENT_SEEDS) {
      for (const agent of seed.agents) {
        expect(['atelier', 'salon']).toContain(agent.packId);
      }
    }
  });
});

describe('seedDefaultClients', () => {
  let memory: FakeMemory;
  let scaffolded: string[];

  beforeEach(() => {
    memory = new FakeMemory();
    scaffolded = [];
  });

  const ensureScaffold = (id: string): void => {
    scaffolded.push(id);
  };

  it('creates every bundled client on a fresh store', () => {
    const created = seedDefaultClients(memory, ensureScaffold);
    expect(created).toEqual(['zilliqa', 'ltin']);
    expect(memory.clients.map((c) => c.id).sort()).toEqual(['ltin', 'zilliqa']);
    expect(scaffolded.sort()).toEqual(['ltin', 'zilliqa']);
  });

  it('seeds how_to_act facts scoped to client:<id>, matching the seed content', () => {
    seedDefaultClients(memory, ensureScaffold);
    const zilliqaScope = clientScope('zilliqa');
    const voiceFact = memory.facts.find(
      (f) => f.scope === zilliqaScope && f.category === HOW_TO_ACT_CATEGORY && f.subject === 'voice'
    );
    expect(voiceFact).toBeTruthy();
    expect(voiceFact?.content).toContain('evidence-first');
  });

  it('seeds lesson facts scoped to client:<id>', () => {
    seedDefaultClients(memory, ensureScaffold);
    const ltinScope = clientScope('ltin');
    const lessonFacts = memory.facts.filter((f) => f.scope === ltinScope && f.category === 'lesson');
    expect(lessonFacts.length).toBeGreaterThan(0);
  });

  it('seeds explicit enabled-agents facts for each mapped agent', () => {
    seedDefaultClients(memory, ensureScaffold);
    const ltinScope = clientScope('ltin');
    const subject = agentEnablementSubject('atelier', 'copywriter');
    const fact = memory.facts.find(
      (f) => f.scope === ltinScope && f.category === ENABLED_AGENTS_CATEGORY && f.subject === subject
    );
    expect(fact).toBeTruthy();
    expect(fact?.content).toBe('true');
  });

  it('is idempotent — a scope that already has a how_to_act fact is left untouched, no duplicate facts', () => {
    seedDefaultClients(memory, ensureScaffold);
    const factCountAfterFirstRun = memory.facts.length;
    const created = seedDefaultClients(memory, ensureScaffold);
    expect(created).toEqual([]);
    expect(memory.facts.length).toBe(factCountAfterFirstRun);
  });

  it('never overwrites an operator-authored voice fact in an existing client scope', () => {
    memory.createClient({ id: 'zilliqa', name: 'Zilliqa' });
    memory.saveFact(HOW_TO_ACT_CATEGORY, 'voice', 'Operator-authored voice', false, clientScope('zilliqa'));
    const created = seedDefaultClients(memory, ensureScaffold);
    expect(created).toEqual(['ltin']);
    const zilliqaVoiceFacts = memory.facts.filter(
      (f) => f.scope === clientScope('zilliqa') && f.category === HOW_TO_ACT_CATEGORY && f.subject === 'voice'
    );
    expect(zilliqaVoiceFacts).toHaveLength(1);
    expect(zilliqaVoiceFacts[0]?.content).toBe('Operator-authored voice');
  });

  it('backfills a hand-created client that exists with zero facts (the reported bug)', () => {
    // Reproduces the real-world case: a client row exists (created by an
    // older build, or by hand) but has no how_to_act/lesson facts at all —
    // creation alone must not be treated as "already seeded".
    memory.createClient({ id: 'zilliqa', name: 'Zilliqa' });
    memory.createClient({ id: 'ltin', name: 'LTIN' });
    const created = seedDefaultClients(memory, ensureScaffold);
    expect(created.sort()).toEqual(['ltin', 'zilliqa']);
    const zilliqaScope = clientScope('zilliqa');
    expect(
      memory.facts.some((f) => f.scope === zilliqaScope && f.category === HOW_TO_ACT_CATEGORY && f.subject === 'voice')
    ).toBe(true);
    expect(memory.facts.some((f) => f.scope === zilliqaScope && f.category === 'lesson')).toBe(true);
  });

  it('supports a custom seed list for isolated testing', () => {
    const custom: ClientSeed[] = [
      {
        id: 'acme',
        name: 'Acme',
        facts: [{ subject: 'voice', content: 'Bold and brief' }],
        lessons: [{ subject: 'test lesson', content: 'Keep it short.' }],
        agents: [{ packId: 'atelier', agentName: 'copywriter' }],
      },
    ];
    const created = seedDefaultClients(memory, ensureScaffold, custom);
    expect(created).toEqual(['acme']);
    expect(memory.clients.map((c) => c.id)).toEqual(['acme']);
  });
});
