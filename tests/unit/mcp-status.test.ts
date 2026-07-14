import { describe, it, expect } from 'vitest';
import {
  extractRequiredEnv,
  substitutePlaceholders,
  isFullyConfigured,
  marketplaceEntryId,
  parseMcpMarketplaceConfig,
  serializeMcpMarketplaceConfig,
  buildMcpServerStatusList,
  resolveMcpServer,
  resolveReauthCommand,
  buildEnabledResolvedServers,
  type McpMarketplaceConfig,
} from '../../src/marketplace/mcp-status';
import type { McpCatalogEntry } from '../../src/marketplace/types';

const stdioEntry: McpCatalogEntry = {
  id: 'notion',
  kind: 'stdio',
  description: 'Notion pages, databases, search',
  command: 'npx',
  args: ['-y', '@notionhq/notion-mcp-server'],
  env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ${NOTION_TOKEN}"}' },
};

const urlEntry: McpCatalogEntry = {
  id: 'buffer',
  kind: 'url',
  description: 'Scheduling across connected channels',
  url: 'https://mcp.buffer.com/mcp',
  headers: { Authorization: 'Bearer ${BUFFER_API_KEY}' },
};

const riskEntry: McpCatalogEntry = {
  id: 'linkedin-unofficial',
  kind: 'stdio',
  description: 'Unofficial scraper',
  riskNote: 'RISK-FLAGGED: browser-session scraper',
  command: 'uvx',
  args: ['mcp-server-linkedin@latest'],
};

const noEnvEntry: McpCatalogEntry = {
  id: 'hacker-news',
  kind: 'stdio',
  description: 'Zero-config',
  command: 'npx',
  args: ['-y', 'mcp-hacker-news'],
};

const oauthEntry: McpCatalogEntry = {
  id: 'x-api',
  kind: 'stdio',
  description: 'X API via xurl OAuth bridge',
  command: 'npx',
  args: ['-y', '@xdevplatform/xurl', 'mcp', 'https://api.x.com/mcp'],
  env: { CLIENT_ID: '${X_CLIENT_ID}', CLIENT_SECRET: '${X_CLIENT_SECRET}' },
  reauth: { command: 'npx', args: ['-y', '@xdevplatform/xurl', 'auth', 'clear', '--all'] },
};

describe('extractRequiredEnv', () => {
  it('finds ${VAR} placeholders inside stdio env values', () => {
    expect(extractRequiredEnv(stdioEntry)).toEqual(['NOTION_TOKEN']);
  });
  it('finds placeholders inside url headers', () => {
    expect(extractRequiredEnv(urlEntry)).toEqual(['BUFFER_API_KEY']);
  });
  it('returns [] for an entry with no placeholders anywhere', () => {
    expect(extractRequiredEnv(noEnvEntry)).toEqual([]);
  });
  it('dedupes a placeholder referenced multiple times', () => {
    const entry: McpCatalogEntry = {
      id: 'x',
      kind: 'stdio',
      command: 'npx',
      args: ['--token=${TOKEN}'],
      env: { A: '${TOKEN}', B: '${TOKEN}' },
    };
    expect(extractRequiredEnv(entry)).toEqual(['TOKEN']);
  });
});

describe('substitutePlaceholders', () => {
  it('replaces a known placeholder', () => {
    expect(substitutePlaceholders('Bearer ${TOKEN}', { TOKEN: 'abc123' })).toBe('Bearer abc123');
  });
  it('leaves an unknown placeholder untouched', () => {
    expect(substitutePlaceholders('Bearer ${TOKEN}', {})).toBe('Bearer ${TOKEN}');
  });
});

describe('isFullyConfigured', () => {
  it('true when every required var has a value', () => {
    expect(isFullyConfigured(stdioEntry, { NOTION_TOKEN: 'abc' })).toBe(true);
  });
  it('false when a required var is missing', () => {
    expect(isFullyConfigured(stdioEntry, {})).toBe(false);
  });
  it('false when a required var is present but empty', () => {
    expect(isFullyConfigured(stdioEntry, { NOTION_TOKEN: '' })).toBe(false);
  });
  it('true for an entry with no required vars regardless of env', () => {
    expect(isFullyConfigured(noEnvEntry, {})).toBe(true);
  });
});

describe('marketplaceEntryId', () => {
  it('joins packId and entry id with a colon', () => {
    expect(marketplaceEntryId('atelier', 'notion')).toBe('atelier:notion');
  });
});

describe('parseMcpMarketplaceConfig / serializeMcpMarketplaceConfig', () => {
  it('round-trips enabled + env', () => {
    const config: McpMarketplaceConfig = {
      'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'secret' } },
    };
    expect(parseMcpMarketplaceConfig(serializeMcpMarketplaceConfig(config))).toEqual(config);
  });
  it('degrades to {} on empty/malformed input', () => {
    expect(parseMcpMarketplaceConfig('')).toEqual({});
    expect(parseMcpMarketplaceConfig('not json')).toEqual({});
    expect(parseMcpMarketplaceConfig('[1,2,3]')).toEqual({});
    expect(parseMcpMarketplaceConfig('"str"')).toEqual({});
  });
  it('ignores non-string env values and defaults enabled to false', () => {
    const parsed = parseMcpMarketplaceConfig(
      JSON.stringify({ 'atelier:notion': { enabled: 'yes', env: { A: 'ok', B: 5 } } })
    );
    expect(parsed['atelier:notion']).toEqual({ enabled: false, env: { A: 'ok' } });
  });
});

describe('buildMcpServerStatusList', () => {
  it('marks first-party servers always enabled/configured/non-toggleable', () => {
    const list = buildMcpServerStatusList({
      firstParty: [{ id: 'computer', name: 'computer', kind: 'stdio' }],
      marketplace: [],
      config: {},
    });
    expect(list).toEqual([
      {
        id: 'first-party:computer',
        source: 'first-party',
        kind: 'stdio',
        name: 'computer',
        description: undefined,
        requiredEnv: [],
        configured: true,
        enabled: true,
        toggleable: false,
        scopeEnabled: true,
        scopeEnablementScope: 'default',
        runtimeStatus: 'not_started',
        runtimeError: undefined,
        reauthenticable: false,
      },
    ]);
  });

  it('marks a marketplace entry disabled/unconfigured with no stored config', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: {},
    });
    expect(list[0]).toMatchObject({
      id: 'atelier:notion',
      source: 'atelier',
      requiredEnv: ['NOTION_TOKEN'],
      configured: false,
      enabled: false,
      toggleable: true,
    });
  });

  it('reflects enabled + configured once the required env is stored', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc' } } },
    });
    expect(list[0]).toMatchObject({ enabled: true, configured: true });
  });

  it('enabled but missing required env reports configured: false (the UI "missing credentials" case)', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: true, env: {} } },
    });
    expect(list[0]).toMatchObject({ enabled: true, configured: false });
  });

  it('surfaces riskNote on risk-flagged entries only', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [
        { packId: 'salon', entry: riskEntry },
        { packId: 'atelier', entry: stdioEntry },
      ],
      config: {},
    });
    const risky = list.find((s) => s.id === 'salon:linkedin-unofficial');
    const safe = list.find((s) => s.id === 'atelier:notion');
    expect(risky?.riskNote).toBe(riskEntry.riskNote);
    expect(safe?.riskNote).toBeUndefined();
  });

  it('defaults scopeEnabled/scopeEnablementScope to enabled/"default" when resolveScope is omitted', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: {},
    });
    expect(list[0]).toMatchObject({ scopeEnabled: true, scopeEnablementScope: 'default' });
  });

  it('applies resolveScope per marketplace entry when given (Phase 4 scope gate preview)', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [
        { packId: 'atelier', entry: stdioEntry },
        { packId: 'salon', entry: riskEntry },
      ],
      config: {},
      resolveScope: (packId, entryId) =>
        packId === 'atelier' && entryId === 'notion'
          ? { enabled: false, scope: 'client:acme' }
          : { enabled: true, scope: 'default' },
    });
    expect(list.find((s) => s.id === 'atelier:notion')).toMatchObject({
      scopeEnabled: false,
      scopeEnablementScope: 'client:acme',
    });
    expect(list.find((s) => s.id === 'salon:linkedin-unofficial')).toMatchObject({
      scopeEnabled: true,
      scopeEnablementScope: 'default',
    });
  });
});

describe('resolveMcpServer', () => {
  it('resolves a stdio entry, substituting env template values', () => {
    const resolved = resolveMcpServer(stdioEntry, { NOTION_TOKEN: 'abc123' });
    expect(resolved).toEqual({
      kind: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer abc123"}' },
    });
  });

  it('resolves a url entry, substituting header template values', () => {
    const resolved = resolveMcpServer(urlEntry, { BUFFER_API_KEY: 'xyz' });
    expect(resolved).toEqual({
      kind: 'url',
      url: 'https://mcp.buffer.com/mcp',
      headers: { Authorization: 'Bearer xyz' },
    });
  });

  it('returns null for a stdio entry missing a command', () => {
    expect(resolveMcpServer({ id: 'x', kind: 'stdio' }, {})).toBeNull();
  });

  it('returns null for a url entry missing a url', () => {
    expect(resolveMcpServer({ id: 'x', kind: 'url' }, {})).toBeNull();
  });
});

describe('resolveReauthCommand', () => {
  it('returns null for an entry with no reauth command declared', () => {
    expect(resolveReauthCommand(stdioEntry, { NOTION_TOKEN: 'abc' })).toBeNull();
  });

  it('resolves the reauth command for an entry that declares one', () => {
    const resolved = resolveReauthCommand(oauthEntry, {
      X_CLIENT_ID: 'id123',
      X_CLIENT_SECRET: 'secret456',
    });
    expect(resolved).toEqual({
      command: 'npx',
      args: ['-y', '@xdevplatform/xurl', 'auth', 'clear', '--all'],
    });
  });

  it('substitutes ${VAR} placeholders inside reauth args, if any are present', () => {
    const entry: McpCatalogEntry = {
      id: 'y',
      kind: 'stdio',
      command: 'npx',
      reauth: { command: 'some-cli', args: ['--user=${USERNAME}', 'logout'] },
    };
    const resolved = resolveReauthCommand(entry, { USERNAME: 'alice' });
    expect(resolved).toEqual({ command: 'some-cli', args: ['--user=alice', 'logout'] });
  });
});

describe('buildMcpServerStatusList — reauthenticable flag', () => {
  it('is false for an entry with no reauth command', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: {},
    });
    expect(list[0].reauthenticable).toBe(false);
  });

  it('is true for an entry that declares a reauth command, regardless of enabled/configured state', () => {
    const list = buildMcpServerStatusList({
      firstParty: [],
      marketplace: [{ packId: 'salon', entry: oauthEntry }],
      config: {},
    });
    expect(list[0].reauthenticable).toBe(true);
  });
});

describe('buildEnabledResolvedServers — the runtime gate', () => {
  it('excludes a disabled server even if fully configured', () => {
    const out = buildEnabledResolvedServers({
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: false, env: { NOTION_TOKEN: 'abc' } } },
    });
    expect(out).toEqual({});
  });

  it('excludes an enabled server missing required env (never reaches the agent)', () => {
    const out = buildEnabledResolvedServers({
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: true, env: {} } },
    });
    expect(out).toEqual({});
  });

  it('includes an enabled + fully configured server, resolved', () => {
    const out = buildEnabledResolvedServers({
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc' } } },
    });
    expect(out).toEqual({
      'atelier:notion': {
        kind: 'stdio',
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer abc"}' },
      },
    });
  });

  it('a zero-env entry only needs enabled: true', () => {
    const out = buildEnabledResolvedServers({
      marketplace: [{ packId: 'salon', entry: noEnvEntry }],
      config: { 'salon:hacker-news': { enabled: true, env: {} } },
    });
    expect(out['salon:hacker-news']).toEqual({
      kind: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-hacker-news'],
      env: {},
    });
  });

  it('mixes multiple entries, only surfacing the ones that pass the gate', () => {
    const out = buildEnabledResolvedServers({
      marketplace: [
        { packId: 'atelier', entry: stdioEntry }, // enabled+configured
        { packId: 'atelier', entry: urlEntry }, // disabled
        { packId: 'salon', entry: riskEntry }, // enabled, no required env declared on this fixture
      ],
      config: {
        'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc' } },
        'atelier:buffer': { enabled: false, env: { BUFFER_API_KEY: 'xyz' } },
        'salon:linkedin-unofficial': { enabled: true, env: {} },
      },
    });
    expect(Object.keys(out).sort()).toEqual(['atelier:notion', 'salon:linkedin-unofficial']);
  });

  it('excludes an enabled + fully configured server when scopeEnabled(packId, entryId) returns false (Phase 4 gate)', () => {
    const out = buildEnabledResolvedServers({
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc' } } },
      scopeEnabled: () => false,
    });
    expect(out).toEqual({});
  });

  it('includes the server when scopeEnabled returns true, and omitting it entirely behaves the same', () => {
    const params = {
      marketplace: [{ packId: 'atelier', entry: stdioEntry }],
      config: { 'atelier:notion': { enabled: true, env: { NOTION_TOKEN: 'abc' } } },
    };
    const withTrue = buildEnabledResolvedServers({ ...params, scopeEnabled: () => true });
    const omitted = buildEnabledResolvedServers(params);
    expect(withTrue).toEqual(omitted);
    expect(Object.keys(withTrue)).toEqual(['atelier:notion']);
  });
});
