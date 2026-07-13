/**
 * Campaign / plan agent tools (roadmap item 10): create_campaign,
 * add_deliverable, update_deliverable_status, get_campaign. These give the
 * orchestrating model durable, cross-turn state for multi-deliverable work
 * — the campaign is a plan object, NOT a new execution engine. Actually
 * doing a deliverable's work still goes through the existing subagent tool
 * (src/tools/subagent.ts); these tools only read/write the plan.
 *
 * Scoping: every tool here operates on the CURRENT SESSION's active context
 * (nearestScopeForCurrentSession / visibleScopesForCurrentSession, same
 * helpers content-tools.ts uses) — the model never picks a scope directly,
 * so a campaign created while a client is active always lives at that
 * brand, and get_campaign/list reads are restricted to what the active
 * context can see (personal never mixes with shared, one brand never sees
 * another — same isolation guarantee as facts/content drafts).
 *
 * Dependency enforcement (roadmap item 10, requirement 2) lives in
 * src/memory/campaigns.ts's setDeliverableStatus — update_deliverable_status
 * just forwards to it and surfaces the error message the model needs to
 * explain why a deliverable can't start yet.
 */

import { getMemoryManager, nearestScopeForCurrentSession, visibleScopesForCurrentSession } from './memory-tools';
import type { DeliverableStatus } from '../memory/index';

// ============ create_campaign ============

export function getCreateCampaignToolDefinition() {
  return {
    name: 'create_campaign',
    description:
      'Create a new campaign (multi-deliverable plan) for the active brand/workspace. Use this to durably track work that spans multiple turns or days — e.g. a product launch with several content pieces. Add deliverables to it with add_deliverable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short name for the campaign, e.g. "Q3 Product Launch"' },
        brief: {
          type: 'string',
          description: 'What this campaign is about and what success looks like',
        },
      },
      required: ['name'],
    },
  };
}

export async function handleCreateCampaignTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { name, brief } = input as { name: string; brief?: string };
  if (!name) return JSON.stringify({ error: 'Missing required field: name' });

  const scope = nearestScopeForCurrentSession(memory);
  const id = memory.createCampaign({ scope, name, brief });
  console.log(`[Campaign] Created campaign #${id} "${name}" @ ${scope}`);

  return JSON.stringify({ success: true, id, name, status: 'active', scope });
}

// ============ add_deliverable ============

export function getAddDeliverableToolDefinition() {
  return {
    name: 'add_deliverable',
    description:
      'Add a deliverable (unit of work) to a campaign. Deliverables start in "pending" status. Optionally set depends_on to another deliverable\'s id in the SAME campaign — it can\'t start until that one is "done". Assign a lane/specialist so it\'s clear who should execute it (via the subagent tool).',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'The campaign to add this deliverable to' },
        title: { type: 'string', description: 'Short title, e.g. "Write launch blog post"' },
        description: { type: 'string', description: 'What needs to be done' },
        lane: {
          type: 'string',
          description: 'Operator lane this deliverable belongs to, e.g. "design", "product", "brand", "social"',
        },
        assigned_specialist: {
          type: 'string',
          description: 'Named specialist (from the active lane) to dispatch this to via the subagent tool',
        },
        depends_on: {
          type: 'number',
          description: 'Id of another deliverable in this campaign that must be "done" before this one can start',
        },
      },
      required: ['campaign_id', 'title'],
    },
  };
}

export async function handleAddDeliverableTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const {
    campaign_id,
    title,
    description,
    lane,
    assigned_specialist,
    depends_on,
  } = input as {
    campaign_id: number;
    title: string;
    description?: string;
    lane?: string;
    assigned_specialist?: string;
    depends_on?: number;
  };
  if (!campaign_id || !title) {
    return JSON.stringify({ error: 'Missing required fields: campaign_id, title' });
  }

  // A deliverable can only be added to a campaign visible from the current
  // session's context — prevents an agent from writing into another brand's
  // campaign even if it somehow learns the numeric id.
  const visible = visibleScopesForCurrentSession(memory);
  const campaign = memory.getCampaign(campaign_id);
  if (!campaign || !visible.includes(campaign.scope)) {
    return JSON.stringify({ error: `Campaign #${campaign_id} not found in the active workspace.` });
  }

  const result = memory.addDeliverable({
    campaignId: campaign_id,
    title,
    description,
    lane,
    assignedSpecialist: assigned_specialist,
    dependsOn: depends_on,
  });
  if (!result.ok) return JSON.stringify({ error: result.error });

  return JSON.stringify({ success: true, id: result.id, campaign_id, title, status: 'pending' });
}

// ============ update_deliverable_status ============

export function getUpdateDeliverableStatusToolDefinition() {
  return {
    name: 'update_deliverable_status',
    description:
      'Move a deliverable to a new status (pending, in_progress, review, done, blocked). A deliverable CANNOT move to "in_progress" while its depends_on dependency is not "done" — you\'ll get a clear error explaining what to finish first. Optionally set result_ref to summarize the outcome, or "content_draft:<id>" when the output is a content-workflow draft.',
    input_schema: {
      type: 'object' as const,
      properties: {
        deliverable_id: { type: 'number', description: 'The deliverable to update' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'review', 'done', 'blocked'],
          description: 'The new status',
        },
        result_ref: {
          type: 'string',
          description: 'Optional: a summary of the result, or "content_draft:<id>" linking to a saved draft',
        },
      },
      required: ['deliverable_id', 'status'],
    },
  };
}

export async function handleUpdateDeliverableStatusTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { deliverable_id, status, result_ref } = input as {
    deliverable_id: number;
    status: DeliverableStatus;
    result_ref?: string;
  };
  if (!deliverable_id || !status) {
    return JSON.stringify({ error: 'Missing required fields: deliverable_id, status' });
  }

  // Same active-context visibility gate as add_deliverable — resolve the
  // deliverable's parent campaign and check its scope is in the current
  // session's visible-scope chain before allowing any write.
  const deliverable = memory.getDeliverable(deliverable_id);
  if (!deliverable) return JSON.stringify({ error: `Deliverable #${deliverable_id} not found.` });
  const visible = visibleScopesForCurrentSession(memory);
  const campaign = memory.getCampaign(deliverable.campaign_id);
  if (!campaign || !visible.includes(campaign.scope)) {
    return JSON.stringify({ error: `Deliverable #${deliverable_id} not found in the active workspace.` });
  }

  const result = memory.setDeliverableStatus(deliverable_id, status, result_ref);
  if (!result.ok) return JSON.stringify({ error: result.error });

  return JSON.stringify({ success: true, id: deliverable_id, status });
}

// ============ get_campaign ============

export function getGetCampaignToolDefinition() {
  return {
    name: 'get_campaign',
    description:
      'Read a campaign and its deliverables (with status and dependency info) for the active workspace. Call this at the start of a turn to pick up where a multi-day campaign left off, or omit campaign_id to list every active campaign visible in this workspace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: {
          type: 'number',
          description: 'The campaign to read. Omit to list all campaigns visible in the active workspace.',
        },
      },
      required: [],
    },
  };
}

export async function handleGetCampaignTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { campaign_id } = input as { campaign_id?: number };
  const visible = visibleScopesForCurrentSession(memory);

  if (!campaign_id) {
    const campaigns = memory.getCampaignsForScopes(visible);
    return JSON.stringify({ success: true, campaigns });
  }

  const campaign = memory.getCampaign(campaign_id);
  if (!campaign || !visible.includes(campaign.scope)) {
    return JSON.stringify({ error: `Campaign #${campaign_id} not found in the active workspace.` });
  }
  const deliverables = memory.getDeliverablesForCampaign(campaign_id);
  return JSON.stringify({ success: true, campaign, deliverables });
}

// ============ Aggregate ============

export function getCampaignTools() {
  return [
    { ...getCreateCampaignToolDefinition(), handler: handleCreateCampaignTool },
    { ...getAddDeliverableToolDefinition(), handler: handleAddDeliverableTool },
    { ...getUpdateDeliverableStatusToolDefinition(), handler: handleUpdateDeliverableStatusTool },
    { ...getGetCampaignToolDefinition(), handler: handleGetCampaignTool },
  ];
}
