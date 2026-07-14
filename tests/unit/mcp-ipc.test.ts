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
import { getMcpServerManager } from '../../src/mcp/manager';
import type { MemoryManager } from '../../src/memory/index';

const clientCtx = { contextType: 'client' as const, clientId: 'acme', projectKey: null };

describe('mcp IPC', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    settingsStore.clear();
    registerMcpIPC();
  });

  it('registers all seven channels', () => {
    expect(handlers.has('mcp:listServers')).toBe(true);
    expect(handlers.has('mcp:setServerEnabled')).toBe(true);
    expect(handlers.has('mcp:setServerEnv')).toBe(true);
    expect(handlers.has('mcp:getServerScopeEnablement')).toBe(true);
    expect(handlers.has('mcp:setServerScopeEnablement')).toBe(true);
    expect(handlers.has('mcp:clearServerScopeEnablement')).toBe(true);
    expect(handlers.has('mcp:reauthenticateServer')).toBe(true);
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
    expect(list.find((s) => s.id === 'atelier:notion')?.configured).toBe(true);
  });

  // Reported bug: a user fills in every required credential and clicks "Save
  // credentials", reasonably expecting the server to now be set up — but
  // enabled/env used to be two fully independent flags with no UI link
  // between them, so the row stayed on "Disabled" (indistinguishable from
  // "never touched") until a SEPARATE toggle click. Completing every
  // required credential for a non-risky entry now auto-enables it in the
  // same save.
  it('mcp:setServerEnv auto-enables a non-risky server once every required credential is present', async () => {
    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    const res = (await setEnvHandler(undefined, 'atelier:notion', { NOTION_TOKEN: 'abc123' })) as {
      success: boolean;
      autoEnabled?: boolean;
    };
    expect(res.success).toBe(true);
    expect(res.autoEnabled).toBe(true);

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    const notion = list.find((s) => s.id === 'atelier:notion');
    expect(notion?.enabled).toBe(true);
    expect(notion?.configured).toBe(true);
  });

  it('mcp:setServerEnv does NOT auto-enable a risk-flagged entry, even once fully configured', async () => {
    // Find a risk-flagged catalog entry that actually requires credentials —
    // the auto-enable gate must never bypass the risk-confirm requirement
    // mcp:setServerEnabled enforces server-side.
    const { allMcpCatalogs } = await import('../../src/marketplace/registry');
    const { extractRequiredEnv } = await import('../../src/marketplace/mcp-status');
    const risky = allMcpCatalogs().find(
      (m) => !!m.entry.riskNote && extractRequiredEnv(m.entry).length > 0
    );
    expect(risky).toBeTruthy(); // sanity check the catalog still has a matching fixture
    const id = `${risky!.packId}:${risky!.entry.id}`;
    const requiredEnv = extractRequiredEnv(risky!.entry);
    const env = Object.fromEntries(requiredEnv.map((name) => [name, 'test-value']));

    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    const res = (await setEnvHandler(undefined, id, env)) as { success: boolean; autoEnabled?: boolean };
    expect(res.success).toBe(true);
    expect(res.autoEnabled).toBe(false);

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    const entry = list.find((s) => s.id === id);
    expect(entry?.configured).toBe(true);
    expect(entry?.enabled).toBe(false); // still requires the explicit confirm-gated toggle
  });

  it('mcp:setServerEnv does not re-disable or otherwise touch an already-enabled server', async () => {
    const enableHandler = handlers.get('mcp:setServerEnabled')!;
    await enableHandler(undefined, 'atelier:notion', true);

    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    const res = (await setEnvHandler(undefined, 'atelier:notion', { NOTION_TOKEN: 'abc123' })) as {
      autoEnabled?: boolean;
    };
    expect(res.autoEnabled).toBe(false); // already enabled — nothing to auto-enable

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    expect(list.find((s) => s.id === 'atelier:notion')?.enabled).toBe(true);
  });

  it('mcp:setServerEnv does not auto-enable while credentials remain incomplete', async () => {
    // notion requires only NOTION_TOKEN, so submit an unrelated/empty env to
    // simulate a partial save that never actually completes isFullyConfigured.
    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    const res = (await setEnvHandler(undefined, 'atelier:notion', {})) as {
      success: boolean;
      autoEnabled?: boolean;
    };
    expect(res.success).toBe(true);
    expect(res.autoEnabled).toBe(false);

    const listHandler = handlers.get('mcp:listServers')!;
    const list = (await listHandler()) as Array<Record<string, unknown>>;
    const notion = list.find((s) => s.id === 'atelier:notion');
    expect(notion?.enabled).toBe(false);
    expect(notion?.configured).toBe(false);
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

describe('mcp:reauthenticateServer', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    settingsStore.clear();
    registerMcpIPC();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a first-party server id', async () => {
    const handler = handlers.get('mcp:reauthenticateServer')!;
    const res = (await handler(undefined, 'first-party:computer')) as { success: boolean; message: string };
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/do not use oauth/i);
  });

  it('rejects an unknown server id', async () => {
    const handler = handlers.get('mcp:reauthenticateServer')!;
    const res = (await handler(undefined, 'atelier:does-not-exist')) as { success: boolean; message: string };
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/unknown server/i);
  });

  it('rejects an entry with no reauth command declared', async () => {
    const handler = handlers.get('mcp:reauthenticateServer')!;
    const res = (await handler(undefined, 'atelier:notion')) as { success: boolean; message: string };
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/does not support reauthentication/i);
  });

  it('resolves the reauth command and delegates to the manager, passing a respawnSpec once fully configured+enabled', async () => {
    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    await setEnvHandler(undefined, 'salon:x-api', { X_CLIENT_ID: 'id123', X_CLIENT_SECRET: 'secret456' });
    // x-api's catalog comment mentions "Pay-per-use", which trips the
    // risk-note heuristic (src/marketplace/loader.ts's RISK_RE) — so unlike a
    // plain entry, saving credentials alone does NOT auto-enable it; the
    // risk-confirm gate still requires an explicit, confirmed enable.
    const setEnabledHandler = handlers.get('mcp:setServerEnabled')!;
    await setEnabledHandler(undefined, 'salon:x-api', true, true);

    const manager = getMcpServerManager();
    const spy = vi
      .spyOn(manager, 'reauthenticateServer')
      .mockResolvedValue({ success: true, cleared: true, message: 'ok' });

    const handler = handlers.get('mcp:reauthenticateServer')!;
    const res = await handler(undefined, 'salon:x-api');
    expect(res).toEqual({ success: true, cleared: true, message: 'ok' });

    expect(spy).toHaveBeenCalledWith(
      'salon:x-api',
      { command: 'npx', args: ['-y', '@xdevplatform/xurl', 'auth', 'clear', '--all'] },
      expect.objectContaining({ kind: 'stdio', command: 'npx' })
    );
  });

  it('passes no respawnSpec when the server is not enabled (nothing valid to spawn)', async () => {
    // Store credentials via setServerEnv but immediately disable, so the
    // reauth command still resolves (it needs no stored env for x-api's
    // static `auth clear --all` args) while isFullyConfigured+enabled fails.
    const setEnvHandler = handlers.get('mcp:setServerEnv')!;
    await setEnvHandler(undefined, 'salon:x-api', { X_CLIENT_ID: 'id123', X_CLIENT_SECRET: 'secret456' });
    const setEnabledHandler = handlers.get('mcp:setServerEnabled')!;
    await setEnabledHandler(undefined, 'salon:x-api', false);

    const manager = getMcpServerManager();
    const spy = vi
      .spyOn(manager, 'reauthenticateServer')
      .mockResolvedValue({ success: true, cleared: true, message: 'cleared only' });

    const handler = handlers.get('mcp:reauthenticateServer')!;
    await handler(undefined, 'salon:x-api');

    expect(spy).toHaveBeenCalledWith('salon:x-api', expect.any(Object), undefined);
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
