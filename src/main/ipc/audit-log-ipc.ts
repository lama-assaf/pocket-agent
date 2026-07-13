// src/main/ipc/audit-log-ipc.ts
// Minimal read surface for the write-audit log (roadmap item 8 — see
// src/utils/audit-log.ts). No IPCDependencies needed: the audit log is a
// standalone fs-backed module with no electron dependency of its own, same
// pattern as marketplace-ipc.ts / mcp-ipc.ts.
import { ipcMain } from 'electron';
import { getRecentAuditLogEntries } from '../../utils/audit-log';

export function registerAuditLogIPC(): void {
  // `limit` caps how many entries to return, most recent first. No UI viewer
  // wired up yet (see roadmap item 8, task note 3) — this IPC exists so one
  // can be added cheaply later, and so the log is inspectable today via the
  // devtools console: `await window.pocketAgent.auditLog.list(50)`.
  ipcMain.handle('auditLog:list', async (_, limit?: number) => {
    return getRecentAuditLogEntries(typeof limit === 'number' && limit > 0 ? limit : 100);
  });
}
