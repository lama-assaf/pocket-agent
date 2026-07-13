// src/main/ipc/campaign-ipc.ts
// Campaign board surface (roadmap item 10): read-only list/detail for v1,
// plus the "nudge" action that composes a prompt for the next unblocked
// deliverable and hands it to the chat window (the UI decides how to send
// it — this IPC just resolves what to say). Creation/status writes are also
// exposed here so a human can manage a campaign from the board without
// needing to ask the agent, mirroring content-ipc.ts's "human can do
// anything the agent tool can, plus the human-only actions" pattern (there
// are no human-only actions here — campaigns have no approval gate like
// content drafts do).
import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import { resolveVisibleScopes, resolveNearestScope } from '../../memory/scope';
import type { SessionContext } from '../../memory/sessions';
import type { CampaignStatus, DeliverableStatus } from '../../memory/campaigns';

// Not a real session — the campaign board has no "current chat" while
// browsing, so this is used only to build the `chat:<id>` link of the
// visible-scope chain (resolveVisibleScopes always includes it), same
// pattern as content-ipc.ts / marketplace-ipc.ts's UI-session placeholders.
const CAMPAIGN_UI_SESSION_ID = 'ipc:campaign-ui';

export function registerCampaignIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  ipcMain.handle(
    'campaigns:list',
    async (_, context: SessionContext, status?: CampaignStatus) => {
      const memory = getMemory();
      if (!memory) return [];
      const visible = resolveVisibleScopes(context, CAMPAIGN_UI_SESSION_ID);
      return memory.getCampaignsForScopes(visible, status);
    }
  );

  ipcMain.handle('campaigns:get', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return null;
    const campaign = memory.getCampaign(id);
    if (!campaign) return null;
    const deliverables = memory.getDeliverablesForCampaign(id);
    return { campaign, deliverables };
  });

  ipcMain.handle(
    'campaigns:create',
    async (
      _,
      input: { name: string; brief?: string },
      context: SessionContext
    ): Promise<{ success: boolean; id?: number; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      if (!input.name) return { success: false, error: 'Missing required field: name' };
      const scope = resolveNearestScope(context);
      const id = memory.createCampaign({ scope, name: input.name, brief: input.brief });
      return { success: true, id };
    }
  );

  ipcMain.handle(
    'campaigns:update',
    async (
      _,
      id: number,
      fields: { name?: string; brief?: string; status?: CampaignStatus }
    ): Promise<{ success: boolean }> => {
      const memory = getMemory();
      if (!memory) return { success: false };
      return { success: memory.updateCampaign(id, fields) };
    }
  );

  ipcMain.handle('campaigns:delete', async (_, id: number): Promise<{ success: boolean }> => {
    const memory = getMemory();
    if (!memory) return { success: false };
    return { success: memory.deleteCampaign(id) };
  });

  ipcMain.handle(
    'campaigns:addDeliverable',
    async (
      _,
      input: {
        campaignId: number;
        title: string;
        description?: string;
        lane?: string | null;
        assignedSpecialist?: string | null;
        dependsOn?: number | null;
      }
    ): Promise<{ success: boolean; id?: number; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.addDeliverable(input);
      return { success: result.ok, id: result.id, error: result.error };
    }
  );

  ipcMain.handle(
    'campaigns:setDeliverableStatus',
    async (
      _,
      id: number,
      status: DeliverableStatus,
      resultRef?: string
    ): Promise<{ success: boolean; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const result = memory.setDeliverableStatus(id, status, resultRef);
      return { success: result.ok, error: result.error };
    }
  );

  ipcMain.handle('campaigns:deleteDeliverable', async (_, id: number): Promise<{ success: boolean }> => {
    const memory = getMemory();
    if (!memory) return { success: false };
    return { success: memory.deleteDeliverable(id) };
  });

  // "Nudge" (roadmap item 10, requirement 4): resolve the next unblocked
  // deliverable and hand back a ready-to-send prompt string. The renderer
  // decides how to deliver it (prefill the composer, same pattern
  // agents-panel.js's "Call this agent" uses) — this IPC does the read-only
  // resolution so the prompt text always matches what's actually next.
  ipcMain.handle(
    'campaigns:nudgePrompt',
    async (_, campaignId: number): Promise<{ success: boolean; prompt?: string; error?: string }> => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const campaign = memory.getCampaign(campaignId);
      if (!campaign) return { success: false, error: `Campaign #${campaignId} not found.` };

      const next = memory.getNextUnblockedDeliverable(campaignId);
      if (!next) {
        return {
          success: false,
          error: 'No unblocked deliverable to advance — everything is done, in progress, or blocked on something else.',
        };
      }

      const laneNote = next.lane ? ` (${next.lane} lane)` : '';
      const specialistNote = next.assigned_specialist
        ? ` Use the "${next.assigned_specialist}" specialist via the subagent tool.`
        : '';
      const prompt =
        `Advance campaign "${campaign.name}" (#${campaign.id}): work on deliverable "${next.title}"${laneNote} (#${next.id}).` +
        (next.description ? ` ${next.description}` : '') +
        specialistNote +
        ' Update its status with update_deliverable_status as you progress.';

      return { success: true, prompt };
    }
  );
}
