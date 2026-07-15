/**
 * Campaign IPC surface — focused on the new campaigns:analytics handler
 * (campaign -> attached content -> analytics). Same mocking pattern as
 * analytics-ipc.test.ts/facts-ipc.test.ts: capture ipcMain.handle
 * registrations without a real Electron runtime.
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

import { registerCampaignIPC } from '../../src/main/ipc/campaign-ipc';

describe('campaign-ipc: registration', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerCampaignIPC({ getMemory: () => null } as never);
  });

  it('registers the campaigns:analytics channel', () => {
    expect(handlers.has('campaigns:analytics')).toBe(true);
  });
});

describe('campaign-ipc: campaigns:analytics', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
  });

  it('degrades to a zeroed summary + empty posts when memory is not initialized (never throws)', async () => {
    registerCampaignIPC({ getMemory: () => null } as never);
    const result = (await handlers.get('campaigns:analytics')!({}, 1)) as {
      summary: { totalPosts: number };
      posts: unknown[];
    };
    expect(result.summary.totalPosts).toBe(0);
    expect(result.posts).toEqual([]);
  });

  it('delegates to memory.getCampaignAnalytics with the given campaign id', async () => {
    const getCampaignAnalytics = vi.fn(() => ({
      summary: {
        totalPosts: 1,
        impressions: 100,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        videoViews: 0,
        engagementRate: 0,
        byChannel: {},
        topPosts: [],
      },
      posts: [],
    }));
    registerCampaignIPC({ getMemory: () => ({ getCampaignAnalytics }) } as never);

    const result = await handlers.get('campaigns:analytics')!({}, 42);
    expect(getCampaignAnalytics).toHaveBeenCalledWith(42);
    expect(result).toMatchObject({ summary: { totalPosts: 1, impressions: 100 } });
  });
});

describe('campaign-ipc: campaigns:linkContentDraft', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
  });

  it('registers the campaigns:linkContentDraft channel', () => {
    registerCampaignIPC({ getMemory: () => null } as never);
    expect(handlers.has('campaigns:linkContentDraft')).toBe(true);
  });

  it('reports "Memory not initialized" when memory is unavailable', async () => {
    registerCampaignIPC({ getMemory: () => null } as never);
    const result = (await handlers.get('campaigns:linkContentDraft')!({}, 1, 2)) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not initialized/i);
  });

  it('delegates to memory.linkDeliverableToContentDraft with the deliverable and draft ids', async () => {
    const linkDeliverableToContentDraft = vi.fn(() => ({ ok: true }));
    registerCampaignIPC({ getMemory: () => ({ linkDeliverableToContentDraft }) } as never);

    const result = await handlers.get('campaigns:linkContentDraft')!({}, 5, 9);
    expect(linkDeliverableToContentDraft).toHaveBeenCalledWith(5, 9);
    expect(result).toEqual({ success: true, error: undefined });
  });

  it('surfaces a not-found error from the memory layer', async () => {
    const linkDeliverableToContentDraft = vi.fn(() => ({
      ok: false,
      error: 'Deliverable #5 not found.',
    }));
    registerCampaignIPC({ getMemory: () => ({ linkDeliverableToContentDraft }) } as never);

    const result = (await handlers.get('campaigns:linkContentDraft')!({}, 5, 9)) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });
});
