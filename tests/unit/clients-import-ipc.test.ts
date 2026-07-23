import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Capture ipcMain.handle registrations, same pattern as facts-ipc.test.ts.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});
const mockShowOpenDialog = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
}));

import { registerClientsImportIPC } from '../../src/main/ipc/clients-import-ipc';
import { setClientsRoot, clientPaths } from '../../src/clients/paths';
import type { IPCDependencies } from '../../src/main/ipc/types';

function noopDeps(getMemory: IPCDependencies['getMemory'] = () => null): IPCDependencies {
  return {
    getMemory,
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

describe('clients-import-ipc', () => {
  let clientsRoot: string;
  let sourceDir: string;
  const clientId = 'acme';
  const event = { sender: {} } as never;

  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    mockShowOpenDialog.mockReset();
    clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clients-import-ipc-clients-'));
    setClientsRoot(clientsRoot);
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clients-import-ipc-source-'));
  });

  afterEach(() => {
    setClientsRoot('');
    fs.rmSync(clientsRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(sourceDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }

  it('registers clients:selectImportDir and clients:importDocs', () => {
    registerClientsImportIPC(noopDeps());
    expect(handlers.has('clients:selectImportDir')).toBe(true);
    expect(handlers.has('clients:importDocs')).toBe(true);
  });

  it('clients:selectImportDir returns canceled: true when the user dismisses the dialog', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    registerClientsImportIPC(noopDeps());
    const handler = handlers.get('clients:selectImportDir')!;
    const res = (await handler(event)) as { canceled: boolean; path: string | null };
    expect(res).toEqual({ canceled: true, path: null });
  });

  it('clients:selectImportDir returns the chosen path', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/some/dir'] });
    registerClientsImportIPC(noopDeps());
    const handler = handlers.get('clients:selectImportDir')!;
    const res = (await handler(event)) as { canceled: boolean; path: string | null };
    expect(res).toEqual({ canceled: false, path: '/some/dir' });
  });

  it('clients:importDocs ensures the vault and copies docs, reporting counts', async () => {
    write('brand/voice-guide.md', '# Voice\nUnderstated, evidence-first.');
    registerClientsImportIPC(noopDeps());
    const handler = handlers.get('clients:importDocs')!;
    const res = (await handler(event, { clientId, sourceDir })) as {
      success: boolean;
      vault: { gitignoreWritten: boolean };
      result: { copiedFiles: string[]; skippedReservedPaths: string[]; ingestedFiles: number };
    };

    expect(res.success).toBe(true);
    expect(res.vault.gitignoreWritten).toBe(true);
    expect(res.result.copiedFiles).toEqual(['brand/voice-guide.md']);
    expect(res.result.ingestedFiles).toBe(0);
    expect(fs.existsSync(path.join(clientPaths(clientId).rootDir, '.obsidian'))).toBe(true);
    expect(
      fs.existsSync(path.join(clientPaths(clientId).rootDir, 'docs', 'brand', 'voice-guide.md'))
    ).toBe(true);
  });

  it('wraps SecretScanError into a structured failure with every offending path — nothing is written', async () => {
    write('brand/voice-guide.md', '# Voice');
    write('leaked/creds.md', 'Deploy key: ghp_' + 'a'.repeat(36));
    registerClientsImportIPC(noopDeps());
    const handler = handlers.get('clients:importDocs')!;
    const res = (await handler(event, { clientId, sourceDir })) as {
      success: boolean;
      error: string;
      secretScan?: { offending: Array<{ path: string; rule: string }> };
    };

    expect(res.success).toBe(false);
    expect(res.secretScan?.offending).toEqual([
      { path: 'leaked/creds.md', rule: 'GitHub PAT (classic)' },
    ]);
    expect(res.error).toContain('leaked/creds.md');
    expect(fs.existsSync(path.join(clientPaths(clientId).rootDir, 'docs'))).toBe(false);
  });

  it('rejects ingestToMemory without a live memory instance', async () => {
    write('brand/voice-guide.md', '# Voice');
    registerClientsImportIPC(noopDeps(() => null));
    const handler = handlers.get('clients:importDocs')!;
    const res = (await handler(event, {
      clientId,
      sourceDir,
      ingestToMemory: true,
    })) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/memory/i);
  });

  it('rejects a missing clientId/sourceDir before touching disk', async () => {
    registerClientsImportIPC(noopDeps());
    const handler = handlers.get('clients:importDocs')!;
    const res = (await handler(event, { clientId: '', sourceDir: '' })) as {
      success: boolean;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/required/i);
  });
});
