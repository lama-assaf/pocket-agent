// src/main/ipc/clients-import-ipc.ts
// Wires the reusable "onboard external docs into a client brain" pipeline
// (src/clients/docs-import.ts + src/clients/vault-setup.ts) to the renderer.
// Thin by design: this module owns only the OS directory picker and the
// SecretScanError → structured-error translation — all real logic (the
// secret scan, the copy, the reserved-path skip, the memory mirror, the
// vault scaffold) stays in those two modules and their existing tests.
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { ensureObsidianVault, type EnsureVaultResult } from '../../clients/vault-setup';
import {
  importDocsIntoClient,
  SecretScanError,
  type ImportDocsResult,
  type SecretScanHit,
} from '../../clients/docs-import';
import type { IPCDependencies } from './types';

export interface ClientsImportDocsSuccess {
  success: true;
  vault: EnsureVaultResult;
  result: ImportDocsResult;
}

export interface ClientsImportDocsFailure {
  success: false;
  /** Human-readable message — always present on failure. */
  error: string;
  /** Populated only when the failure was a secret-scan refusal. */
  secretScan?: { offending: SecretScanHit[] };
  /** True when the user closed the directory picker without choosing one. */
  canceled?: boolean;
}

export type ClientsImportDocsResponse = ClientsImportDocsSuccess | ClientsImportDocsFailure;

export function registerClientsImportIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // Directory picker lives on its own channel so the renderer can let the
  // user browse *before* committing to an import (e.g. to show the chosen
  // path in the UI ahead of the actual copy/scan).
  ipcMain.handle('clients:selectImportDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await (win
      ? dialog.showOpenDialog(win, {
          title: 'Choose a folder of docs to import',
          properties: ['openDirectory'],
        })
      : dialog.showOpenDialog({
          title: 'Choose a folder of docs to import',
          properties: ['openDirectory'],
        }));
    if (res.canceled || res.filePaths.length === 0) return { canceled: true, path: null };
    return { canceled: false, path: res.filePaths[0] };
  });

  ipcMain.handle(
    'clients:importDocs',
    async (
      _event,
      input: {
        clientId: string;
        sourceDir: string;
        subtree?: string;
        ingestToMemory?: boolean;
      }
    ): Promise<ClientsImportDocsResponse> => {
      const { clientId, sourceDir, subtree, ingestToMemory } = input;
      if (!clientId || !sourceDir) {
        return { success: false, error: 'clientId and sourceDir are required' };
      }

      const memory = getMemory();
      if (ingestToMemory && !memory) {
        return { success: false, error: 'Memory not initialized' };
      }

      try {
        // Idempotent — safe to call on every import, not just the first.
        const vault = ensureObsidianVault(clientId);
        const result = await importDocsIntoClient({
          clientId,
          sourceDir,
          subtree,
          ingestToMemory,
          memory: ingestToMemory ? memory! : undefined,
        });
        return { success: true, vault, result };
      } catch (err) {
        if (err instanceof SecretScanError) {
          return {
            success: false,
            error: err.message,
            secretScan: { offending: err.offending },
          };
        }
        return { success: false, error: (err as Error).message };
      }
    }
  );
}
