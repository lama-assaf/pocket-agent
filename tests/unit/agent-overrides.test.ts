/**
 * Marketplace agent overrides — memory-backed resolution.
 *
 * These are the behavior-critical guarantees for the local-overrides layer:
 *  1. Base agent (marketplace default) resolves unchanged when no override exists.
 *  2. A scoped override merges over the base (prompt/tools/model).
 *  3. A nearer scope (client) overrides a broader one (world) for the same agent.
 *  4. Personal context never sees a brand's agent override (isolation by construction).
 *  5. Reset ("clear") only removes the override at the resolved scope, leaving
 *     overrides at other scopes untouched.
 *  6. Overrides are independent of the synced pack tree — swapping out what the
 *     marketplace registry returns for the base agent doesn't disturb the
 *     override, and the merge still applies over the new base.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clientScope, WORLD_SCOPE, USER_SCOPE } from '../../src/memory/scope';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import type { SessionContext } from '../../src/memory/sessions';
import type { PackAgent } from '../../src/marketplace/types';

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

const clientCtx: SessionContext = { contextType: 'client', clientId: 'acme', projectKey: null };
const worldCtx: SessionContext = { contextType: 'world', clientId: null, projectKey: null };
const personalCtx: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };

const baseAgent: PackAgent = {
  name: 'design-reviewer',
  description: 'Critiques designs',
  tools: ['Read', 'Grep'],
  model: 'opus',
  prompt: 'BASE PROMPT',
  source: '/seed/atelier/agents/design-reviewer.md',
};

async function freshMemory(): Promise<import('../../src/memory/index').MemoryManager> {
  const { MemoryManager } = await import('../../src/memory/index');
  const memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
  setCurrentSessionId('S');
  return memory;
}

describe('resolveAgentOverride / resolvePackAgent — scope precedence', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('resolves to the base agent unchanged when no override exists', async () => {
    const memory = await freshMemory();
    const { resolvePackAgent } = await import('../../src/agent/agent-overrides');
    const resolved = resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S');
    expect(resolved).toEqual(baseAgent);
    memory.close();
  });

  it('merges a client-scope override over the base', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'CLIENT CUSTOM PROMPT' }),
      false,
      clientScope('acme')
    );

    const { resolvePackAgent, resolveAgentOverride } = await import('../../src/agent/agent-overrides');
    const resolved = resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S');
    expect(resolved.prompt).toBe('CLIENT CUSTOM PROMPT');
    expect(resolved.tools).toEqual(baseAgent.tools); // untouched field falls through

    const info = resolveAgentOverride(clientCtx, 'atelier', 'design-reviewer', 'S');
    expect(info?.scope).toBe(clientScope('acme'));
    memory.close();
  });

  it('a nearer scope (client) overrides the agency (world) for the same agent', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'WORLD PROMPT' }),
      false,
      WORLD_SCOPE
    );
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'CLIENT PROMPT' }),
      false,
      clientScope('acme')
    );

    const { resolvePackAgent } = await import('../../src/agent/agent-overrides');
    const resolved = resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S');
    expect(resolved.prompt).toBe('CLIENT PROMPT');
    memory.close();
  });

  it('a world-scope override still applies under the world context (no client override present)', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'WORLD PROMPT' }),
      false,
      WORLD_SCOPE
    );

    const { resolvePackAgent } = await import('../../src/agent/agent-overrides');
    const resolved = resolvePackAgent(baseAgent, 'atelier', worldCtx, 'S');
    expect(resolved.prompt).toBe('WORLD PROMPT');
    memory.close();
  });

  it('personal context never resolves a brand agent override (isolation)', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'BRAND SECRET PROMPT' }),
      false,
      clientScope('acme')
    );

    const { resolvePackAgent, resolveAgentOverride } = await import('../../src/agent/agent-overrides');
    const resolved = resolvePackAgent(baseAgent, 'atelier', personalCtx, 'S');
    expect(resolved.prompt).toBe(baseAgent.prompt); // falls back to base, brand override invisible

    const info = resolveAgentOverride(personalCtx, 'atelier', 'design-reviewer', 'S');
    expect(info).toBeNull();
    memory.close();
  });

  it('degrades to the base agent when memory is not initialized', async () => {
    setMemoryManager(null as unknown as import('../../src/memory/index').MemoryManager);
    const { resolvePackAgent } = await import('../../src/agent/agent-overrides');
    expect(resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S')).toEqual(baseAgent);
  });
});

describe('getAgentOverrideAtScope / setAgentOverride / clearAgentOverride', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('setAgentOverride writes at the scope resolved for the context, readable via getAgentOverrideAtScope', async () => {
    const memory = await freshMemory();
    const { setAgentOverride, getAgentOverrideAtScope } = await import(
      '../../src/agent/agent-overrides'
    );

    const res = setAgentOverride(clientCtx, 'atelier', 'design-reviewer', { prompt: 'EDITED' });
    expect(res.success).toBe(true);
    expect(res.scope).toBe(clientScope('acme'));

    const at = getAgentOverrideAtScope(clientCtx, 'atelier', 'design-reviewer');
    expect(at?.scope).toBe(clientScope('acme'));
    expect(at?.fields.prompt).toBe('EDITED');
    memory.close();
  });

  it('setAgentOverride rejects an empty field set (use clear instead)', async () => {
    const memory = await freshMemory();
    const { setAgentOverride } = await import('../../src/agent/agent-overrides');
    const res = setAgentOverride(clientCtx, 'atelier', 'design-reviewer', {});
    expect(res.success).toBe(false);
    memory.close();
  });

  it('getAgentOverrideAtScope returns null for a scope that has no override, even if a broader one exists', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'WORLD PROMPT' }),
      false,
      WORLD_SCOPE
    );
    const { getAgentOverrideAtScope } = await import('../../src/agent/agent-overrides');
    // Client scope itself has no override set — must not "inherit" the world one here.
    expect(getAgentOverrideAtScope(clientCtx, 'atelier', 'design-reviewer')).toBeNull();
    memory.close();
  });

  it('clearAgentOverride removes only the override at the resolved scope, leaving other scopes intact', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'WORLD PROMPT' }),
      false,
      WORLD_SCOPE
    );
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'CLIENT PROMPT' }),
      false,
      clientScope('acme')
    );

    const { clearAgentOverride, resolvePackAgent, getAgentOverrideAtScope } = await import(
      '../../src/agent/agent-overrides'
    );
    const res = clearAgentOverride(clientCtx, 'atelier', 'design-reviewer');
    expect(res.success).toBe(true);
    expect(res.scope).toBe(clientScope('acme'));

    // Client override gone...
    expect(getAgentOverrideAtScope(clientCtx, 'atelier', 'design-reviewer')).toBeNull();
    // ...but the world one is untouched, and resolution now falls through to it.
    expect(getAgentOverrideAtScope(worldCtx, 'atelier', 'design-reviewer')?.fields.prompt).toBe(
      'WORLD PROMPT'
    );
    const resolved = resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S');
    expect(resolved.prompt).toBe('WORLD PROMPT');
    memory.close();
  });

  it('clearAgentOverride on an already-clear scope is a harmless no-op success', async () => {
    const memory = await freshMemory();
    const { clearAgentOverride } = await import('../../src/agent/agent-overrides');
    const res = clearAgentOverride(clientCtx, 'atelier', 'design-reviewer');
    expect(res.success).toBe(true);
    memory.close();
  });

  it('"Reset to marketplace default": after clear, resolution returns exactly the base agent', async () => {
    const memory = await freshMemory();
    const { setAgentOverride, clearAgentOverride, resolvePackAgent } = await import(
      '../../src/agent/agent-overrides'
    );
    setAgentOverride(clientCtx, 'atelier', 'design-reviewer', {
      prompt: 'TEMP',
      tools: ['Write'],
      model: 'claude-opus-4-8',
    });
    expect(resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S').prompt).toBe('TEMP');

    clearAgentOverride(clientCtx, 'atelier', 'design-reviewer');
    expect(resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S')).toEqual(baseAgent);
    memory.close();
  });
});

describe('overrides survive a simulated pack re-sync', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('an override written against one base agent still merges correctly over a changed base (re-sync simulation)', async () => {
    // Overrides are stored as facts in SQLite; the synced pack tree lives on
    // disk under a completely separate store (<userData>/plugins). Simulate a
    // `PackSyncManager.checkAndUpdate()` re-sync by resolving the SAME override
    // against a "new" base agent object (as if the upstream repo shipped a new
    // default prompt/tools) — the override must still apply untouched.
    const memory = await freshMemory();
    const { setAgentOverride, resolvePackAgent } = await import('../../src/agent/agent-overrides');

    setAgentOverride(clientCtx, 'atelier', 'design-reviewer', { prompt: 'CLIENT VOICE — DO NOT LOSE' });

    const preSync = resolvePackAgent(baseAgent, 'atelier', clientCtx, 'S');
    expect(preSync.prompt).toBe('CLIENT VOICE — DO NOT LOSE');

    const postSyncBase: PackAgent = {
      ...baseAgent,
      description: 'Updated description from upstream',
      tools: ['Read', 'Grep', 'Bash'], // upstream added a tool
      prompt: 'NEW MARKETPLACE DEFAULT PROMPT AFTER RESYNC',
    };
    const postSync = resolvePackAgent(postSyncBase, 'atelier', clientCtx, 'S');
    // Override still wins for the field it touches...
    expect(postSync.prompt).toBe('CLIENT VOICE — DO NOT LOSE');
    // ...and fields the override never touched pick up the new upstream base.
    expect(postSync.tools).toEqual(['Read', 'Grep', 'Bash']);
    expect(postSync.description).toBe('Updated description from upstream');
    memory.close();
  });

  it('USER_SCOPE constant sanity (isolation guard uses it, not a magic string)', () => {
    expect(USER_SCOPE).toBe('user');
  });
});
