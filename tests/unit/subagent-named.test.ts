import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(),
    getArray: vi.fn(),
    set: vi.fn(),
  },
}));

// Stub only the async embedding writes so MemoryManager needs no embedding model
// (only the override-resolution tests below construct a real MemoryManager).
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

import {
  resolveSpecialist,
  mapAgentTools,
  resolveSpecialistModel,
  createSubAgentTool,
} from '../../src/tools/subagent';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import { clientScope, WORLD_SCOPE } from '../../src/memory/scope';
import type { MemoryManager } from '../../src/memory/index';

describe('named specialist resolution', () => {
  it('resolves a design specialist prompt for the design lane', () => {
    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.prompt.toLowerCase()).toContain('critique');
  });
  it('returns null for an agent not in the lane', () => {
    expect(resolveSpecialist('design', 'community-manager')).toBeNull();
  });
  it('maps Claude Code tool names to pocket tool names, dropping unknowns', () => {
    const mapped = mapAgentTools(['Read', 'Grep', 'Bogus']);
    expect(mapped).toContain('read');
    expect(mapped).not.toContain('Bogus');
  });
});

describe('resolveSpecialistModel', () => {
  it('falls back to the configured model when the agent declares none', () => {
    expect(resolveSpecialistModel(undefined, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });
  it('passes through an already-known full model id unchanged', () => {
    expect(resolveSpecialistModel('claude-opus-4-8', 'claude-sonnet-4-6')).toBe('claude-opus-4-8');
  });
  it('resolves a short alias (e.g. "opus") to the same-provider app model', () => {
    expect(resolveSpecialistModel('opus', 'claude-sonnet-4-6')).toBe('claude-opus-4-8');
  });
  it('falls back to the configured model when the alias has no same-provider match', () => {
    expect(resolveSpecialistModel('nonexistent-alias-xyz', 'claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6'
    );
  });
});

// resolveSpecialist is the actual dispatch path (src/tools/subagent.ts calls it
// directly when the model asks for a named specialist) — it must resolve local
// overrides too, not just the marketplace IPC/UI listing.
describe('resolveSpecialist — override resolution (dispatch path)', () => {
  // A real MemoryManager set by one test must never leak into the next.
  afterEach(() => {
    setMemoryManager(null as unknown as MemoryManager);
  });

  it('resolves the base agent when no memory manager is initialized (existing behavior)', () => {
    setMemoryManager(null as unknown as MemoryManager);
    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.prompt.toLowerCase()).toContain('critique');
  });

  it('merges a client-scope override into the dispatched specialist prompt', async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('override-test-client', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'acme',
      projectKey: null,
    });
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'CUSTOM CLIENT REVIEW PROMPT' }),
      false,
      clientScope('acme')
    );

    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.prompt).toBe('CUSTOM CLIENT REVIEW PROMPT');
    memory.close();
  });

  it('a world-scope override applies when the session has no client override', async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('override-test-world', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, { contextType: 'world', clientId: null, projectKey: null });
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ tools: ['Read'] }),
      false,
      WORLD_SCOPE
    );

    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.tools).toEqual(['Read']);
    // Prompt untouched by this override — falls through to the base.
    expect(spec?.prompt.toLowerCase()).toContain('critique');
    memory.close();
  });

  it('a personal-context session never resolves a brand override (isolation)', async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('override-test-personal', 'general', null);
    setCurrentSessionId(session.id);
    // No setSessionContext call — defaults to personal.
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'BRAND SECRET PROMPT' }),
      false,
      clientScope('acme')
    );

    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.prompt.toLowerCase()).toContain('critique');
    expect(spec?.prompt).not.toContain('BRAND SECRET PROMPT');
    memory.close();
  });
});

// A disabled agent must not be dispatchable for the scope that disabled it —
// enforced at the actual dispatch point (resolveSpecialist), not just in the
// UI listing (src/agent/enablement.ts).
describe('resolveSpecialist — scoped enablement blocks dispatch', () => {
  afterEach(() => {
    setMemoryManager(null as unknown as MemoryManager);
  });

  it("returns null for an agent disabled at the session's client scope", async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('enablement-block-client', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'acme',
      projectKey: null,
    });
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, clientScope('acme'));

    expect(resolveSpecialist('design', 'design-reviewer')).toBeNull();
    memory.close();
  });

  it('stays dispatchable when only a different agent is disabled', async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('enablement-other-agent', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'acme',
      projectKey: null,
    });
    memory.saveFact('enabled-agents', 'atelier:copywriter', 'false', false, clientScope('acme'));

    expect(resolveSpecialist('design', 'design-reviewer')).not.toBeNull();
    memory.close();
  });

  it('a client-scope re-enable overrides a world-scope disable', async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('enablement-reenable', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'acme',
      projectKey: null,
    });
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, WORLD_SCOPE);
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'true', false, clientScope('acme'));

    expect(resolveSpecialist('design', 'design-reviewer')).not.toBeNull();
    memory.close();
  });

  it("createSubAgentTool's specialist list omits an agent disabled for the current session", async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('enablement-tool-desc', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'acme',
      projectKey: null,
    });
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, clientScope('acme'));

    const tool = createSubAgentTool(
      [],
      async () => ({ provider: 'anthropic', apiKey: 'x' }) as never,
      'design'
    );
    expect(tool.description).not.toContain('design-reviewer');
    // A sibling agent in the same lane, not disabled, still shows up.
    expect(tool.description).toContain('accessibility-reviewer');
    memory.close();
  });
});
