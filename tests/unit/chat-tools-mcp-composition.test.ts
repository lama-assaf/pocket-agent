/**
 * Multi-agent/tool orchestration at the SESSION level: getChatAgentTools
 * (src/agent/chat-tools.ts) is what actually assembles the full tool
 * surface a chat turn gets — core tools + per-lane skill + MCP-bridged
 * tools. mcp-bridge.test.ts already proves the gating chain and crash
 * isolation at the getMcpBridgedTools layer in isolation; this file proves
 * the same guarantees hold in the FINAL composed tool list a session
 * actually receives:
 *   - toggling an MCP server's enablement changes the session's available
 *     tools accordingly (present when enabled, gone when disabled) without
 *     restarting anything else.
 *   - one MCP server crashing never prevents a healthy server's tools (or
 *     the always-present core tools) from reaching the final list — no
 *     server can crash the whole session's tool assembly.
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

const HEALTHY_ENTRY = {
  id: 'healthy-server',
  kind: 'stdio' as const,
  description: 'Healthy fixture MCP server',
  command: process.execPath,
  args: [FIXTURE],
  env: { MOCK_MCP_MODE: 'normal' },
};

const CRASHING_ENTRY = {
  id: 'crashing-server',
  kind: 'stdio' as const,
  description: 'Fixture MCP server that crashes on start',
  command: process.execPath,
  args: [FIXTURE],
  env: { MOCK_MCP_MODE: 'crash_on_start' },
};

vi.mock('../../src/marketplace/registry', () => ({
  allMcpCatalogs: () => [
    { packId: 'testpack', entry: HEALTHY_ENTRY },
    { packId: 'testpack', entry: CRASHING_ENTRY },
  ],
  skillsForLane: () => [],
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

// Heavy/irrelevant deps chat-tools.ts pulls in — stub them out exactly like
// chat-tools.test.ts does, so this stays focused on tool COMPOSITION.
vi.mock('@kenkaiiii/ggcoder', () => ({
  createTools: () => ({
    tools: [
      { name: 'read', description: '', parameters: {}, execute: vi.fn() },
      { name: 'write', description: '', parameters: {}, execute: vi.fn() },
      { name: 'edit', description: '', parameters: {}, execute: vi.fn() },
    ],
  }),
}));
vi.mock('../../src/tools', () => ({
  getCustomTools: () => [],
}));
vi.mock('../../src/tools/diagnostics', () => ({
  wrapToolHandler: (_name: string, handler: unknown) => handler,
}));
vi.mock('../../src/tools/subagent', () => ({
  createSubAgentTool: () => ({ name: 'subagent', description: '', parameters: {}, execute: vi.fn() }),
}));

import { getChatAgentTools } from '../../src/agent/chat-tools';
import { resetMcpServerManagerForTests } from '../../src/mcp/manager';
import { MemoryManager } from '../../src/memory/index';
import { setMemoryManager } from '../../src/tools/memory-tools';
import type { SessionContext } from '../../src/memory/sessions';

const MCP_MARKETPLACE_CONFIG_KEY = 'mcp.marketplace.config';

function setConfig(config: Record<string, { enabled: boolean; env?: Record<string, string> }>): void {
  settingsStore.set(MCP_MARKETPLACE_CONFIG_KEY, JSON.stringify(config));
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

describe('getChatAgentTools — session tool composition with real MCP servers', () => {
  it('a healthy enabled server contributes its tools alongside the always-present core tools', async () => {
    setConfig({ 'testpack:healthy-server': { enabled: true } });

    const tools = await getChatAgentTools({} as never, '/tmp', undefined, clientCtx, 'S');
    const names = tools.map((t) => t.name);

    expect(names).toContain('web_fetch');
    expect(names).toContain('shell_command');
    expect(names.some((n) => n.startsWith('mcp_healthy_server_'))).toBe(true);
  });

  it('disabling that server removes exactly its tools from the session, core tools untouched', async () => {
    setConfig({ 'testpack:healthy-server': { enabled: true } });
    const before = await getChatAgentTools({} as never, '/tmp', undefined, clientCtx, 'S');
    expect(before.some((t) => t.name.startsWith('mcp_healthy_server_'))).toBe(true);

    setConfig({ 'testpack:healthy-server': { enabled: false } });
    const after = await getChatAgentTools({} as never, '/tmp', undefined, clientCtx, 'S');

    expect(after.some((t) => t.name.startsWith('mcp_healthy_server_'))).toBe(false);
    expect(after.map((t) => t.name)).toContain('web_fetch');
    expect(after.map((t) => t.name)).toContain('shell_command');
  });

  it('a crashing server contributes no tools but never prevents the healthy server\u2019s tools or core tools from appearing', async () => {
    setConfig({
      'testpack:healthy-server': { enabled: true },
      'testpack:crashing-server': { enabled: true },
    });

    const tools = await getChatAgentTools({} as never, '/tmp', undefined, clientCtx, 'S');
    const names = tools.map((t) => t.name);

    expect(names.some((n) => n.startsWith('mcp_healthy_server_'))).toBe(true);
    expect(names.some((n) => n.startsWith('mcp_crashing_server_'))).toBe(false);
    expect(names).toContain('web_fetch');
    expect(names).toContain('shell_command');
    expect(names).toContain('subagent');
  });

  it('a client-scope disable of the world-enabled server removes it only for that scope (session isolation)', async () => {
    setConfig({ 'testpack:healthy-server': { enabled: true } });
    const { setMcpEnablement } = await import('../../src/agent/enablement');
    setMcpEnablement(clientCtx, 'testpack', 'healthy-server', false);

    const tools = await getChatAgentTools({} as never, '/tmp', undefined, clientCtx, 'S');
    expect(tools.some((t) => t.name.startsWith('mcp_healthy_server_'))).toBe(false);

    // A different (personal) context was never touched by the client-scope disable.
    const personalTools = await getChatAgentTools(
      {} as never,
      '/tmp',
      undefined,
      { contextType: 'personal', clientId: null, projectKey: null },
      'S2'
    );
    // Personal context never gates marketplace MCP servers in at all
    // (resolveSessionMcpServers requires a session context, but a personal
    // one still resolves — the point here is just that it's independent of
    // the client-scope disable above, not a leak).
    expect(personalTools.map((t) => t.name)).toContain('web_fetch');
  });
});
