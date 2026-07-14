// src/main/ipc/analytics-ipc.ts
// Analytics surface: record/list/summarize per-post metrics (impressions,
// likes, comments, shares, clicks, video views) for X/LinkedIn/etc., scoped
// like content/campaigns. Follows content-ipc.ts's conventions: a UI-session
// placeholder id for the visible-scope chain, memory-null guards, and thin
// handlers that delegate all real logic to src/memory/analytics.ts.
import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import { resolveVisibleScopes, resolveNearestScope } from '../../memory/scope';
import type { SessionContext } from '../../memory/sessions';
import type { RecordPostAnalyticsInput, AnalyticsSummary, PostAnalytics } from '../../memory/analytics';

// Not a real session — the Analytics panel has no "current chat" while
// browsing, so this only builds the `chat:<id>` link of the visible-scope
// chain (resolveVisibleScopes always includes it) — same pattern as
// content-ipc.ts's CONTENT_UI_SESSION_ID.
const ANALYTICS_UI_SESSION_ID = 'ipc:analytics-ui';

export function registerAnalyticsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // List every visible post's LATEST snapshot (one row per post, not full
  // history) — this is what "current numbers" and the per-post drill-down
  // list both want. Optionally filtered to one channel.
  ipcMain.handle(
    'analytics:list',
    async (_, context: SessionContext, channel?: string): Promise<PostAnalytics[]> => {
      const memory = getMemory();
      if (!memory) return [];
      const visible = resolveVisibleScopes(context, ANALYTICS_UI_SESSION_ID);
      return memory.getLatestPostAnalyticsForScopes(visible, channel);
    }
  );

  // Full snapshot history for one specific post (scope+channel+externalRef),
  // for a "performance over time" view on the drill-down.
  ipcMain.handle(
    'analytics:history',
    async (_, scope: string, channel: string, externalRef: string): Promise<PostAnalytics[]> => {
      const memory = getMemory();
      if (!memory) return [];
      return memory.getPostAnalyticsHistory(scope, channel, externalRef);
    }
  );

  // Aggregate summary (totals, per-channel breakdown, top posts) across every
  // visible post's latest snapshot, optionally filtered to one channel — the
  // overview numbers for the Analytics page's top section.
  ipcMain.handle(
    'analytics:summary',
    async (_, context: SessionContext, channel?: string): Promise<AnalyticsSummary> => {
      const memory = getMemory();
      if (!memory) {
        return {
          totalPosts: 0,
          impressions: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
          videoViews: 0,
          engagementRate: 0,
          byChannel: {},
          topPosts: [],
        };
      }
      const visible = resolveVisibleScopes(context, ANALYTICS_UI_SESSION_ID);
      const rows = memory.getLatestPostAnalyticsForScopes(visible, channel);
      return memory.summarizeAnalytics(rows);
    }
  );

  // Record a new snapshot (manual entry or an ingestion path) at the active
  // context's nearest scope — mirrors content:create's contract, so a new
  // entry can never silently leak across brands.
  ipcMain.handle(
    'analytics:record',
    async (
      _,
      input: Omit<RecordPostAnalyticsInput, 'scope'>,
      context: SessionContext
    ): Promise<{ success: boolean; id?: number; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      if (!input.channel || !input.externalRef) {
        return { success: false, error: 'Missing required fields: channel, externalRef' };
      }
      const scope = resolveNearestScope(context);
      const id = memory.recordPostAnalytics({ ...input, scope });
      return { success: true, id };
    }
  );

  ipcMain.handle('analytics:delete', async (_, id: number): Promise<{ success: boolean }> => {
    const memory = getMemory();
    if (!memory) return { success: false };
    return { success: memory.deletePostAnalytics(id) };
  });
}
