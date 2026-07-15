/**
 * Content IPC surface — focused on the content:setStatus generic escape
 * hatch (added alongside submitForApproval/approve/reject to unblock the
 * 'scheduled'/'failed' dead ends in the queue panel). Same mocking pattern
 * as campaign-ipc.test.ts: capture ipcMain.handle registrations without a
 * real Electron runtime.
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

vi.mock('../../src/tools/content-tools', () => ({
  postApprovedDraft: vi.fn(),
  scheduleApprovedDraft: vi.fn(),
}));

import { registerContentIPC } from '../../src/main/ipc/content-ipc';

describe('content-ipc: registration', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerContentIPC({ getMemory: () => null } as never);
  });

  it('registers the content:setStatus channel', () => {
    expect(handlers.has('content:setStatus')).toBe(true);
  });
});

describe('content-ipc: content:setStatus', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
  });

  it('reports "Memory not initialized" when memory is unavailable', async () => {
    registerContentIPC({ getMemory: () => null } as never);
    const result = (await handlers.get('content:setStatus')!({}, 1, 'draft')) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not initialized/i);
  });

  it('delegates to memory.setContentDraftStatus with actor "human"', async () => {
    const setContentDraftStatus = vi.fn(() => ({ ok: true }));
    registerContentIPC({ getMemory: () => ({ setContentDraftStatus }) } as never);

    const result = await handlers.get('content:setStatus')!({}, 42, 'draft');
    expect(setContentDraftStatus).toHaveBeenCalledWith(42, 'draft', 'human');
    expect(result).toEqual({ success: true, error: undefined });
  });

  it('surfaces a transition error from the memory layer', async () => {
    const setContentDraftStatus = vi.fn(() => ({
      ok: false,
      error: 'Cannot transition content draft from "posted" to "draft".',
    }));
    registerContentIPC({ getMemory: () => ({ setContentDraftStatus }) } as never);

    const result = (await handlers.get('content:setStatus')!({}, 7, 'draft')) as {
      success: boolean;
      error?: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/posted/);
  });
});
