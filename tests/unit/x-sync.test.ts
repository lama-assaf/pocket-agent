/**
 * X/Twitter analytics sync orchestration — mirrors
 * tests/unit/linkedin-sync.test.ts's structure (per-scope config storage,
 * fetch-then-record pipeline, graceful degradation), swapping the stubbed
 * layer: LinkedIn stubs its REST client module; X stubs getMcpBridgedTools
 * (src/agent/mcp-bridge.ts) since that's what src/integrations/x/sync.ts
 * calls instead of a dedicated client — no real HTTP or MCP process either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mcpBridgedToolsMock = vi.fn(async () => [] as Array<{
  name: string;
  execute: (args: unknown, ctx: unknown) => Promise<string>;
}>);
vi.mock('../../src/agent/mcp-bridge', () => ({
  getMcpBridgedTools: (...args: unknown[]) => mcpBridgedToolsMock(...args),
}));

import {
  getXHandleForScope,
  setXHandleForScope,
  allConfiguredXScopes,
  syncXAnalyticsForScope,
  autoSyncAllConfiguredXScopes,
  sessionContextForScope,
  channelTokenMatches,
  findXAnalyticsMcpTool,
  X_INTEGRATION_CATEGORY,
  X_HANDLE_SUBJECT,
  X_CHANNEL,
} from '../../src/integrations/x/sync';
import type { SessionContext } from '../../src/memory/sessions';

interface FakeFact {
  category: string;
  subject: string;
  content: string;
  scope: string;
}

interface FakeProject {
  id: string;
  client_id: string;
}

class FakeMemory {
  facts: FakeFact[] = [];
  recorded: Array<Record<string, unknown>> = [];
  projects: FakeProject[] = [];

  getAllFacts(): FakeFact[] {
    return this.facts;
  }

  saveFact(category: string, subject: string, content: string, _sensitive?: boolean, scope = 'user'): number {
    const existing = this.facts.find((f) => f.scope === scope && f.category === category && f.subject === subject);
    if (existing) {
      existing.content = content;
    } else {
      this.facts.push({ category, subject, content, scope });
    }
    return this.facts.length;
  }

  recordPostAnalytics(input: Record<string, unknown>): number {
    this.recorded.push(input);
    return this.recorded.length;
  }

  getProject(id: string): FakeProject | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }
}

const personalCtx: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };
const clientCtx = (id: string): SessionContext => ({ contextType: 'client', clientId: id, projectKey: null });

describe('X handle per-scope storage', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
  });

  it('returns null when no handle is configured for a scope', () => {
    expect(getXHandleForScope(memory as never, 'client:zilliqa')).toBeNull();
  });

  it('stores and retrieves a handle scoped to one client, isolated from another', () => {
    setXHandleForScope(memory as never, 'client:zilliqa', 'zilliqa_hq');
    setXHandleForScope(memory as never, 'client:ltin', 'ltin_hq');

    expect(getXHandleForScope(memory as never, 'client:zilliqa')).toBe('zilliqa_hq');
    expect(getXHandleForScope(memory as never, 'client:ltin')).toBe('ltin_hq');
  });

  it('strips a leading @ when storing', () => {
    setXHandleForScope(memory as never, 'client:zilliqa', '@zilliqa_hq');
    expect(getXHandleForScope(memory as never, 'client:zilliqa')).toBe('zilliqa_hq');
  });

  it('treats an empty string as unset (clears the handle)', () => {
    setXHandleForScope(memory as never, 'client:zilliqa', 'zilliqa_hq');
    setXHandleForScope(memory as never, 'client:zilliqa', '');
    expect(getXHandleForScope(memory as never, 'client:zilliqa')).toBeNull();
  });

  it('writes to the shared integration category/subject so export/sync tooling can find it uniformly', () => {
    setXHandleForScope(memory as never, 'client:zilliqa', 'zilliqa_hq');
    expect(memory.facts).toEqual([
      { category: X_INTEGRATION_CATEGORY, subject: X_HANDLE_SUBJECT, content: 'zilliqa_hq', scope: 'client:zilliqa' },
    ]);
  });

  it('allConfiguredXScopes lists every scope with a non-empty handle', () => {
    setXHandleForScope(memory as never, 'client:zilliqa', 'zilliqa_hq');
    setXHandleForScope(memory as never, 'client:ltin', '');
    expect(allConfiguredXScopes(memory as never)).toEqual([
      { scope: 'client:zilliqa', handle: 'zilliqa_hq' },
    ]);
  });
});

describe('sessionContextForScope', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
  });

  it('maps "user" to personal', () => {
    expect(sessionContextForScope(memory as never, 'user')).toEqual({
      contextType: 'personal',
      clientId: null,
      projectKey: null,
    });
  });

  it('maps "world" to world', () => {
    expect(sessionContextForScope(memory as never, 'world')).toEqual({
      contextType: 'world',
      clientId: null,
      projectKey: null,
    });
  });

  it('maps "client:<id>" to a client context', () => {
    expect(sessionContextForScope(memory as never, 'client:zilliqa')).toEqual({
      contextType: 'client',
      clientId: 'zilliqa',
      projectKey: null,
    });
  });

  it('maps "project:<key>" to a project context and resolves the owning client via memory.getProject', () => {
    memory.projects.push({ id: 'proj-1', client_id: 'zilliqa' });
    expect(sessionContextForScope(memory as never, 'project:proj-1')).toEqual({
      contextType: 'project',
      clientId: 'zilliqa',
      projectKey: 'proj-1',
    });
  });

  it('degrades an unknown project (deleted, or a stale fact) to a null clientId rather than throwing', () => {
    expect(sessionContextForScope(memory as never, 'project:missing')).toEqual({
      contextType: 'project',
      clientId: null,
      projectKey: 'missing',
    });
  });
});

describe('channelTokenMatches', () => {
  it('matches a long channel word via plain substring', () => {
    expect(channelTokenMatches('mcp_twitter_community_search', 'twitter')).toBe(true);
    expect(channelTokenMatches('mcp_buffer_createPost', 'twitter')).toBe(false);
  });

  it('matches a short channel ("x") only at a token boundary', () => {
    expect(channelTokenMatches('mcp_x_api_search_posts', 'x')).toBe(true);
    expect(channelTokenMatches('mcp_x_api_bearer_get_tweets', 'x')).toBe(true);
  });

  it('does NOT false-positive on words that merely contain the letter "x"', () => {
    expect(channelTokenMatches('mcp_context_lookup', 'x')).toBe(false);
    expect(channelTokenMatches('mcp_buffer_getTextMetrics', 'x')).toBe(false);
  });
});

describe('findXAnalyticsMcpTool', () => {
  beforeEach(() => {
    mcpBridgedToolsMock.mockReset();
  });

  it('finds an analytics-shaped tool for a twitter-named server', async () => {
    mcpBridgedToolsMock.mockResolvedValue([
      { name: 'mcp_twitter_community_create_post', execute: vi.fn() },
      { name: 'mcp_twitter_community_get_analytics', execute: vi.fn() },
    ]);
    const tool = await findXAnalyticsMcpTool(personalCtx, 'S');
    expect(tool?.name).toBe('mcp_twitter_community_get_analytics');
  });

  it('finds a read-shaped tool for an x-api-named server (token-boundary match on "x")', async () => {
    mcpBridgedToolsMock.mockResolvedValue([
      { name: 'mcp_x_api_create_post', execute: vi.fn() },
      { name: 'mcp_x_api_search_posts', execute: vi.fn() },
    ]);
    const tool = await findXAnalyticsMcpTool(personalCtx, 'S');
    expect(tool?.name).toBe('mcp_x_api_search_posts');
  });

  it('returns null when no bridged tool matches', async () => {
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_buffer_createPost', execute: vi.fn() }]);
    const tool = await findXAnalyticsMcpTool(personalCtx, 'S');
    expect(tool).toBeNull();
  });

  it('returns null when nothing is bridged at all', async () => {
    mcpBridgedToolsMock.mockResolvedValue([]);
    const tool = await findXAnalyticsMcpTool(personalCtx, 'S');
    expect(tool).toBeNull();
  });
});

describe('syncXAnalyticsForScope', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
    mcpBridgedToolsMock.mockReset();
  });

  it('fetches via the bridged tool and records one analytics row per parsed post', async () => {
    const execute = vi.fn(async () =>
      JSON.stringify({
        data: [
          {
            id: '111',
            text: 'First post',
            public_metrics: { impression_count: 100, like_count: 10, reply_count: 1, retweet_count: 0 },
          },
          {
            id: '222',
            text: 'Second post',
            public_metrics: { impression_count: 200, like_count: 20, reply_count: 2, retweet_count: 1 },
          },
        ],
      })
    );
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_x_api_search_posts', execute }]);

    const result = await syncXAnalyticsForScope(memory as never, 'client:zilliqa', 'zilliqa_hq', clientCtx('zilliqa'), 'S');

    expect(result).toEqual({ ok: true, postsWritten: 2 });
    expect(memory.recorded).toHaveLength(2);
    expect(memory.recorded[0]).toMatchObject({
      scope: 'client:zilliqa',
      channel: X_CHANNEL,
      externalRef: '111',
      title: 'First post',
      impressions: 100,
      likes: 10,
      comments: 1,
      shares: 0,
      source: 'mcp',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns an actionable error, never throws, when no bridged analytics tool is found', async () => {
    mcpBridgedToolsMock.mockResolvedValue([]);
    const result = await syncXAnalyticsForScope(memory as never, 'client:zilliqa', 'zilliqa_hq', clientCtx('zilliqa'), 'S');
    expect(result.ok).toBe(false);
    expect(result.postsWritten).toBe(0);
    expect(result.error).toMatch(/no bridged mcp analytics tool/i);
    expect(memory.recorded).toHaveLength(0);
  });

  it('treats an "Error:"-prefixed tool response as a failure, never throws', async () => {
    const execute = vi.fn(async () => 'Error: rate limited by X API');
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_x_api_search_posts', execute }]);

    const result = await syncXAnalyticsForScope(memory as never, 'client:zilliqa', 'zilliqa_hq', clientCtx('zilliqa'), 'S');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limited/i);
    expect(memory.recorded).toHaveLength(0);
  });

  it('returns ok:true with 0 written when the response has no recognizable posts (never fabricates rows)', async () => {
    const execute = vi.fn(async () => JSON.stringify({ data: [] }));
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_x_api_search_posts', execute }]);

    const result = await syncXAnalyticsForScope(memory as never, 'client:zilliqa', 'zilliqa_hq', clientCtx('zilliqa'), 'S');
    expect(result).toEqual({ ok: true, postsWritten: 0 });
  });

  it('degrades gracefully when the bridged tool throws (network failure etc.), never throws', async () => {
    const execute = vi.fn(async () => {
      throw new Error('fetch failed: ECONNRESET');
    });
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_x_api_search_posts', execute }]);

    const result = await syncXAnalyticsForScope(memory as never, 'client:zilliqa', 'zilliqa_hq', clientCtx('zilliqa'), 'S');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/econnreset/i);
    expect(memory.recorded).toHaveLength(0);
  });
});

describe('autoSyncAllConfiguredXScopes', () => {
  let memory: FakeMemory;

  beforeEach(() => {
    memory = new FakeMemory();
    mcpBridgedToolsMock.mockReset();
  });

  it('is a silent no-op when no scope has a handle configured', async () => {
    const results = await autoSyncAllConfiguredXScopes(memory as never);
    expect(results).toEqual([]);
    expect(mcpBridgedToolsMock).not.toHaveBeenCalled();
  });

  it('syncs every configured scope independently — one scope failing never blocks another', async () => {
    setXHandleForScope(memory as never, 'client:zilliqa', 'zilliqa_hq');
    setXHandleForScope(memory as never, 'client:ltin', 'ltin_hq');

    mcpBridgedToolsMock.mockImplementation(async (context: SessionContext) => {
      if (context.clientId === 'zilliqa') return []; // no bridged tool -> failure
      return [
        {
          name: 'mcp_x_api_search_posts',
          execute: vi.fn(async () =>
            JSON.stringify({ data: [{ id: '9', text: 'ok', public_metrics: { like_count: 5 } }] })
          ),
        },
      ];
    });

    const results = await autoSyncAllConfiguredXScopes(memory as never);
    expect(results).toHaveLength(2);
    const zilliqaResult = results.find((r) => r.scope === 'client:zilliqa')!;
    const ltinResult = results.find((r) => r.scope === 'client:ltin')!;
    expect(zilliqaResult.result.ok).toBe(false);
    expect(ltinResult.result.ok).toBe(true);
    expect(ltinResult.result.postsWritten).toBe(1);
  });
});
