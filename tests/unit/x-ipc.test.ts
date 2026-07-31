/**
 * X/Twitter IPC surface: registration, memory-null degradation, and scope
 * resolution/delegation into src/integrations/x/sync.ts. Mirrors
 * tests/unit/linkedin-ipc.test.ts's structure; no OAuth section here since
 * x-ipc.ts has none (see its module doc — analytics come from whichever
 * bridged MCP server is configured, not an app-owned OAuth connection).
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

const { syncModuleMock } = vi.hoisted(() => ({
  syncModuleMock: {
    getXHandleForScope: vi.fn(),
    setXHandleForScope: vi.fn(),
    syncXAnalyticsForScope: vi.fn(),
  },
}));

vi.mock('../../src/integrations/x/sync', () => syncModuleMock);

import { registerXIPC } from '../../src/main/ipc/x-ipc';
import { clientScope } from '../../src/memory/scope';
import type { SessionContext } from '../../src/memory/sessions';

const personalCtx: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };
const clientCtx = (id: string): SessionContext => ({ contextType: 'client', clientId: id, projectKey: null });

function makeMemoryStub() {
  return {};
}

describe('x-ipc: registration', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerXIPC({ getMemory: () => null } as never);
  });

  it('registers every X channel', () => {
    expect(handlers.has('x:getHandle')).toBe(true);
    expect(handlers.has('x:setHandle')).toBe(true);
    expect(handlers.has('x:syncNow')).toBe(true);
  });
});

describe('x-ipc: memory-null degradation', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerXIPC({ getMemory: () => null } as never);
  });

  it('x:getHandle returns null when memory is not initialized', async () => {
    const result = await handlers.get('x:getHandle')!({}, personalCtx);
    expect(result).toBeNull();
  });

  it('x:setHandle fails gracefully when memory is not initialized', async () => {
    const result = await handlers.get('x:setHandle')!({}, 'zilliqa_hq', personalCtx);
    expect(result).toEqual({ success: false, error: 'Memory not initialized' });
  });

  it('x:syncNow fails gracefully when memory is not initialized', async () => {
    const result = await handlers.get('x:syncNow')!({}, personalCtx);
    expect(result).toEqual({ ok: false, postsWritten: 0, error: 'Memory not initialized' });
  });
});

describe('x-ipc: scope resolution + delegation with a live memory stub', () => {
  let memoryStub: ReturnType<typeof makeMemoryStub>;

  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    memoryStub = makeMemoryStub();
    Object.values(syncModuleMock).forEach((fn) => fn.mockReset());
    registerXIPC({ getMemory: () => memoryStub } as never);
  });

  it('x:getHandle resolves the NEAREST scope for a client context (not the visible-scope chain)', async () => {
    syncModuleMock.getXHandleForScope.mockReturnValue('zilliqa_hq');
    const result = await handlers.get('x:getHandle')!({}, clientCtx('zilliqa'));
    expect(syncModuleMock.getXHandleForScope).toHaveBeenCalledWith(memoryStub, clientScope('zilliqa'));
    expect(result).toBe('zilliqa_hq');
  });

  it('x:setHandle resolves scope and delegates to setXHandleForScope', async () => {
    await handlers.get('x:setHandle')!({}, '@ltin_hq', clientCtx('ltin'));
    expect(syncModuleMock.setXHandleForScope).toHaveBeenCalledWith(memoryStub, clientScope('ltin'), '@ltin_hq');
  });

  it('x:syncNow fails with an actionable error when no handle is configured for the scope', async () => {
    syncModuleMock.getXHandleForScope.mockReturnValue(null);
    const result = await handlers.get('x:syncNow')!({}, clientCtx('zilliqa'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no x\/twitter handle configured/i);
    expect(syncModuleMock.syncXAnalyticsForScope).not.toHaveBeenCalled();
  });

  it('x:syncNow delegates to syncXAnalyticsForScope with the resolved scope and the ORIGINAL renderer-provided context (not a reconstructed one)', async () => {
    syncModuleMock.getXHandleForScope.mockReturnValue('zilliqa_hq');
    syncModuleMock.syncXAnalyticsForScope.mockResolvedValue({ ok: true, postsWritten: 4 });

    const ctx = clientCtx('zilliqa');
    const result = await handlers.get('x:syncNow')!({}, ctx);
    expect(syncModuleMock.syncXAnalyticsForScope).toHaveBeenCalledWith(
      memoryStub,
      clientScope('zilliqa'),
      'zilliqa_hq',
      ctx
    );
    expect(result).toEqual({ ok: true, postsWritten: 4 });
  });
});
