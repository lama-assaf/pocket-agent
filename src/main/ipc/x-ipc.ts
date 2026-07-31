// src/main/ipc/x-ipc.ts
// X/Twitter analytics auto-sync surface — the counterpart to linkedin-ipc.ts.
// No OAuth handlers here: unlike LinkedIn's dedicated Community Management
// API app, X analytics are fetched through whichever X-capable marketplace
// MCP server the workspace already has bridged in (see
// src/integrations/x/sync.ts's module doc), so there's no app-level
// credential flow this app owns — "connected" is just "a matching MCP
// server is enabled and configured", which the sync call itself reports.
import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import { resolveNearestScope } from '../../memory/scope';
import type { SessionContext } from '../../memory/sessions';
import {
  getXHandleForScope,
  setXHandleForScope,
  syncXAnalyticsForScope,
  type XSyncResult,
} from '../../integrations/x/sync';

export function registerXIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // ── Per-scope handle (which X/Twitter account this client/world/project tracks) ──

  ipcMain.handle('x:getHandle', async (_, context: SessionContext): Promise<string | null> => {
    const memory = getMemory();
    if (!memory) return null;
    const scope = resolveNearestScope(context);
    return getXHandleForScope(memory, scope);
  });

  ipcMain.handle(
    'x:setHandle',
    async (
      _,
      handle: string,
      context: SessionContext
    ): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const scope = resolveNearestScope(context);
      setXHandleForScope(memory, scope, handle);
      return { success: true };
    }
  );

  // ── Sync now (the Analytics panel's manual sync button) ──

  ipcMain.handle('x:syncNow', async (_, context: SessionContext): Promise<XSyncResult> => {
    const memory = getMemory();
    if (!memory) return { ok: false, postsWritten: 0, error: 'Memory not initialized' };

    const scope = resolveNearestScope(context);
    const handle = getXHandleForScope(memory, scope);
    if (!handle) {
      return {
        ok: false,
        postsWritten: 0,
        error: 'No X/Twitter handle configured for this workspace yet.',
      };
    }

    return syncXAnalyticsForScope(memory, scope, handle, context);
  });
}
