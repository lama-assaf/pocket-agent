import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture ipcMain.handle registrations, same pattern as marketplace-ipc.test.ts.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
}));

// In-memory SettingsManager stub — real persistence semantics (get/set round-trip)
// without touching SQLite/safeStorage.
const settingsStore = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => settingsStore.get(key) ?? ''),
    set: vi.fn((key: string, value: string) => {
      settingsStore.set(key, value);
    }),
  },
}));

// Stub only the async embedding writes so MemoryManager needs no embedding model
// (only the Phase 4 scoped-enablement tests below construct a real MemoryManager).
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

import { registerMcpIPC } from '../../src/main/ipc/mcp-ipc';
import { MCP_MARKETPLACE_CONFIG_KEY } from '../../src/agent/mcp-marketplace';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { clientScope, WORLD_SCOPE } from '../../src/memory/scope';
import type { MemoryManager } from '../../src/memory/index';

const clientCtx = { contextType: 'client' as const, clientId: 'acme', projectKey: null };

describe('mcp IPC', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    settingsStore.clear();
    registerMcpIPC();
  });

  it('registers all six channels', () => {
    expect(handlers.has('mcp:listServers')).toBe(true);
    expect(handlers.has('mcp:setServerEnabled')).toBe(true);
    expect(handlers.has('mcp:setServerEnv')).toBe(true);
    expect(handlers.has('mcp:getServerScopeEnablement')).toBe(true);
    expect(handlers.has('mcp:setServerScopeEnablement')).toBe(true);
    expect(handlers.has('mcp:clearServerScopeEnablement')).toBe(true);
  });

  it('mcp:listServers merges first-party and marketplace entries into one list', async () => {
    const handler = handlers.get('mcp:listServers')!;
    const list = (await handler()) as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThan(0);
    const notion = list.find((s) => s.id === 'atelier:notion');
    expect(notion).toMatchObject({
      source: 'atelier',
      kind: 'stdio',
      toggleable: true,
      enabled: false,
      configured: false,
      scopeEnabled: true,
      scopeEnablementScope: 'default',
    });
    expect(notion?.requiredEnv).toEqual(['NOTION_TOKEN']);
  });

  it('mcp:setServerEnabled rejects toggling a first-party server', async () => {
    const handler = handlers.get('mcp:setServerEnabled')!;
    const res = (await handler(undefined, 'first-party:computer', true)) as {
      success: boolean;
      error?: string;
    };
    expect(res.success).toBe(false);
  });

  it('mcp:setServerEnabled rejects an unknown server id', async () => {
    const handler = handlers.get('mcp:setServerEnabled')!;
    const res = (await handler(undefined, 'atelier:does-not-exist', true)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  it('mcp:setServerEnabled enables a non-risky server without confirmation', async () => {
    const handler = handlers.get('mcp:setServerEnabled')!;
    const res = (await handler(undefined, 'atelier:notion', true)) as { success: boolean };
    expect(res.success).toBe(true);

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    expect(list.find((s) => s.id === 'atelier:notion')?.enabled).toBe(true);
  });

  it('mcp:setServerEnabled requires confirmed:true for a risk-flagged entry, even server-side', async () => {
    const handler = handlers.get('mcp:setServerEnabled')!;
    const unconfirmed = (await handler(undefined, 'salon:linkedin-unofficial', true)) as {
      success: boolean;
      riskNote?: string;
    };
    expect(unconfirmed.success).toBe(false);
    expect(unconfirmed.riskNote).toBeTruthy();

    const listHandler = handlers.get('mcp:listServers')!;
    const listAfterRejected = (await listHandler()) as Array<Record<string, unknown>>;
    expect(listAfterRejected.find((s) => s.id === 'salon:linkedin-unofficial')?.enabled).toBe(false);

    const confirmed = (await handler(undefined, 'salon:linkedin-unofficial', true, true)) as {
      success: boolean;
    };
    expect(confirmed.success).toBe(true);
  });

  it('disabling a risk-flagged entry needs no confirmation', async () => {
    const enableHandler = handlers.get('mcp:setServerEnabled')!;
    await enableHandler(undefined, 'salon:linkedin-unofficial', true, true);

    const res = (await enableHandler(undefined, 'salon:linkedin-unofficial', false)) as {
      success: boolean;
    };
    expect(res.success).toBe(true);
  });

  it('mcp:setServerEnv rejects a first-party server id', async () => {
    const handler = handlers.get('mcp:setServerEnv')!;
    const res = (await handler(undefined, 'first-party:computer', { X: 'y' })) as {
      success: boolean;
    };
    expect(res.success).toBe(false);
  });

  it('mcp:setServerEnv stores credentials, reflected as configured on the next list', async () => {
    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    const res = (await setEnvHandler(undefined, 'atelier:notion', { NOTION_TOKEN: 'abc123' })) as {
      success: boolean;
    };
    expect(res.success).toBe(true);

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    // configured requires the env var; enabled is a separate flag (still false here).
    expect(list.find((s) => s.id === 'atelier:notion')?.configured).toBe(true);
  });

  it('mcp:setServerEnv only overwrites keys with a non-empty submitted value (blank = unchanged)', async () => {
    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    await setEnvHandler(undefined, 'atelier:notion', { NOTION_TOKEN: 'first-value' });
    await setEnvHandler(undefined, 'atelier:notion', { NOTION_TOKEN: '' });

    const stored = JSON.parse(settingsStore.get(MCP_MARKETPLACE_CONFIG_KEY) || '{}');
    expect(stored['atelier:notion'].env.NOTION_TOKEN).toBe('first-value');
  });

  it('an enabled server missing required env reports configured: false ("missing credentials")', async () => {
    const enableHandler = handlers.get('mcp:setServerEnabled')!;
    await enableHandler(undefined, 'atelier:notion', true);

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    const notion = list.find((s) => s.id === 'atelier:notion');
    expect(notion?.enabled).toBe(true);
    expect(notion?.configured).toBe(false);
  });
});

describe('mcp IPC — scoped enablement (Phase 4)', () => {
  let memory: MemoryManager;

  beforeEach(async () => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    settingsStore.clear();
    registerMcpIPC();
    const { MemoryManager: MM } = await import('../../src/memory/index');
    memory = new MM(':memory:');
    setMemoryManager(memory);
  });

  afterEach(() => {
    memory.close();
    setMemoryManager(null as unknown as MemoryManager);
  });

  it('mcp:listServers reflects a client-scope disable via scopeEnabled/scopeEnablementScope', async () => {
    memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, clientScope('acme'));

    const handler = handlers.get('mcp:listServers')!;
    const list = (await handler(undefined, clientCtx)) as Array<Record<string, unknown>>;
    const notion = list.find((s) => s.id === 'atelier:notion');
    expect(notion?.scopeEnabled).toBe(false);
    expect(notion?.scopeEnablementScope).toBe(clientScope('acme'));
  });

  it('a client-scope re-enable overrides a world-scope disable in the resolved list', async () => {
    memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, WORLD_SCOPE);
    memory.saveFact('enabled-mcp', 'atelier:notion', 'true', false, clientScope('acme'));

    const handler = handlers.get('mcp:listServers')!;
    const list = (await handler(undefined, clientCtx)) as Array<Record<string, unknown>>;
    expect(list.find((s) => s.id === 'atelier:notion')?.scopeEnabled).toBe(true);
  });

  it('mcp:getServerScopeEnablement / setServerScopeEnablement / clearServerScopeEnablement round-trip', async () => {
    const setHandler = handlers.get('mcp:setServerScopeEnablement')!;
    const getHandler = handlers.get('mcp:getServerScopeEnablement')!;
    const clearHandler = handlers.get('mcp:clearServerScopeEnablement')!;

    const setRes = (await setHandler(undefined, 'atelier:notion', false, clientCtx)) as {
      success: boolean;
      scope?: string;
    };
    expect(setRes.success).toBe(true);
    expect(setRes.scope).toBe(clientScope('acme'));

    const got = (await getHandler(undefined, 'atelier:notion', clientCtx)) as {
      scope: string;
      enabled: boolean;
    } | null;
    expect(got).toEqual({ scope: clientScope('acme'), enabled: false });

    const clearRes = (await clearHandler(undefined, 'atelier:notion', clientCtx)) as { success: boolean };
    expect(clearRes.success).toBe(true);
    expect(await getHandler(undefined, 'atelier:notion', clientCtx)).toBeNull();
  });

  it('mcp:getServerScopeEnablement returns null for an unknown server id', async () => {
    const getHandler = handlers.get('mcp:getServerScopeEnablement')!;
    expect(await getHandler(undefined, 'atelier:does-not-exist', clientCtx)).toBeNull();
  });
});
