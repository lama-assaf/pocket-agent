/**
 * "How to act" injection is driven by `how_to_act` facts.
 *
 * These are the behavior-critical guarantees for switching voice/guardrails from
 * files to facts (client-first workspaces):
 *  1. A client's `how_to_act` facts compose the brand-voice injection.
 *  2. The marketplace pack rules + world facts still merge (no regression).
 *  3. A nearer scope (client) overrides the agency (world) for the same subject.
 *  4. Banned words from `how_to_act` facts feed the tone guard, alongside pack
 *     banned words — and the warning still fires (the hard-block reads it).
 *  5. Personal context reads NO brand behavior (isolation by construction).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clientScope, WORLD_SCOPE } from '../../src/memory/scope';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import type { SessionContext } from '../../src/memory/sessions';

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

// Fake marketplace pack so we can assert the pack rules + banned words survive
// the merge (they must NOT be replaced by the fact-driven injection).
vi.mock('../../src/marketplace/registry', () => ({
  rulesForLane: () => [{ lane: 'brand', filename: 'voice.md', content: 'PACK LANE RULE ALPHA' }],
  skillsForLane: () => [],
  allBannedAndToneRules: () => [
    { lane: 'brand', filename: 'banned-words.md', content: '- synergy' },
  ],
}));

const clientCtx: SessionContext = {
  contextType: 'client',
  clientId: 'acme',
  projectKey: null,
};

async function freshMemory(): Promise<import('../../src/memory/index').MemoryManager> {
  const { MemoryManager } = await import('../../src/memory/index');
  const memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
  setCurrentSessionId('S');
  return memory;
}

describe('how-to-act injection — brand voice from facts', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it("composes brand voice from the client's how_to_act facts, merging world + pack rules", async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'how_to_act',
      'voice',
      'Warm, plainspoken, concrete',
      false,
      clientScope('acme')
    );
    memory.saveFact('how_to_act', 'tone', 'Short sentences', false, WORLD_SCOPE);

    const { composeLaneRules } = await import('../../src/agent/lane-context');
    const out = composeLaneRules('brand', clientCtx);

    // Pack lane rule preserved (merge intact, not replaced).
    expect(out).toContain('PACK LANE RULE ALPHA');
    // Brand voice section is fact-driven.
    expect(out).toContain('Brand voice');
    expect(out).toContain('Warm, plainspoken, concrete');
    // A world-scope how_to_act fact still merges under the client context.
    expect(out).toContain('Short sentences');
    memory.close();
  });

  it('a nearer scope (client) overrides the agency (world) for the same subject', async () => {
    const memory = await freshMemory();
    memory.saveFact('how_to_act', 'voice', 'WORLD VOICE', false, WORLD_SCOPE);
    memory.saveFact('how_to_act', 'voice', 'CLIENT VOICE', false, clientScope('acme'));

    const { composeLaneRules } = await import('../../src/agent/lane-context');
    const out = composeLaneRules('brand', clientCtx);
    expect(out).toContain('CLIENT VOICE');
    expect(out).not.toContain('WORLD VOICE');
    memory.close();
  });

  it('personal context injects no brand voice (isolation), pack rules still present', async () => {
    const memory = await freshMemory();
    memory.saveFact('how_to_act', 'voice', 'BRAND SECRET VOICE', false, clientScope('acme'));

    const { composeLaneRules } = await import('../../src/agent/lane-context');
    const out = composeLaneRules('brand', {
      contextType: 'personal',
      clientId: null,
      projectKey: null,
    });
    expect(out).not.toContain('BRAND SECRET VOICE');
    expect(out).toContain('PACK LANE RULE ALPHA');
    memory.close();
  });
});

describe('how-to-act injection — banned words feed the tone guard', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('flags banned words from how_to_act facts AND pack rules, and still warns', async () => {
    const memory = await freshMemory();
    memory.saveFact('how_to_act', 'banned_words', 'leverage, delve', false, clientScope('acme'));

    const { scanForBannedTone } = await import('../../src/agent/write-guards');
    const res = scanForBannedTone('We will leverage synergy to delve deeper', clientCtx);
    expect(res.hits).toContain('leverage'); // from fact
    expect(res.hits).toContain('delve'); // from fact
    expect(res.hits).toContain('synergy'); // from pack rule (preserved)
    // The warning is what the hard-block setting reads — must still be produced.
    expect(res.warning).toBeTruthy();
    memory.close();
  });

  it("personal context never sees a brand's banned words, but pack words still apply", async () => {
    const memory = await freshMemory();
    // Use a custom brand word with no overlap in the vendored global AI-tone
    // patterns (write-guards.ts) — 'leverage' is now globally flagged for
    // everyone regardless of scope, so it can't isolate brand-only scoping.
    memory.saveFact('how_to_act', 'banned_words', 'boondoggle', false, clientScope('acme'));

    const { scanForBannedTone } = await import('../../src/agent/write-guards');
    const personal: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };
    // Brand banned word is invisible to Personal.
    expect(scanForBannedTone('boondoggle this', personal).hits).not.toContain('boondoggle');
    // Pack banned word still fires everywhere.
    expect(scanForBannedTone('pure synergy', personal).hits).toContain('synergy');
    memory.close();
  });
});
