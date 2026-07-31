// src/main/ipc/clients-memory-status-ipc.ts
// Ingestion observability: surfaces a client's imported-docs BRAIN state
// (fact count / embedded vs pending / last-synced), not just the one-shot
// file-pipeline counts clients:importDocs already returns (copiedFiles,
// skippedReservedPaths, prunedFiles, ingestedFiles — see clients-import-ipc.ts
// and ImportDocsResult). Thin by design: all the real querying lives in
// MemoryManager.getClientDocsMemoryStatus -> facts.ts's
// getClientDocsMemoryStatus (a single SQL query — no schema change).
import { ipcMain } from 'electron';
import { clientScope } from '../../memory/scope';
import type { ClientDocsMemoryStatus } from '../../memory/facts';
import type { IPCDependencies } from './types';

export function registerClientsMemoryStatusIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  ipcMain.handle(
    'clients:memoryStatus',
    async (_event, clientId: string): Promise<ClientDocsMemoryStatus | null> => {
      if (!clientId) return null;
      const memory = getMemory();
      if (!memory) return null;
      return memory.getClientDocsMemoryStatus(clientScope(clientId));
    }
  );
}
