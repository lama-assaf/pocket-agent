import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory SettingsManager stub so buildMarketplaceMcpServers reads/writes
// the same store setServerEnabled/setServerEnv would use in mcp-ipc.ts.
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
// (only the Phase 4 world-scope-gate tests below construct a real MemoryManager).
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

import { buildMarketplaceMcpServers, MCP_MARKETPLACE_CONFIG_KEY } from '../../src/agent/mcp-marketplace';

describe('buildMarketplaceMcpServers', () => {
  beforeEach(() => {
    settingsStore.clear();
  });

  it('returns {} when no marketplace config is stored', () => {
    expect(buildMarketplaceMcpServers()).toEqual({});
  });

  it('returns {} when the stored config has no enabled entries', () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'atelier:notion': { enabled: false, env: { NOTION_TOKEN: 'abc' } } })
    );
    expect(buildMarketplaceMcpServers()).toEqual({});
  });

  it('excludes an enabled server missing required env — never reaches the agent config', () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'atelier:notion': { enabled: true, env: {} } })
    );
    expect(buildMarketplaceMcpServers()).toEqual({});
  });

  it('includes a stdio server that is enabled and fully configured, as a MCPServerConfig', () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc123' } } })
    );
    const servers = buildMarketplaceMcpServers();
    expect(servers['atelier:notion']).toMatchObject({
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
    });
    expect(servers['atelier:notion']).toHaveProperty('env');
    expect((servers['atelier:notion'] as { env: Record<string, string> }).env.OPENAPI_MCP_HEADERS).toContain(
      'abc123'
    );
  });

  it('includes a url server as {url, headers}', () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'salon:buffer': { enabled: true, env: { BUFFER_API_KEY: 'secret' } } })
    );
    const servers = buildMarketplaceMcpServers();
    expect(servers['salon:buffer']).toEqual({
      url: 'https://mcp.buffer.com/mcp',
      headers: { Authorization: 'Bearer secret' },
    });
  });

  it('a zero-env catalog entry (e.g. hacker-news) needs only enabled: true', () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'salon:hacker-news': { enabled: true, env: {} } })
    );
    const servers = buildMarketplaceMcpServers();
    expect(servers['salon:hacker-news']).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-hacker-news'],
      env: {},
    });
  });

  it('mixes enabled/disabled/under-configured entries, only surfacing the ones that pass', () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({
        'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc' } },
        'atelier:figma-dev-mode': { enabled: false, env: { FIGMA_API_KEY: 'x' } },
        'atelier:posthog': { enabled: true, env: {} },
      })
    );
    const servers = buildMarketplaceMcpServers();
    expect(Object.keys(servers)).toEqual(['atelier:notion']);
  });

  it('degrades to {} on malformed stored JSON rather than throwing', () => {
    settingsStore.set(MCP_MARKETPLACE_CONFIG_KEY, 'not json');
    expect(() => buildMarketplaceMcpServers()).not.toThrow();
    expect(buildMarketplaceMcpServers()).toEqual({});
  });
});

describe('buildMarketplaceMcpServers — Phase 4 world-scope enablement gate', () => {
  beforeEach(() => {
    settingsStore.clear();
  });

  it('excludes a server explicitly disabled at the agency-wide (world) scope, even when settings-enabled and configured', async () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc123' } } })
    );

    const { MemoryManager: MM } = await import('../../src/memory/index');
    const { setMemoryManager } = await import('../../src/tools/memory-tools');
    const { WORLD_SCOPE } = await import('../../src/memory/scope');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    try {
      memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, WORLD_SCOPE);
      expect(buildMarketplaceMcpServers()).toEqual({});
    } finally {
      memory.close();
      setMemoryManager(null as unknown as import('../../src/memory/index').MemoryManager);
    }
  });

  it('a client-scope-only disable does NOT affect this boot-time (world-gated) list', async () => {
    settingsStore.set(
      MCP_MARKETPLACE_CONFIG_KEY,
      JSON.stringify({ 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc123' } } })
    );

    const { MemoryManager: MM } = await import('../../src/memory/index');
    const { setMemoryManager } = await import('../../src/tools/memory-tools');
    const { clientScope } = await import('../../src/memory/scope');
    const memory = new MM(':memory:');
    setMemoryManager(memory);
    try {
      memory.saveFact('enabled-mcp', 'atelier:notion', 'false', false, clientScope('acme'));
      expect(buildMarketplaceMcpServers()).toHaveProperty('atelier:notion');
    } finally {
      memory.close();
      setMemoryManager(null as unknown as import('../../src/memory/index').MemoryManager);
    }
  });
});
