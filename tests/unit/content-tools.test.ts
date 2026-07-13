/**
 * Content workflow agent tools (roadmap item 6): save_draft/submit_for_approval
 * are model-callable; post/schedule refuse anything not "approved"; dry-run
 * mode never calls a real MCP tool.
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

const settingsStore = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (key: string) => settingsStore.get(key) ?? '',
    set: (key: string, value: string) => {
      settingsStore.set(key, value);
    },
  },
}));

// Mock the MCP bridge — content-tools.ts's live routing is exercised
// end-to-end in tests/unit/mcp-bridge.test.ts against a real spawned
// process; here we control exactly which (if any) posting tool is
// "available" to isolate content-tools.ts's own post/schedule logic.
const mcpBridgedToolsMock = vi.fn(async () => [] as Array<{
  name: string;
  execute: (args: unknown, ctx: unknown) => Promise<string>;
}>);
vi.mock('../../src/agent/mcp-bridge', () => ({
  getMcpBridgedTools: (...args: unknown[]) => mcpBridgedToolsMock(...args),
}));

import { MemoryManager } from '../../src/memory/index';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import {
  handleSaveDraftTool,
  handleSubmitForApprovalTool,
  handlePostContentDraftTool,
  handleScheduleContentDraftTool,
  postApprovedDraft,
  scheduleApprovedDraft,
} from '../../src/tools/content-tools';

let memory: MemoryManager;

beforeEach(() => {
  settingsStore.clear();
  mcpBridgedToolsMock.mockReset();
  mcpBridgedToolsMock.mockResolvedValue([]);
  memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
  setCurrentSessionId('S');
  // content_drafts.session_id and cron_jobs.session_id both FK-reference
  // sessions(id) — ensure the synthetic session exists, same as production
  // code paths that persist a message before referencing a session id.
  memory.ensureSession('S');
});

describe('save_draft / submit_for_approval tools', () => {
  it('save_draft creates a draft in "draft" status', async () => {
    const res = JSON.parse(
      await handleSaveDraftTool({ channel: 'twitter', body: 'hello world' })
    );
    expect(res.success).toBe(true);
    expect(res.status).toBe('draft');
    const draft = memory.getContentDraft(res.id);
    expect(draft!.body).toBe('hello world');
  });

  it('save_draft requires channel and body', async () => {
    const res = JSON.parse(await handleSaveDraftTool({ channel: '', body: '' }));
    expect(res.error).toBeTruthy();
  });

  it('submit_for_approval moves draft -> pending_approval', async () => {
    const created = JSON.parse(await handleSaveDraftTool({ channel: 'twitter', body: 'x' }));
    const res = JSON.parse(await handleSubmitForApprovalTool({ draft_id: created.id }));
    expect(res.success).toBe(true);
    expect(res.status).toBe('pending_approval');
  });

  it('submit_for_approval refuses an unknown draft id', async () => {
    const res = JSON.parse(await handleSubmitForApprovalTool({ draft_id: 999999 }));
    expect(res.error).toBeTruthy();
  });
});

describe('post_content_draft tool — only approved drafts can be posted', () => {
  it('refuses to post a draft still in "draft" status', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not approved/i);
    expect(memory.getContentDraft(id)!.status).toBe('draft');
  });

  it('refuses to post a "pending_approval" draft', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.success).toBe(false);
    expect(memory.getContentDraft(id)!.status).toBe('pending_approval');
  });

  it('refuses to post a "rejected" draft', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    memory.setContentDraftStatus(id, 'rejected', 'human');
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.success).toBe(false);
  });
});

describe('dry-run mode (content.dryRun, default ON)', () => {
  function approvedDraft(body = 'hello'): number {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    memory.setContentDraftStatus(id, 'approved', 'human');
    return id;
  }

  it('defaults to dry-run ON when the setting is unset', async () => {
    const id = approvedDraft();
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.dryRun).toBe(true);
    expect(mcpBridgedToolsMock).not.toHaveBeenCalled();
  });

  it('dry-run logs a dry_run post-history entry and marks the draft posted', async () => {
    const id = approvedDraft('the actual content');
    await handlePostContentDraftTool({ draft_id: id });

    expect(memory.getContentDraft(id)!.status).toBe('posted');
    const history = memory.getContentPostsForDraft(id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('dry_run');
    expect(history[0].detail).toContain('DRY RUN');
    expect(history[0].detail).toContain('the actual content');
  });

  it('dry-run never calls any bridged MCP tool', async () => {
    const id = approvedDraft();
    await handlePostContentDraftTool({ draft_id: id });
    expect(mcpBridgedToolsMock).not.toHaveBeenCalled();
  });

  it("explicitly setting content.dryRun='false' enables live posting attempts", async () => {
    settingsStore.set('content.dryRun', 'false');
    const id = approvedDraft();
    await handlePostContentDraftTool({ draft_id: id });
    expect(mcpBridgedToolsMock).toHaveBeenCalled();
  });
});

describe('live posting (content.dryRun=false) — MCP tool routing', () => {
  function approvedDraft(channel = 'twitter', body = 'hello'): number {
    const id = memory.createContentDraft({ scope: 'user', channel, body });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    memory.setContentDraftStatus(id, 'approved', 'human');
    return id;
  }

  beforeEach(() => {
    settingsStore.set('content.dryRun', 'false');
  });

  it('fails when no matching MCP posting tool is bridged', async () => {
    mcpBridgedToolsMock.mockResolvedValue([]);
    const id = approvedDraft();
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.success).toBe(false);
    expect(memory.getContentDraft(id)!.status).toBe('failed');
    const history = memory.getContentPostsForDraft(id);
    expect(history[0].status).toBe('failed');
  });

  it('calls a matching posting tool and marks the draft posted on success', async () => {
    const execute = vi.fn(async () => 'ok: posted https://twitter.com/x/status/123');
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_buffer_createPost', execute }]);
    const id = approvedDraft('buffer', 'schedule this');
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.success).toBe(true);
    expect(execute).toHaveBeenCalled();
    expect(memory.getContentDraft(id)!.status).toBe('posted');
    expect(memory.getContentDraft(id)!.posted_at).toBeTruthy();
  });

  it('marks the draft failed when the MCP tool returns an Error: response', async () => {
    const execute = vi.fn(async () => 'Error: invalid API key');
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_buffer_createPost', execute }]);
    const id = approvedDraft('buffer');
    const res = JSON.parse(await handlePostContentDraftTool({ draft_id: id }));
    expect(res.success).toBe(false);
    expect(memory.getContentDraft(id)!.status).toBe('failed');
  });

  it('prefers a posting tool whose name matches the draft channel', async () => {
    const twitterExecute = vi.fn(async () => 'ok');
    const bufferExecute = vi.fn(async () => 'ok');
    mcpBridgedToolsMock.mockResolvedValue([
      { name: 'mcp_buffer_createPost', execute: bufferExecute },
      { name: 'mcp_twitter_postTweet', execute: twitterExecute },
    ]);
    const id = approvedDraft('twitter');
    await handlePostContentDraftTool({ draft_id: id });
    expect(twitterExecute).toHaveBeenCalled();
    expect(bufferExecute).not.toHaveBeenCalled();
  });
});

describe('schedule_content_draft tool — only approved drafts can be scheduled', () => {
  it('refuses to schedule a draft still in "draft" status', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    const res = JSON.parse(
      await handleScheduleContentDraftTool({ draft_id: id, scheduled_for: '2027-01-01T09:00:00Z' })
    );
    expect(res.error).toBeTruthy();
    expect(memory.getContentDraft(id)!.status).toBe('draft');
  });

  it('rejects an invalid datetime', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    memory.setContentDraftStatus(id, 'approved', 'human');
    const res = JSON.parse(
      await handleScheduleContentDraftTool({ draft_id: id, scheduled_for: 'not-a-date' })
    );
    expect(res.error).toBeTruthy();
  });

  it('schedules an approved draft: creates a cron job and flips status to "scheduled"', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    memory.setContentDraftStatus(id, 'pending_approval', 'agent');
    memory.setContentDraftStatus(id, 'approved', 'human');

    const res = JSON.parse(
      await handleScheduleContentDraftTool({ draft_id: id, scheduled_for: '2027-01-01T09:00:00Z' })
    );
    expect(res.success).toBe(true);
    expect(res.cron_job_id).toBeTruthy();

    const draft = memory.getContentDraft(id)!;
    expect(draft.status).toBe('scheduled');
    expect(draft.cron_job_id).toBe(res.cron_job_id);
    expect(draft.scheduled_for).toBeTruthy();

    const jobs = memory.getCronJobs(false);
    const job = jobs.find((j) => j.id === res.cron_job_id);
    expect(job).toBeTruthy();
    expect((job as unknown as { job_type: string }).job_type).toBe('content_post');
  });
});

describe('postApprovedDraft / scheduleApprovedDraft — shared enforcement (agent + human callers)', () => {
  it('postApprovedDraft rejects a non-approved draft regardless of actor path', async () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    const draft = memory.getContentDraft(id)!;
    const result = await postApprovedDraft(memory, draft, undefined, 'S');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('scheduleApprovedDraft rejects a non-approved draft regardless of actor path', () => {
    const id = memory.createContentDraft({ scope: 'user', channel: 'twitter', body: 'x' });
    const draft = memory.getContentDraft(id)!;
    const result = scheduleApprovedDraft(memory, draft, '2027-01-01T09:00:00Z', 'human');
    expect(result.ok).toBe(false);
  });
});
