/**
 * Campaign / plan agent tools (roadmap item 10): create_campaign,
 * add_deliverable, update_deliverable_status, get_campaign respect the
 * active session's context — a campaign created while a client is active
 * lives at that brand, and no tool can read/write into another scope's
 * campaign even by numeric id. Dependency enforcement surfaces as a clear
 * tool error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub only the async embedding writes so MemoryManager needs no embedding model.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

import { MemoryManager } from '../../src/memory/index';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import {
  handleCreateCampaignTool,
  handleAddDeliverableTool,
  handleUpdateDeliverableStatusTool,
  handleGetCampaignTool,
} from '../../src/tools/campaign-tools';

let memory: MemoryManager;

async function setActiveContext(
  sessionId: string,
  context: { contextType: 'personal' | 'world' | 'client' | 'project'; clientId: string | null; projectKey: string | null }
): Promise<void> {
  memory.ensureSession(sessionId);
  memory.setSessionContext(sessionId, context);
  setCurrentSessionId(sessionId);
}

beforeEach(() => {
  memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
});

describe('create_campaign — scoped to the active context', () => {
  it('creates a campaign in the personal (user) scope by default', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const res = JSON.parse(await handleCreateCampaignTool({ name: 'Personal plan' }));
    expect(res.success).toBe(true);
    expect(res.scope).toBe('user');
    const campaign = memory.getCampaign(res.id);
    expect(campaign?.scope).toBe('user');
  });

  it('creates a campaign scoped to the active client', async () => {
    memory.createClient({ id: 'acme', name: 'Acme' });
    await setActiveContext('S', { contextType: 'client', clientId: 'acme', projectKey: null });

    const res = JSON.parse(await handleCreateCampaignTool({ name: 'Acme launch', brief: 'Q3' }));
    expect(res.success).toBe(true);
    expect(res.scope).toBe('client:acme');
  });

  it('requires a name', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const res = JSON.parse(await handleCreateCampaignTool({}));
    expect(res.error).toBeTruthy();
  });
});

describe('add_deliverable — scoped to the active context', () => {
  it('adds a deliverable to a campaign visible in the active context', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const created = JSON.parse(await handleCreateCampaignTool({ name: 'My plan' }));

    const res = JSON.parse(
      await handleAddDeliverableTool({ campaign_id: created.id, title: 'Write outline', lane: 'writer' })
    );
    expect(res.success).toBe(true);
    expect(res.status).toBe('pending');
  });

  it("refuses to add a deliverable to another brand's campaign, even by numeric id", async () => {
    memory.createClient({ id: 'brandA', name: 'Brand A' });
    memory.createClient({ id: 'brandB', name: 'Brand B' });

    await setActiveContext('S1', { contextType: 'client', clientId: 'brandA', projectKey: null });
    const campaignA = JSON.parse(await handleCreateCampaignTool({ name: 'Brand A campaign' }));

    // Switch the active session to Brand B and try to write into Brand A's campaign id.
    await setActiveContext('S2', { contextType: 'client', clientId: 'brandB', projectKey: null });
    const res = JSON.parse(
      await handleAddDeliverableTool({ campaign_id: campaignA.id, title: 'Sneaky deliverable' })
    );
    expect(res.error).toBeTruthy();
    expect(memory.getDeliverablesForCampaign(campaignA.id)).toEqual([]);
  });

  it('refuses when the campaign does not exist', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const res = JSON.parse(await handleAddDeliverableTool({ campaign_id: 999999, title: 'x' }));
    expect(res.error).toBeTruthy();
  });

  it('propagates the same-campaign dependsOn validation from the data layer', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const c1 = JSON.parse(await handleCreateCampaignTool({ name: 'Campaign 1' }));
    const c2 = JSON.parse(await handleCreateCampaignTool({ name: 'Campaign 2' }));
    const d1 = JSON.parse(await handleAddDeliverableTool({ campaign_id: c1.id, title: 'Task in C1' }));

    const res = JSON.parse(
      await handleAddDeliverableTool({ campaign_id: c2.id, title: 'Task in C2', depends_on: d1.id })
    );
    expect(res.error).toMatch(/different campaign/);
  });
});

describe('update_deliverable_status — dependency enforcement surfaces as a tool error', () => {
  it('refuses to move to in_progress while the dependency is not done, with a clear error', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const campaign = JSON.parse(await handleCreateCampaignTool({ name: 'Plan' }));
    const dep = JSON.parse(await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Research' }));
    const dependent = JSON.parse(
      await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Write', depends_on: dep.id })
    );

    const res = JSON.parse(
      await handleUpdateDeliverableStatusTool({ deliverable_id: dependent.id, status: 'in_progress' })
    );
    expect(res.error).toBeTruthy();
    expect(res.error).toMatch(/depends on/i);
  });

  it('allows the transition once the dependency is done', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const campaign = JSON.parse(await handleCreateCampaignTool({ name: 'Plan' }));
    const dep = JSON.parse(await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Research' }));
    const dependent = JSON.parse(
      await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Write', depends_on: dep.id })
    );

    await handleUpdateDeliverableStatusTool({ deliverable_id: dep.id, status: 'in_progress' });
    await handleUpdateDeliverableStatusTool({ deliverable_id: dep.id, status: 'review' });
    await handleUpdateDeliverableStatusTool({ deliverable_id: dep.id, status: 'done' });

    const res = JSON.parse(
      await handleUpdateDeliverableStatusTool({ deliverable_id: dependent.id, status: 'in_progress' })
    );
    expect(res.success).toBe(true);
  });

  it("refuses to update a deliverable outside the active workspace's visible scopes", async () => {
    memory.createClient({ id: 'brandA', name: 'Brand A' });
    memory.createClient({ id: 'brandB', name: 'Brand B' });

    await setActiveContext('S1', { contextType: 'client', clientId: 'brandA', projectKey: null });
    const campaignA = JSON.parse(await handleCreateCampaignTool({ name: 'Brand A campaign' }));
    const deliverableA = JSON.parse(
      await handleAddDeliverableTool({ campaign_id: campaignA.id, title: 'Brand A task' })
    );

    await setActiveContext('S2', { contextType: 'client', clientId: 'brandB', projectKey: null });
    const res = JSON.parse(
      await handleUpdateDeliverableStatusTool({ deliverable_id: deliverableA.id, status: 'in_progress' })
    );
    expect(res.error).toBeTruthy();
    expect(memory.getDeliverable(deliverableA.id)?.status).toBe('pending');
  });

  it('sets result_ref alongside a status update', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const campaign = JSON.parse(await handleCreateCampaignTool({ name: 'Plan' }));
    const d = JSON.parse(await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Task' }));
    await handleUpdateDeliverableStatusTool({ deliverable_id: d.id, status: 'in_progress' });

    const res = JSON.parse(
      await handleUpdateDeliverableStatusTool({
        deliverable_id: d.id,
        status: 'review',
        result_ref: 'content_draft:42',
      })
    );
    expect(res.success).toBe(true);
    expect(memory.getDeliverable(d.id)?.result_ref).toBe('content_draft:42');
  });
});

describe('get_campaign — scoped reads', () => {
  it('lists only campaigns visible in the active workspace when campaign_id is omitted', async () => {
    memory.createClient({ id: 'brandA', name: 'Brand A' });
    memory.createClient({ id: 'brandB', name: 'Brand B' });

    await setActiveContext('S1', { contextType: 'client', clientId: 'brandA', projectKey: null });
    await handleCreateCampaignTool({ name: 'Brand A campaign' });

    await setActiveContext('S2', { contextType: 'client', clientId: 'brandB', projectKey: null });
    await handleCreateCampaignTool({ name: 'Brand B campaign' });

    const res = JSON.parse(await handleGetCampaignTool({}));
    expect(res.success).toBe(true);
    const names = res.campaigns.map((c: { name: string }) => c.name);
    expect(names).toContain('Brand B campaign');
    expect(names).not.toContain('Brand A campaign');
  });

  it('reads one campaign with its deliverables', async () => {
    await setActiveContext('S', { contextType: 'personal', clientId: null, projectKey: null });
    const campaign = JSON.parse(await handleCreateCampaignTool({ name: 'Plan' }));
    await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Task 1' });
    await handleAddDeliverableTool({ campaign_id: campaign.id, title: 'Task 2' });

    const res = JSON.parse(await handleGetCampaignTool({ campaign_id: campaign.id }));
    expect(res.success).toBe(true);
    expect(res.campaign.name).toBe('Plan');
    expect(res.deliverables).toHaveLength(2);
  });

  it("refuses to read another brand's campaign by numeric id", async () => {
    memory.createClient({ id: 'brandA', name: 'Brand A' });
    memory.createClient({ id: 'brandB', name: 'Brand B' });

    await setActiveContext('S1', { contextType: 'client', clientId: 'brandA', projectKey: null });
    const campaignA = JSON.parse(await handleCreateCampaignTool({ name: 'Brand A campaign' }));

    await setActiveContext('S2', { contextType: 'client', clientId: 'brandB', projectKey: null });
    const res = JSON.parse(await handleGetCampaignTool({ campaign_id: campaignA.id }));
    expect(res.error).toBeTruthy();
  });

  it('personal context never sees a brand campaign, even by numeric id', async () => {
    memory.createClient({ id: 'acme', name: 'Acme' });
    await setActiveContext('S1', { contextType: 'client', clientId: 'acme', projectKey: null });
    const campaign = JSON.parse(await handleCreateCampaignTool({ name: 'Acme campaign' }));

    await setActiveContext('S2', { contextType: 'personal', clientId: null, projectKey: null });
    const res = JSON.parse(await handleGetCampaignTool({ campaign_id: campaign.id }));
    expect(res.error).toBeTruthy();
  });
});
