// src/main/ipc/routing-log-ipc.ts
// Minimal read surface for the routing-decision log (src/utils/routing-log.ts).
// Same pattern as audit-log-ipc.ts: no IPCDependencies needed, standalone
// fs-backed module with no electron dependency of its own.
import { ipcMain } from 'electron';
import { getRecentRoutingLogEntries } from '../../utils/routing-log';

export function registerRoutingLogIPC(): void {
  // `limit` caps how many entries to return, most recent first. Inspectable
  // today via the devtools console: `await window.pocketAgent.routingLog.list(50)`.
  ipcMain.handle('routingLog:list', async (_, limit?: number) => {
    return getRecentRoutingLogEntries(typeof limit === 'number' && limit > 0 ? limit : 100);
  });
}
