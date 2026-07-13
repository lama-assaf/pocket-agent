import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture ipcMain.handle registrations, same pattern as mcp-ipc.test.ts.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
}));

const getAllFactsMock = vi.fn();
vi.mock('../../src/agent', () => ({
  AgentManager: {
    getAllFacts: (...args: unknown[]) => getAllFactsMock(...args),
  },
}));

import { registerFactsIPC } from '../../src/main/ipc/facts-ipc';
import { clientScope } from '../../src/memory/scope';

describe('facts-ipc: facts:list scope enforcement (F4)', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    getAllFactsMock.mockReset();
    getAllFactsMock.mockReturnValue([
      { id: 1, category: 'info', subject: 'a', content: 'personal fact', scope: 'user' },
      { id: 2, category: 'info', subject: 'b', content: 'agency fact', scope: 'world' },
      {
        id: 3,
        category: 'info',
        subject: 'c',
        content: 'brand A fact',
        scope: clientScope('brandA'),
      },
      {
        id: 4,
        category: 'info',
        subject: 'd',
        content: 'brand B fact',
        scope: clientScope('brandB'),
      },
    ]);
    registerFactsIPC({ getMemory: () => null });
  });

  it('registers the facts:list channel', () => {
    expect(handlers.has('facts:list')).toBe(true);
  });

  it('an explicit scope returns only that scope\u2019s facts', async () => {
    const handler = handlers.get('facts:list')!;
    const result = (await handler({}, clientScope('brandA'))) as Array<{ scope: string }>;
    expect(result.map((f) => f.scope)).toEqual([clientScope('brandA')]);
  });

  it('a client scope never returns another client\u2019s facts', async () => {
    const handler = handlers.get('facts:list')!;
    const result = (await handler({}, clientScope('brandA'))) as Array<{ content: string }>;
    const contents = result.map((f) => f.content);
    expect(contents).toContain('brand A fact');
    expect(contents).not.toContain('brand B fact');
    expect(contents).not.toContain('personal fact');
  });

  it('omitting scope never falls through to an unfiltered dump of every space', async () => {
    const handler = handlers.get('facts:list')!;
    const result = (await handler({}, undefined)) as Array<{ scope: string }>;
    const scopes = result.map((f) => f.scope);
    // Safe default: personal (user+world) only — never any client/project scope.
    expect(scopes.every((s) => s === 'user' || s === 'world')).toBe(true);
    expect(scopes).not.toContain(clientScope('brandA'));
    expect(scopes).not.toContain(clientScope('brandB'));
  });

  it('omitting scope still returns the operator\u2019s personal + agency facts', async () => {
    const handler = handlers.get('facts:list')!;
    const result = (await handler({}, undefined)) as Array<{ content: string }>;
    const contents = result.map((f) => f.content);
    expect(contents).toContain('personal fact');
    expect(contents).toContain('agency fact');
  });
});
