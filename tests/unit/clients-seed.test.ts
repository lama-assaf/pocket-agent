/**
 * Bundled client seeds (Zilliqa, LTIN): created once at first launch, voiced
 * via `how_to_act` facts, and wired to the right marketplace agents via
 * explicit `enabled-agents` facts — idempotent so re-running never clobbers
 * an operator's edits.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_CLIENT_SEEDS,
  seedDefaultClients,
  type ClientSeed,
  type SeedMemory,
} from '../../src/clients/seed';
import { clientScope } from '../../src/memory/scope';
import { HOW_TO_ACT_CATEGORY, VOICE_SUBJECT_ORDER } from '../../src/agent/how-to-act';
import { ENABLED_AGENTS_CATEGORY, agentEnablementSubject } from '../../src/marketplace/enablement';

interface FakeFact {
  category: string;
  subject: string;
  content: string;
  scope: string;
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

  it('is idempotent — an existing client id is left untouched, no duplicate facts', () => {
    memory.createClient({ id: 'zilliqa', name: 'Custom name kept as-is' });
    const created = seedDefaultClients(memory, ensureScaffold);
    expect(created).toEqual(['ltin']);
    expect(memory.clients.find((c) => c.id === 'zilliqa')?.name).toBe('Custom name kept as-is');
    expect(scaffolded).toEqual(['ltin']);
    expect(memory.facts.some((f) => f.scope === clientScope('zilliqa'))).toBe(false);
  });

  it('supports a custom seed list for isolated testing', () => {
    const custom: ClientSeed[] = [
      {
        id: 'acme',
        name: 'Acme',
        facts: [{ subject: 'voice', content: 'Bold and brief' }],
        agents: [{ packId: 'atelier', agentName: 'copywriter' }],
      },
    ];
    const created = seedDefaultClients(memory, ensureScaffold, custom);
    expect(created).toEqual(['acme']);
    expect(memory.clients.map((c) => c.id)).toEqual(['acme']);
  });
});
