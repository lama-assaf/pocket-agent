/**
 * Analytics IPC surface: scope resolution (visible-scope for list/summary,
 * nearest-scope for record), memory-null degradation, and required-field
 * validation. Same mocking pattern as facts-ipc.test.ts — capture
 * ipcMain.handle registrations without a real Electron runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
}));

import { registerAnalyticsIPC } from '../../src/main/ipc/analytics-ipc';
import { clientScope } from '../../src/memory/scope';
import type { SessionContext } from '../../src/memory/sessions';

const personalCtx: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };
const clientCtx = (id: string): SessionContext => ({ contextType: 'client', clientId: id, projectKey: null });

function makeMemoryStub() {
  return {
    getLatestPostAnalyticsForScopes: vi.fn(() => []),
    getPostAnalyticsHistory: vi.fn(() => []),
    summarizeAnalytics: vi.fn(() => ({
      totalPosts: 0,
      impressions: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
      videoViews: 0,
      engagementRate: 0,
      byChannel: {},
      topPosts: [],
    })),
    recordPostAnalytics: vi.fn(() => 1),
    deletePostAnalytics: vi.fn(() => true),
  };
}

describe('analytics-ipc: registration', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerAnalyticsIPC({ getMemory: () => null } as never);
  });

  it('registers every analytics channel', () => {
    expect(handlers.has('analytics:list')).toBe(true);
    expect(handlers.has('analytics:history')).toBe(true);
    expect(handlers.has('analytics:summary')).toBe(true);
    expect(handlers.has('analytics:record')).toBe(true);
    expect(handlers.has('analytics:delete')).toBe(true);
  });
});

describe('analytics-ipc: memory-null degradation (never throws before init)', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerAnalyticsIPC({ getMemory: () => null } as never);
  });

  it('analytics:list returns [] when memory is not initialized', async () => {
    const result = await handlers.get('analytics:list')!({}, personalCtx);
    expect(result).toEqual([]);
  });

  it('analytics:history returns [] when memory is not initialized', async () => {
    const result = await handlers.get('analytics:history')!({}, 'user', 'twitter', 'post-1');
    expect(result).toEqual([]);
  });

  it('analytics:summary returns a zeroed summary shape when memory is not initialized', async () => {
    const result = (await handlers.get('analytics:summary')!({}, personalCtx)) as { totalPosts: number };
    expect(result.totalPosts).toBe(0);
  });

  it('analytics:record fails gracefully when memory is not initialized', async () => {
    const result = await handlers.get('analytics:record')!(
      {},
      { channel: 'twitter', externalRef: 'post-1' },
      personalCtx
    );
    expect(result).toEqual({ success: false, error: 'Memory not initialized' });
  });

  it('analytics:delete returns success:false when memory is not initialized', async () => {
    const result = await handlers.get('analytics:delete')!({}, 1);
    expect(result).toEqual({ success: false });
  });
});

describe('analytics-ipc: scope resolution + validation with a live memory stub', () => {
  let memoryStub: ReturnType<typeof makeMemoryStub>;

  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    memoryStub = makeMemoryStub();
    registerAnalyticsIPC({ getMemory: () => memoryStub } as never);
  });

  it('analytics:list resolves the visible-scope chain for the given context and passes the channel through', async () => {
    await handlers.get('analytics:list')!({}, clientCtx('brandA'), 'twitter');
    expect(memoryStub.getLatestPostAnalyticsForScopes).toHaveBeenCalledWith(
      expect.arrayContaining([clientScope('brandA'), 'world']),
      'twitter'
    );
  });

  it('analytics:history delegates scope/channel/externalRef straight through (no visible-scope resolution — a direct post lookup)', async () => {
    await handlers.get('analytics:history')!({}, clientScope('brandA'), 'twitter', 'post-1');
    expect(memoryStub.getPostAnalyticsHistory).toHaveBeenCalledWith(clientScope('brandA'), 'twitter', 'post-1');
  });

  it('analytics:summary resolves visible scopes, fetches latest rows, then summarizes them', async () => {
    await handlers.get('analytics:summary')!({}, clientCtx('brandA'));
    expect(memoryStub.getLatestPostAnalyticsForScopes).toHaveBeenCalled();
    expect(memoryStub.summarizeAnalytics).toHaveBeenCalled();
  });

  it('analytics:record rejects a missing channel', async () => {
    const result = await handlers.get('analytics:record')!({}, { externalRef: 'post-1' }, personalCtx);
    expect(result).toMatchObject({ success: false });
    expect(memoryStub.recordPostAnalytics).not.toHaveBeenCalled();
  });

  it('analytics:record rejects a missing externalRef', async () => {
    const result = await handlers.get('analytics:record')!({}, { channel: 'twitter' }, personalCtx);
    expect(result).toMatchObject({ success: false });
    expect(memoryStub.recordPostAnalytics).not.toHaveBeenCalled();
  });

  it('analytics:record resolves to the nearest scope for a client context, not the visible-scope chain', async () => {
    await handlers.get('analytics:record')!(
      {},
      { channel: 'twitter', externalRef: 'post-1', impressions: 100 },
      clientCtx('brandA')
    );
    expect(memoryStub.recordPostAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'twitter', externalRef: 'post-1', scope: clientScope('brandA') })
    );
  });

  it('analytics:record scopes to "user" for a personal context', async () => {
    await handlers.get('analytics:record')!({}, { channel: 'twitter', externalRef: 'post-1' }, personalCtx);
    expect(memoryStub.recordPostAnalytics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'user' }));
  });

  it('analytics:delete delegates to memory.deletePostAnalytics', async () => {
    const result = await handlers.get('analytics:delete')!({}, 42);
    expect(memoryStub.deletePostAnalytics).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true });
  });
});
