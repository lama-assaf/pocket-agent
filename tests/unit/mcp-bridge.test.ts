/**
 * End-to-end MCP bridge tests (roadmap item 5, steps 2+3): a marketplace
 * catalog entry pointed at the real mock stdio server
 * (tests/fixtures/mock-mcp-server.mjs) is bridged into AgentTool[] only when
 * it clears the ENTIRE gating chain — settings-enabled, credentials
 * complete, and scope enablement (Phase 3/4) — and the resulting tool
 * actually round-trips a call through the real spawned process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/mock-mcp-server.mjs');

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

// One fixture catalog entry — a stdio server pointed at our mock binary,
// requiring a MOCK_TOKEN credential (so the "missing creds" gate is testable).
const FIXTURE_ENTRY = {
  id: 'echo-server',
  kind: 'stdio' as const,
  description: 'Test fixture MCP server',
  command: process.execPath,
  args: [FIXTURE],
  env: { MOCK_MCP_MODE: 'normal', MOCK_TOKEN: '${MOCK_TOKEN}' },
};

vi.mock('../../src/marketplace/registry', () => ({
  allMcpCatalogs: () => [{ packId: 'testpack', entry: FIXTURE_ENTRY }],
}));

const settingsStore = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (key: string) => settingsStore.get(key) ?? '',
    set: (key: string, value: string) => {
      settingsStore.set(key, value);
    },
  },
}));

import { getMcpBridgedTools, resolveSessionMcpServers } from '../../src/agent/mcp-bridge';
import { resetMcpServerManagerForTests } from '../../src/mcp/manager';
import { MemoryManager } from '../../src/memory/index';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { clientScope, WORLD_SCOPE } from '../../src/memory/scope';
import type { SessionContext } from '../../src/memory/sessions';

const MCP_MARKETPLACE_CONFIG_KEY = 'mcp.marketplace.config';

function setConfig(enabled: boolean, env: Record<string, string> = {}): void {
  settingsStore.set(
    MCP_MARKETPLACE_CONFIG_KEY,
    JSON.stringify({ 'testpack:echo-server': { enabled, env } })
  );
}

const clientCtx: SessionContext = { contextType: 'client', clientId: 'acme', projectKey: null };

let memory: MemoryManager;

beforeEach(() => {
  settingsStore.clear();
  resetMcpServerManagerForTests();
  memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
});

afterEach(async () => {
  const { getMcpServerManager } = await import('../../src/mcp/manager');
  await getMcpServerManager().shutdownAll();
  memory.close();
});

describe('resolveSessionMcpServers — the full gating chain', () => {
  it('excludes a server with no sessionContext at all (conservative default)', () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    expect(resolveSessionMcpServers(undefined, 'S')).toEqual({});
  });

  it('excludes a disabled server even with credentials present', () => {
    setConfig(false, { MOCK_TOKEN: 'abc' });
    expect(resolveSessionMcpServers(clientCtx, 'S')).toEqual({});
  });

  it('excludes an enabled server missing required credentials', () => {
    setConfig(true, {}); // no MOCK_TOKEN
    expect(resolveSessionMcpServers(clientCtx, 'S')).toEqual({});
  });

  it('includes a server that is enabled AND fully configured AND scope-allowed', () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    const resolved = resolveSessionMcpServers(clientCtx, 'S');
    expect(Object.keys(resolved)).toEqual(['testpack:echo-server']);
  });

  it('excludes a server disabled at scope, even when enabled+configured at settings level', () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    // Disable at the client scope via a real scoped fact (Phase 4 mechanism).
    memory.saveFact('enabled-mcp', 'testpack:echo-server', 'false', false, clientScope('acme'));
    expect(resolveSessionMcpServers(clientCtx, 'S')).toEqual({});
  });

  it('a world-scope disable is overridden by a nearer client-scope re-enable', () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    memory.saveFact('enabled-mcp', 'testpack:echo-server', 'false', false, WORLD_SCOPE);
    memory.saveFact('enabled-mcp', 'testpack:echo-server', 'true', false, clientScope('acme'));
    expect(Object.keys(resolveSessionMcpServers(clientCtx, 'S'))).toEqual(['testpack:echo-server']);
  });
});

describe('getMcpBridgedTools — namespacing, schema passthrough, call round-trip', () => {
  it('never spawns anything (returns []) when no session context is given', async () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    const tools = await getMcpBridgedTools(undefined, 'S');
    expect(tools).toEqual([]);
  });

  it('never spawns anything when the server is disabled', async () => {
    setConfig(false, { MOCK_TOKEN: 'abc' });
    const tools = await getMcpBridgedTools(clientCtx, 'S');
    expect(tools).toEqual([]);
    const { getMcpServerManager } = await import('../../src/mcp/manager');
    expect(getMcpServerManager().getStatus('testpack:echo-server')).toBe('not_started');
  });

  it('never spawns anything when credentials are missing', async () => {
    setConfig(true, {});
    const tools = await getMcpBridgedTools(clientCtx, 'S');
    expect(tools).toEqual([]);
    const { getMcpServerManager } = await import('../../src/mcp/manager');
    expect(getMcpServerManager().getStatus('testpack:echo-server')).toBe('not_started');
  });

  it('never spawns anything when scope-disabled for this context', async () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    memory.saveFact('enabled-mcp', 'testpack:echo-server', 'false', false, clientScope('acme'));
    const tools = await getMcpBridgedTools(clientCtx, 'S');
    expect(tools).toEqual([]);
    const { getMcpServerManager } = await import('../../src/mcp/manager');
    expect(getMcpServerManager().getStatus('testpack:echo-server')).toBe('not_started');
  });

  it('bridges a namespaced AgentTool (mcp_<entryId>_<toolName>) when fully gated', async () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    const tools = await getMcpBridgedTools(clientCtx, 'S');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_echo_server_echo');
    expect(tools[0].description).toContain('echo-server');
  });

  it('passes through the MCP tool\u2019s input schema (required "message" field)', async () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    const tools = await getMcpBridgedTools(clientCtx, 'S');
    const parsed = tools[0].parameters.safeParse({});
    expect(parsed.success).toBe(false); // "message" is required
    const ok = tools[0].parameters.safeParse({ message: 'hi' });
    expect(ok.success).toBe(true);
  });

  it('calling the bridged tool round-trips through the real spawned process', async () => {
    setConfig(true, { MOCK_TOKEN: 'abc' });
    const tools = await getMcpBridgedTools(clientCtx, 'S');
    const result = await tools[0].execute(
      { message: 'hello from the bridge' },
      { signal: new AbortController().signal, toolCallId: 'call-1' }
    );
    expect(typeof result).toBe('string');
    expect(JSON.parse(result as string)).toEqual({ message: 'hello from the bridge' });
  });

  it('a server that fails to connect contributes no tools without throwing', async () => {
    // Point the same gated entry at a mode that crashes on start.
    FIXTURE_ENTRY.env.MOCK_MCP_MODE = 'crash_on_start';
    try {
      setConfig(true, { MOCK_TOKEN: 'abc' });
      const tools = await getMcpBridgedTools(clientCtx, 'S');
      expect(tools).toEqual([]);
      const { getMcpServerManager } = await import('../../src/mcp/manager');
      expect(getMcpServerManager().getStatus('testpack:echo-server')).toBe('failed');
    } finally {
      FIXTURE_ENTRY.env.MOCK_MCP_MODE = 'normal'; // restore for other tests
    }
  });
});
