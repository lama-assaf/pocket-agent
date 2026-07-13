import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture ipcMain.handle registrations so tests can invoke handlers directly,
// same pattern as tests/unit/updater.test.ts.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
}));

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

import { registerMarketplaceIPC } from '../../src/main/ipc/marketplace-ipc';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { clientScope, projectScope, WORLD_SCOPE } from '../../src/memory/scope';
import type { MemoryManager } from '../../src/memory/index';

const clientCtx = { contextType: 'client' as const, clientId: 'acme', projectKey: null };
const worldCtx = { contextType: 'world' as const, clientId: null, projectKey: null };
const projectCtx = { contextType: 'project' as const, clientId: 'acme', projectKey: 'acme-site' };

describe('marketplace IPC', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerMarketplaceIPC();
  });

  it('registers all eight channels', () => {
    expect(handlers.has('marketplace:listAgents')).toBe(true);
    expect(handlers.has('marketplace:getAgent')).toBe(true);
    expect(handlers.has('marketplace:getAgentOverride')).toBe(true);
    expect(handlers.has('marketplace:setAgentOverride')).toBe(true);
    expect(handlers.has('marketplace:clearAgentOverride')).toBe(true);
    expect(handlers.has('marketplace:getAgentEnablement')).toBe(true);
    expect(handlers.has('marketplace:setAgentEnablement')).toBe(true);
    expect(handlers.has('marketplace:clearAgentEnablement')).toBe(true);
  });

  it('marketplace:listAgents returns every pack agent shaped for the UI (no prompt field)', async () => {
    const handler = handlers.get('marketplace:listAgents')!;
    const result = (await handler({})) as Array<Record<string, unknown>>;
    expect(result.length).toBeGreaterThanOrEqual(17);
    const dr = result.find((a) => a.name === 'design-reviewer');
    expect(dr).toMatchObject({
      packId: 'atelier',
      packName: 'Atelier',
      lane: 'design',
      name: 'design-reviewer',
    });
    expect(dr).toHaveProperty('description');
    expect(dr).toHaveProperty('tools');
    expect(dr).not.toHaveProperty('prompt');
  });

  it('marketplace:getAgent returns full detail including the prompt', async () => {
    const handler = handlers.get('marketplace:getAgent')!;
    const result = (await handler({}, 'atelier', 'design-reviewer')) as Record<string, unknown>;
    expect(result).toMatchObject({ packId: 'atelier', name: 'design-reviewer' });
    expect(typeof result.prompt).toBe('string');
    expect((result.prompt as string).length).toBeGreaterThan(0);
  });

  it('marketplace:getAgent returns null for an unknown pack/name pair', async () => {
    const handler = handlers.get('marketplace:getAgent')!;
    expect(await handler({}, 'atelier', 'does-not-exist')).toBeNull();
    expect(await handler({}, 'unknown-pack', 'design-reviewer')).toBeNull();
  });

  it('marketplace:listAgents/getAgent report hasOverride: false and enabled: true (default) with no memory manager or context', async () => {
    const listHandler = handlers.get('marketplace:listAgents')!;
    const list = (await listHandler({})) as Array<Record<string, unknown>>;
    const dr = list.find((a) => a.name === 'design-reviewer');
    expect(dr?.hasOverride).toBe(false);
    expect(dr?.enabled).toBe(true);
    expect(dr?.enablementScope).toBe('default');

    const getHandler = handlers.get('marketplace:getAgent')!;
    const detail = (await getHandler({}, 'atelier', 'design-reviewer')) as Record<string, unknown>;
    expect(detail.hasOverride).toBe(false);
    expect(detail.basePrompt).toBe(detail.prompt);
    expect(detail.enabled).toBe(true);
  });
});

describe('marketplace IPC — override resolution + CRUD', () => {
  let memory: MemoryManager;

  beforeEach(async () => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerMarketplaceIPC();
    const { MemoryManager: MM } = await import('../../src/memory/index');
    memory = new MM(':memory:');
    setMemoryManager(memory);
  });

  afterEach(() => {
    memory.close();
    setMemoryManager(null as unknown as MemoryManager);
  });

  it('marketplace:getAgent merges a client-scope override into the effective prompt, keeping basePrompt as the default', async () => {
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ prompt: 'CLIENT CUSTOM PROMPT' }),
      false,
      clientScope('acme')
    );

    const getHandler = handlers.get('marketplace:getAgent')!;
    const detail = (await getHandler(
      {},
      'atelier',
      'design-reviewer',
      clientCtx
    )) as Record<string, unknown>;
    expect(detail.prompt).toBe('CLIENT CUSTOM PROMPT');
    expect(detail.basePrompt).not.toBe('CLIENT CUSTOM PROMPT');
    expect(detail.hasOverride).toBe(true);
    expect(detail.overrideScope).toBe(clientScope('acme'));
  });

  it('marketplace:listAgents flags hasOverride per agent for the given context', async () => {
    memory.saveFact(
      'agent-override',
      'atelier:design-reviewer',
      JSON.stringify({ model: 'claude-opus-4-8' }),
      false,
      WORLD_SCOPE
    );

    const listHandler = handlers.get('marketplace:listAgents')!;
    const list = (await listHandler({}, worldCtx)) as Array<Record<string, unknown>>;
    const dr = list.find((a) => a.name === 'design-reviewer');
    const other = list.find((a) => a.name === 'copywriter');
    expect(dr?.hasOverride).toBe(true);
    expect(dr?.model).toBe('claude-opus-4-8');
    expect(other?.hasOverride).toBe(false);
  });

  it('set → get → clear round-trips through the IPC channels, respecting the active scope', async () => {
    const setHandler = handlers.get('marketplace:setAgentOverride')!;
    const getOverrideHandler = handlers.get('marketplace:getAgentOverride')!;
    const clearHandler = handlers.get('marketplace:clearAgentOverride')!;

    const setRes = (await setHandler(
      {},
      'atelier',
      'design-reviewer',
      { prompt: 'EDITED VIA IPC' },
      clientCtx
    )) as { success: boolean; scope?: string };
    expect(setRes.success).toBe(true);
    expect(setRes.scope).toBe(clientScope('acme'));

    const got = (await getOverrideHandler({}, 'atelier', 'design-reviewer', clientCtx)) as {
      scope: string;
      fields: { prompt?: string };
    } | null;
    expect(got?.scope).toBe(clientScope('acme'));
    expect(got?.fields.prompt).toBe('EDITED VIA IPC');

    const clearRes = (await clearHandler({}, 'atelier', 'design-reviewer', clientCtx)) as {
      success: boolean;
    };
    expect(clearRes.success).toBe(true);
    expect(await getOverrideHandler({}, 'atelier', 'design-reviewer', clientCtx)).toBeNull();
  });

  it('marketplace:setAgentOverride rejects an empty field set', async () => {
    const setHandler = handlers.get('marketplace:setAgentOverride')!;
    const res = (await setHandler({}, 'atelier', 'design-reviewer', {}, clientCtx)) as {
      success: boolean;
    };
    expect(res.success).toBe(false);
  });

  it('clearAgentOverride only clears the active scope, not a broader one', async () => {
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

    const clearHandler = handlers.get('marketplace:clearAgentOverride')!;
    await clearHandler({}, 'atelier', 'design-reviewer', clientCtx);

    const getHandler = handlers.get('marketplace:getAgent')!;
    const detail = (await getHandler(
      {},
      'atelier',
      'design-reviewer',
      clientCtx
    )) as Record<string, unknown>;
    // Falls through to the world override — not the base — since only the client scope was cleared.
    expect(detail.prompt).toBe('WORLD PROMPT');
  });
});

describe('marketplace IPC — scoped enablement (Phase 4)', () => {
  let memory: MemoryManager;

  beforeEach(async () => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerMarketplaceIPC();
    const { MemoryManager: MM } = await import('../../src/memory/index');
    memory = new MM(':memory:');
    setMemoryManager(memory);
  });

  afterEach(() => {
    memory.close();
    setMemoryManager(null as unknown as MemoryManager);
  });

  it('marketplace:listAgents/getAgent reflect a client-scope disable', async () => {
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, clientScope('acme'));

    const listHandler = handlers.get('marketplace:listAgents')!;
    const list = (await listHandler({}, clientCtx)) as Array<Record<string, unknown>>;
    const dr = list.find((a) => a.name === 'design-reviewer');
    expect(dr?.enabled).toBe(false);
    expect(dr?.enablementScope).toBe(clientScope('acme'));

    const getHandler = handlers.get('marketplace:getAgent')!;
    const detail = (await getHandler({}, 'atelier', 'design-reviewer', clientCtx)) as Record<string, unknown>;
    expect(detail.enabled).toBe(false);
  });

  it('a project-scope enablement overrides its parent client scope', async () => {
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, clientScope('acme'));
    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'true', false, projectScope('acme-site'));

    const getHandler = handlers.get('marketplace:getAgent')!;
    const detail = (await getHandler({}, 'atelier', 'design-reviewer', projectCtx)) as Record<string, unknown>;
    expect(detail.enabled).toBe(true);
    expect(detail.enablementScope).toBe(projectScope('acme-site'));
  });

  it('set → get → clear round-trips enablement through the IPC channels', async () => {
    const setHandler = handlers.get('marketplace:setAgentEnablement')!;
    const getHandler = handlers.get('marketplace:getAgentEnablement')!;
    const clearHandler = handlers.get('marketplace:clearAgentEnablement')!;

    const setRes = (await setHandler({}, 'atelier', 'design-reviewer', false, clientCtx)) as {
      success: boolean;
      scope?: string;
    };
    expect(setRes.success).toBe(true);
    expect(setRes.scope).toBe(clientScope('acme'));

    const got = (await getHandler({}, 'atelier', 'design-reviewer', clientCtx)) as {
      scope: string;
      enabled: boolean;
    } | null;
    expect(got).toEqual({ scope: clientScope('acme'), enabled: false });

    const clearRes = (await clearHandler({}, 'atelier', 'design-reviewer', clientCtx)) as {
      success: boolean;
    };
    expect(clearRes.success).toBe(true);
    expect(await getHandler({}, 'atelier', 'design-reviewer', clientCtx)).toBeNull();
  });
});
