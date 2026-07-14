// src/main/ipc/linkedin-ipc.ts
// LinkedIn Community Management API connection + sync surface. OAuth handlers
// mirror the Claude/OpenAI/Kimi pattern in src/main/ipc/misc-ipc.ts (dynamic
// import of the auth singleton, thin handlers). Org-URN + sync handlers
// follow content-ipc.ts/analytics-ipc.ts's scope-resolution conventions.
import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import { resolveNearestScope } from '../../memory/scope';
import type { SessionContext } from '../../memory/sessions';
import {
  getLinkedInOrgUrnForScope,
  setLinkedInOrgUrnForScope,
  syncLinkedInAnalyticsForScope,
  type LinkedInSyncResult,
} from '../../integrations/linkedin/sync';

export function registerLinkedInIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // ── OAuth connection (global — one Developer app, one authorized member) ──

  ipcMain.handle('linkedin:startOAuth', async () => {
    const { LinkedInOAuth } = await import('../../auth/linkedin-oauth');
    return LinkedInOAuth.startFlow();
  });

  ipcMain.handle('linkedin:cancelOAuth', async () => {
    const { LinkedInOAuth } = await import('../../auth/linkedin-oauth');
    LinkedInOAuth.cancelFlow();
    return { success: true };
  });

  ipcMain.handle('linkedin:isOAuthPending', async () => {
    const { LinkedInOAuth } = await import('../../auth/linkedin-oauth');
    return LinkedInOAuth.isPending();
  });

  ipcMain.handle('linkedin:logout', async () => {
    const { LinkedInOAuth } = await import('../../auth/linkedin-oauth');
    LinkedInOAuth.logout();
    return { success: true };
  });

  // Connection status: distinguishes "no app credentials entered yet",
  // "credentials entered but never signed in", "connected", and "token
  // expired/invalid" so the UI can show an exact, actionable state rather
  // than a generic error.
  ipcMain.handle('linkedin:getAuthStatus', async (): Promise<{
    hasAppCredentials: boolean;
    connected: boolean;
  }> => {
    const { LinkedInOAuth } = await import('../../auth/linkedin-oauth');
    const hasAppCredentials = LinkedInOAuth.hasAppCredentials();
    if (!hasAppCredentials) return { hasAppCredentials: false, connected: false };
    try {
      const token = await Promise.race([
        LinkedInOAuth.getAccessToken(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      return { hasAppCredentials: true, connected: token !== null };
    } catch {
      return { hasAppCredentials: true, connected: false };
    }
  });

  // ── Per-scope org URN (which org page this client/world/project tracks) ──

  ipcMain.handle('linkedin:getOrgUrn', async (_, context: SessionContext): Promise<string | null> => {
    const memory = getMemory();
    if (!memory) return null;
    const scope = resolveNearestScope(context);
    return getLinkedInOrgUrnForScope(memory, scope);
  });

  ipcMain.handle(
    'linkedin:setOrgUrn',
    async (_, orgUrn: string, context: SessionContext): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const scope = resolveNearestScope(context);
      setLinkedInOrgUrnForScope(memory, scope, orgUrn);
      return { success: true };
    }
  );

  // ── Sync now (the Analytics panel's manual sync button) ──

  ipcMain.handle(
    'linkedin:syncNow',
    async (_, context: SessionContext): Promise<LinkedInSyncResult> => {
      const memory = getMemory();
      if (!memory) return { ok: false, postsWritten: 0, error: 'Memory not initialized' };

      const scope = resolveNearestScope(context);
      const orgUrn = getLinkedInOrgUrnForScope(memory, scope);
      if (!orgUrn) {
        return {
          ok: false,
          postsWritten: 0,
          error: 'No LinkedIn Organization URN configured for this workspace yet.',
        };
      }

      const { LinkedInOAuth } = await import('../../auth/linkedin-oauth');
      if (!LinkedInOAuth.hasAppCredentials()) {
        return {
          ok: false,
          postsWritten: 0,
          error: 'LinkedIn is not configured — add a Client ID/Secret in Settings > LinkedIn.',
        };
      }
      const accessToken = await LinkedInOAuth.getAccessToken();
      if (!accessToken) {
        return {
          ok: false,
          postsWritten: 0,
          error: 'LinkedIn is not connected (or the session expired) — sign in again in Settings > LinkedIn.',
        };
      }

      return syncLinkedInAnalyticsForScope(memory, scope, orgUrn, accessToken);
    }
  );

  // Surfaced read-only in the UI so a missing app-credential state can show
  // the exact redirect URI the user must register in their LinkedIn app,
  // without hardcoding the port in two places.
  ipcMain.handle('linkedin:getRedirectUri', async () => {
    const { REDIRECT_URI } = await import('../../auth/linkedin-oauth');
    return REDIRECT_URI;
  });
}
