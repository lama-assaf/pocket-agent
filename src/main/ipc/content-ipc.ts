// src/main/ipc/content-ipc.ts
// Content queue surface (roadmap item 6): list/history reads, plus the ONLY
// place approve/reject can happen. There is deliberately no agent tool for
// approval — src/tools/content-tools.ts's save_draft/submit_for_approval are
// the only model-callable content tools; canTransition in
// src/memory/content-drafts.ts additionally rejects an 'agent' actor
// targeting 'approved'/'rejected' server-side, so even a bug here can't let
// the model approve its own drafts.
import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import { resolveVisibleScopes, resolveNearestScope } from '../../memory/scope';
import type { SessionContext } from '../../memory/sessions';
import type { ContentDraftStatus } from '../../memory/content-drafts';
import { postApprovedDraft, scheduleApprovedDraft } from '../../tools/content-tools';

// Not a real session — the content queue panel has no "current chat" while
// browsing, so this is used only to build the `chat:<id>` link of the
// visible-scope chain (resolveVisibleScopes always includes it), same
// pattern as marketplace-ipc.ts / mcp-ipc.ts's UI-session placeholders.
const CONTENT_UI_SESSION_ID = 'ipc:content-ui';

export function registerContentIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  ipcMain.handle(
    'content:list',
    async (_, context: SessionContext, status?: ContentDraftStatus) => {
      const memory = getMemory();
      if (!memory) return [];
      const visible = resolveVisibleScopes(context, CONTENT_UI_SESSION_ID);
      return memory.getContentDraftsForScopes(visible, status);
    }
  );

  ipcMain.handle('content:get', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return null;
    return memory.getContentDraft(id);
  });

  ipcMain.handle('content:history', async (_, context: SessionContext, draftId?: number) => {
    const memory = getMemory();
    if (!memory) return [];
    if (draftId) return memory.getContentPostsForDraft(draftId);
    const visible = resolveVisibleScopes(context, CONTENT_UI_SESSION_ID);
    return memory.getContentPostsForScopes(visible);
  });

  // Human path into the approval pipeline: a draft created by hand in this
  // panel (rather than via the agent's save_draft + submit_for_approval
  // tools) had no way to reach 'pending_approval' — Edit/Delete were the
  // only actions offered for status 'draft', a dead end for anyone not
  // asking the agent to submit it on their behalf. Mirrors
  // handleSubmitForApprovalTool's transition exactly, just with actor
  // 'human' (canTransition only special-cases 'agent' targeting
  // approved/rejected, so 'human' -> 'pending_approval' was always a valid
  // transition — this just exposes it here too).
  ipcMain.handle(
    'content:submitForApproval',
    async (_, id: number): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.setContentDraftStatus(id, 'pending_approval', 'human');
      return { success: result.ok, error: result.error };
    }
  );

  // ── Human-only approval ──────────────────────────────────────────────────
  ipcMain.handle(
    'content:approve',
    async (_, id: number): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.setContentDraftStatus(id, 'approved', 'human');
      return { success: result.ok, error: result.error };
    }
  );

  ipcMain.handle(
    'content:reject',
    async (_, id: number): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.setContentDraftStatus(id, 'rejected', 'human');
      return { success: result.ok, error: result.error };
    }
  );

  // Generic human-triggered status transition, for the edges that don't
  // already have a dedicated verb (e.g. 'scheduled' -> 'draft', 'failed' ->
  // 'draft' — a "back to draft to fix it up" escape hatch from either dead
  // end). Mirrors campaigns:setDeliverableStatus's generic-target shape;
  // canTransition (actor 'human') still enforces the underlying state
  // machine, so this can't be used to skip the approval gate.
  ipcMain.handle(
    'content:setStatus',
    async (_, id: number, status: ContentDraftStatus): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.setContentDraftStatus(id, status, 'human');
      return { success: result.ok, error: result.error };
    }
  );

  // ── Human-triggered post/schedule on an already-approved draft ─────────
  // Both reuse the exact function the agent tools call (postApprovedDraft /
  // scheduleApprovedDraft) — one enforcement point for "approved only",
  // whether the caller is the model or a human clicking a button.
  ipcMain.handle(
    'content:postNow',
    async (
      _,
      id: number,
      context?: SessionContext
    ): Promise<{ success: boolean; status?: string; dryRun?: boolean; detail?: string; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const draft = memory.getContentDraft(id);
      if (!draft) return { success: false, error: `Draft #${id} not found.` };
      const result = await postApprovedDraft(memory, draft, context, CONTENT_UI_SESSION_ID);
      return {
        success: result.ok,
        status: result.status,
        dryRun: result.dryRun,
        detail: result.detail,
        error: result.error,
      };
    }
  );

  ipcMain.handle(
    'content:schedule',
    async (
      _,
      id: number,
      scheduledFor: string
    ): Promise<{ success: boolean; scheduledFor?: string; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const draft = memory.getContentDraft(id);
      if (!draft) return { success: false, error: `Draft #${id} not found.` };
      const result = scheduleApprovedDraft(memory, draft, scheduledFor, 'human', CONTENT_UI_SESSION_ID);
      return { success: result.ok, scheduledFor: result.scheduledFor, error: result.error };
    }
  );

  ipcMain.handle('content:delete', async (_, id: number): Promise<{ success: boolean }> => {
    const memory = getMemory();
    if (!memory) return { success: false };
    return { success: memory.deleteContentDraft(id) };
  });

  // Edit an existing draft's fields. Only permitted while status is 'draft'
  // or 'rejected' — enforced in memory/content-drafts.ts's updateContentDraft,
  // not just here.
  ipcMain.handle(
    'content:update',
    async (
      _,
      id: number,
      fields: { channel?: string; title?: string; body?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.updateContentDraft(id, fields);
      return { success: result.ok, error: result.error };
    }
  );

  // Scope a new draft to the active context's nearest scope, mirroring
  // facts:create's contract — the Content queue panel is always scoped to
  // the active client/project, and a create can never silently leak across
  // brands.
  ipcMain.handle(
    'content:create',
    async (
      _,
      input: { channel: string; title?: string; body: string },
      context: SessionContext
    ): Promise<{ success: boolean; id?: number; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      if (!input.channel || !input.body) {
        return { success: false, error: 'Missing required fields: channel, body' };
      }
      const scope = resolveNearestScope(context);
      const id = memory.createContentDraft({
        scope,
        channel: input.channel,
        title: input.title,
        body: input.body,
      });
      return { success: true, id };
    }
  );
}
