/**
 * Scoped agent/MCP enablement — memory-backed resolution.
 *
 * Guarantees:
 *  1. Default (no fact anywhere): enabled, scope 'default'.
 *  2. A client-scope disable overrides an implicit/world-scope enable.
 *  3. A project-scope override wins over its parent client's decision.
 *  4. Personal context never resolves a brand's enablement fact (isolation).
 *  5. Get/set/clear at the resolved scope, and only that scope.
 *  6. isMcpEnabledAtWorldScope gates on the agency-wide (world) scope only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clientScope, projectScope, WORLD_SCOPE } from '../../src/memory/scope';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import type { SessionContext } from '../../src/memory/sessions';

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
const projectCtx: SessionContext = {
  contextType: 'project',
  clientId: 'acme',
  projectKey: 'acme-site',
};
const worldCtx: SessionContext = { contextType: 'world', clientId: null, projectKey: null };
const personalCtx: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };

async function freshMemory(): Promise<import('../../src/memory/index').MemoryManager> {
  const { MemoryManager } = await import('../../src/memory/index');
  const memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
  setCurrentSessionId('S');
  return memory;
}

describe('resolveAgentEnablement', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('defaults to enabled with scope "default" when no fact exists', async () => {
    const memory = await freshMemory();
    const { resolveAgentEnablement } = await import('../../src/agent/enablement');
    expect(resolveAgentEnablement(clientCtx, 'atelier', 'design-reviewer', 'S')).toEqual({
      enabled: true,
      scope: 'default',
    });
    memory.close();
  });

  it('a client-scope disable overrides the implicit agency-wide enable', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'enabled-agents',
      'atelier:design-reviewer',
      'false',
      false,
      clientScope('acme')
    );
    const { resolveAgentEnablement } = await import('../../src/agent/enablement');
    expect(resolveAgentEnablement(clientCtx, 'atelier', 'design-reviewer', 'S')).toEqual({
      enabled: false,
      scope: clientScope('acme'),
    });
    memory.close();
  });

  it('a project-scope override wins over its parent client scope', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'enabled-agents',
      'atelier:design-reviewer',
      'false',
      false,
      clientScope('acme')
    );
    memory.saveFact(
      'enabled-agents',
      'atelier:design-reviewer',
      'true',
      false,
      projectScope('acme-site')
    );
    const { resolveAgentEnablement } = await import('../../src/agent/enablement');
    expect(resolveAgentEnablement(projectCtx, 'atelier', 'design-reviewer', 'S')).toEqual({
      enabled: true,
      scope: projectScope('acme-site'),
    });
    memory.close();
  });

  it('a world-scope disable applies under the world context with no client override', async () => {
    const memory = await freshMemory();
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, WORLD_SCOPE);
    const { resolveAgentEnablement } = await import('../../src/agent/enablement');
    expect(resolveAgentEnablement(worldCtx, 'atelier', 'design-reviewer', 'S').enabled).toBe(false);
    memory.close();
  });

  it('personal context never resolves a brand enablement fact (isolation)', async () => {
    const memory = await freshMemory();
    memory.saveFact(
      'enabled-agents',
      'atelier:design-reviewer',
      'false',
      false,
      clientScope('acme')
    );
    const { resolveAgentEnablement } = await import('../../src/agent/enablement');
    expect(resolveAgentEnablement(personalCtx, 'atelier', 'design-reviewer', 'S')).toEqual({
      enabled: true,
      scope: 'default',
    });
    memory.close();
  });
});

describe('isAgentEnabledForCurrentSession — dispatch-time gate', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('true (degrades to enabled) when memory is not initialized', async () => {
    setMemoryManager(null as unknown as import('../../src/memory/index').MemoryManager);
    const { isAgentEnabledForCurrentSession } = await import('../../src/agent/enablement');
    expect(isAgentEnabledForCurrentSession('atelier', 'design-reviewer')).toBe(true);
  });

  it('reflects the disabled state for the current session context', async () => {
    const { MemoryManager: MM } = await import('../../src/memory/index');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    const session = memory.createSession('enablement-test', 'general', null);
    setCurrentSessionId(session.id);
    memory.setSessionContext(session.id, { contextType: 'client', clientId: 'acme', projectKey: null });
    memory.saveFact(
      'enabled-agents',
      'atelier:design-reviewer',
      'false',
      false,
      clientScope('acme')
    );

    const { isAgentEnabledForCurrentSession } = await import('../../src/agent/enablement');
    expect(isAgentEnabledForCurrentSession('atelier', 'design-reviewer')).toBe(false);
    expect(isAgentEnabledForCurrentSession('atelier', 'copywriter')).toBe(true);
    memory.close();
  });
});

describe('getAgentEnablementAtScope / setAgentEnablement / clearAgentEnablement', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('setAgentEnablement writes at the scope resolved for the context', async () => {
    const memory = await freshMemory();
    const { setAgentEnablement, getAgentEnablementAtScope } = await import('../../src/agent/enablement');
    const res = setAgentEnablement(clientCtx, 'atelier', 'design-reviewer', false);
    expect(res).toEqual({ success: true, scope: clientScope('acme') });

    const at = getAgentEnablementAtScope(clientCtx, 'atelier', 'design-reviewer');
    expect(at).toEqual({ scope: clientScope('acme'), enabled: false });
    memory.close();
  });

  it('getAgentEnablementAtScope returns null when nothing is set at that exact scope, even if a broader scope has a fact', async () => {
    const memory = await freshMemory();
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, WORLD_SCOPE);
    const { getAgentEnablementAtScope } = await import('../../src/agent/enablement');
    expect(getAgentEnablementAtScope(clientCtx, 'atelier', 'design-reviewer')).toBeNull();
    memory.close();
  });

  it('clearAgentEnablement removes only the fact at the resolved scope, restoring inheritance', async () => {
    const memory = await freshMemory();
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, WORLD_SCOPE);
    memory.saveFact(
      'enabled-agents',
      'atelier:design-reviewer',
      'true',
      false,
      clientScope('acme')
    );
    const { clearAgentEnablement, resolveAgentEnablement } = await import('../../src/agent/enablement');
    const res = clearAgentEnablement(clientCtx, 'atelier', 'design-reviewer');
    expect(res).toEqual({ success: true, scope: clientScope('acme') });

    // Client override gone; falls through to the world-scope disable.
    expect(resolveAgentEnablement(clientCtx, 'atelier', 'design-reviewer', 'S')).toEqual({
      enabled: false,
      scope: WORLD_SCOPE,
    });
    memory.close();
  });

  it('clearAgentEnablement on an already-inherited scope is a harmless no-op success', async () => {
    const memory = await freshMemory();
    const { clearAgentEnablement } = await import('../../src/agent/enablement');
    expect(clearAgentEnablement(clientCtx, 'atelier', 'design-reviewer').success).toBe(true);
    memory.close();
  });
});

describe('MCP enablement (resolveMcpEnablement / isMcpEnabledAtWorldScope)', () => {
  beforeEach(() => {
    setCurrentSessionId('S');
  });

  it('resolveMcpEnablement defaults to enabled, and respects client-over-world precedence', async () => {
    const memory = await freshMemory();
    memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, WORLD_SCOPE);
    memory.saveFact('enabled-mcp', 'atelier:notion', 'true', false, clientScope('acme'));
    const { resolveMcpEnablement } = await import('../../src/agent/enablement');
    expect(resolveMcpEnablement(clientCtx, 'atelier', 'notion', 'S')).toEqual({
      enabled: true,
      scope: clientScope('acme'),
    });
    memory.close();
  });

  it('isMcpEnabledAtWorldScope is true by default and false only after an explicit world-scope disable', async () => {
    const memory = await freshMemory();
    const { isMcpEnabledAtWorldScope } = await import('../../src/agent/enablement');
    expect(isMcpEnabledAtWorldScope('atelier', 'notion')).toBe(true);

    memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, WORLD_SCOPE);
    expect(isMcpEnabledAtWorldScope('atelier', 'notion')).toBe(false);
    memory.close();
  });

  it('isMcpEnabledAtWorldScope ignores a client-scope disable (world-only gate)', async () => {
    const memory = await freshMemory();
    memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, clientScope('acme'));
    const { isMcpEnabledAtWorldScope } = await import('../../src/agent/enablement');
    expect(isMcpEnabledAtWorldScope('atelier', 'notion')).toBe(true);
    memory.close();
  });

  it('setMcpEnablement / clearMcpEnablement round-trip at the resolved scope', async () => {
    const memory = await freshMemory();
    const { setMcpEnablement, getMcpEnablementAtScope, clearMcpEnablement } = await import(
      '../../src/agent/enablement'
    );
    setMcpEnablement(clientCtx, 'atelier', 'notion', false);
    expect(getMcpEnablementAtScope(clientCtx, 'atelier', 'notion')).toEqual({
      scope: clientScope('acme'),
      enabled: false,
    });
    clearMcpEnablement(clientCtx, 'atelier', 'notion');
    expect(getMcpEnablementAtScope(clientCtx, 'atelier', 'notion')).toBeNull();
    memory.close();
  });
});
