import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';

// Capture ipcMain.handle registrations, same pattern as clients-import-ipc.test.ts.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
}));

import { registerClientsMemoryStatusIPC } from '../../src/main/ipc/clients-memory-status-ipc';
import { getClientDocsMemoryStatus } from '../../src/memory/facts';
import { MemoryManager } from '../../src/memory/index';
import { clientScope } from '../../src/memory/scope';
import type { IPCDependencies } from '../../src/main/ipc/types';

function depsWithMemory(memory: MemoryManager | null): IPCDependencies {
  return {
    getMemory: () => memory,
    getScheduler: () => null,
    getTelegramBot: () => null,
    setTelegramBot: () => {},
    updateTrayMenu: () => {},
    initializeAgent: async () => {},
    restartAgent: async () => {},
    isLiveSyncPushPending: () => false,
    openChatWindow: () => {},
    openSettingsWindow: () => {},
    openCronWindow: () => {},
    openCustomizeWindow: () => {},
    openFactsWindow: () => {},
    openDailyLogsWindow: () => {},
    openSoulWindow: () => {},
    WIN: {
      CHAT: 'chat',
      CRON: 'cron',
      SETTINGS: 'settings',
      CUSTOMIZE: 'customize',
      FACTS: 'facts',
      DAILY_LOGS: 'dailyLogs',
      SOUL: 'soul',
    },
  };
}

/** Reach the private `db` MemoryManager wraps, for deterministic seeding of
 *  embedding BLOBs without depending on the real (async, model-backed)
 *  embedding pipeline completing within the test. */
function rawDb(memory: MemoryManager): Database.Database {
  return (memory as unknown as { db: Database.Database }).db;
}

describe('clients-memory-status-ipc', () => {
  let memory: MemoryManager;
  const clientId = 'acme';
  const scope = clientScope(clientId);
  const event = { sender: {} } as never;

  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    memory = new MemoryManager(':memory:');
  });

  afterEach(() => {
    memory.close();
  });

  it('registers clients:memoryStatus', () => {
    registerClientsMemoryStatusIPC(depsWithMemory(memory));
    expect(handlers.has('clients:memoryStatus')).toBe(true);
  });

  it('returns null when memory is not initialized', async () => {
    registerClientsMemoryStatusIPC(depsWithMemory(null));
    const handler = handlers.get('clients:memoryStatus')!;
    const res = await handler(event, clientId);
    expect(res).toBeNull();
  });

  it('returns null when clientId is missing/empty', async () => {
    registerClientsMemoryStatusIPC(depsWithMemory(memory));
    const handler = handlers.get('clients:memoryStatus')!;
    const res = await handler(event, '');
    expect(res).toBeNull();
  });

  it('returns zeroed-out counts for a client with no imported docs yet', async () => {
    registerClientsMemoryStatusIPC(depsWithMemory(memory));
    const handler = handlers.get('clients:memoryStatus')!;
    const res = (await handler(event, clientId)) as {
      factCount: number;
      embeddedCount: number;
      pendingCount: number;
      lastSyncedAt: string | null;
    };
    expect(res).toEqual({
      factCount: 0,
      embeddedCount: 0,
      pendingCount: 0,
      lastSyncedAt: null,
    });
  });

  it('reports fact count scoped to THIS client and to docs/% subjects only', async () => {
    // 3 docs/% facts in this client's scope — the ones that should count.
    memory.saveFact('atelier-memory', 'docs/brand/voice.md', 'Voice content', false, scope);
    memory.saveFact('atelier-memory', 'docs/brand/tone.md', 'Tone content', false, scope);
    memory.saveFact('atelier-memory', 'docs/brand/pending.md', 'Pending content', false, scope);

    // A fact in a DIFFERENT client's scope must never bleed into this count.
    memory.saveFact(
      'atelier-memory',
      'docs/brand/other-client.md',
      'Other client content',
      false,
      clientScope('other-client')
    );
    // A fact in the SAME scope but NOT under docs/% (e.g. the .atelier/memory
    // brand-voice mirror, a separate concern from imported docs) must not be
    // counted either.
    memory.saveFact('atelier-memory', 'voice.md', 'Not under docs/', false, scope);

    registerClientsMemoryStatusIPC(depsWithMemory(memory));
    const handler = handlers.get('clients:memoryStatus')!;
    const res = (await handler(event, clientId)) as {
      factCount: number;
      embeddedCount: number;
      pendingCount: number;
      lastSyncedAt: string | null;
    };

    expect(res.factCount).toBe(3); // only this scope's docs/% facts
    expect(res.pendingCount + res.embeddedCount).toBe(res.factCount);
    expect(res.lastSyncedAt).not.toBeNull();
  });

  it('embeddedCount/pendingCount reflect COUNT(embedding) semantics (non-null vs null)', async () => {
    const db = rawDb(memory);
    db.prepare(
      'INSERT INTO facts (category, subject, content, scope, embedding) VALUES (?, ?, ?, ?, ?)'
    ).run('atelier-memory', 'docs/embedded-a.md', 'x', scope, Buffer.alloc(4));
    db.prepare(
      'INSERT INTO facts (category, subject, content, scope, embedding) VALUES (?, ?, ?, ?, ?)'
    ).run('atelier-memory', 'docs/embedded-b.md', 'y', scope, Buffer.alloc(4));
    db.prepare(
      'INSERT INTO facts (category, subject, content, scope, embedding) VALUES (?, ?, ?, ?, ?)'
    ).run('atelier-memory', 'docs/pending.md', 'z', scope, null);

    registerClientsMemoryStatusIPC(depsWithMemory(memory));
    const handler = handlers.get('clients:memoryStatus')!;
    const res = (await handler(event, clientId)) as {
      factCount: number;
      embeddedCount: number;
      pendingCount: number;
    };

    expect(res.factCount).toBe(3);
    expect(res.embeddedCount).toBe(2);
    expect(res.pendingCount).toBe(1);

    // Same assertion via the underlying facts.ts function directly (the
    // function the IPC handler and MemoryManager both delegate to).
    const direct = getClientDocsMemoryStatus(db, scope);
    expect(direct).toEqual(res);
  });
});
