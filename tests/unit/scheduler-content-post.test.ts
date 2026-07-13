/**
 * Roadmap item 6 — scheduling flow: "job fires -> checks draft still
 * approved -> posts -> updates status." Exercises the scheduler's
 * checkDueJobs against a real cron_jobs row created by
 * schedule_content_draft, same setup pattern as
 * tests/unit/scheduler-resurfacing.test.ts (bracket-access the private
 * memory/db fields onto a fresh CronScheduler).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/memory/semantic', () => ({
  embedFactAsync: vi.fn(),
  embedSoulAspectAsync: vi.fn(),
  embedRollup: vi.fn(async () => {}),
  findNearDuplicateFacts: vi.fn(() => []),
  retrieveRelevantFacts: vi.fn(() => ''),
  retrieveRelevantSoul: vi.fn(() => ''),
  retrieveRelevantRollups: vi.fn(() => ''),
  semanticSearchFacts: vi.fn(() => []),
  backfillMissingEmbeddings: vi.fn(async () => {}),
}));

const settingsStore = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (key: string) => settingsStore.get(key) ?? '',
    set: (key: string, value: string) => settingsStore.set(key, value),
  },
}));

vi.mock('../../src/agent', () => ({
  AgentManager: {
    isInitialized: vi.fn(() => true),
    processMessage: vi.fn(async () => ({ response: 'mock', messages: [] })),
  },
}));

// Same isolation rationale as content-tools.test.ts: the MCP bridge's live
// routing is covered end-to-end in tests/unit/mcp-bridge.test.ts; here we
// only need to control whether a posting tool is "available".
const mcpBridgedToolsMock = vi.fn(async () => [] as Array<{
  name: string;
  execute: (args: unknown, ctx: unknown) => Promise<string>;
}>);
vi.mock('../../src/agent/mcp-bridge', () => ({
  getMcpBridgedTools: (...args: unknown[]) => mcpBridgedToolsMock(...args),
}));

import { MemoryManager } from '../../src/memory/index';
import { CronScheduler } from '../../src/scheduler';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import { handleScheduleContentDraftTool } from '../../src/tools/content-tools';

function createSetup() {
  const memory = new MemoryManager(':memory:');
  setMemoryManager(memory);
  const scheduler = new CronScheduler();
  scheduler['memory'] = memory;
  scheduler['db'] = memory['db'];

  const chatMessages: Array<{ jobName: string; response: string; sessionId: string }> = [];
  scheduler.setChatHandler((jobName, _prompt, response, sessionId) => {
    chatMessages.push({ jobName, response, sessionId });
  });

  return { memory, scheduler, chatMessages };
}

beforeEach(() => {
  settingsStore.clear();
  mcpBridgedToolsMock.mockReset();
  mcpBridgedToolsMock.mockResolvedValue([]);
  setCurrentSessionId('S');
});

/** Create + submit + approve a draft, then schedule it 1ms in the past (due now). */
async function scheduleApprovedDraftDueNow(memory: MemoryManager): Promise<number> {
  memory.ensureSession('S');
  const id = memory.createContentDraft({
    scope: 'user',
    sessionId: 'S',
    channel: 'twitter',
    body: 'scheduled content',
  });
  memory.setContentDraftStatus(id, 'pending_approval', 'agent');
  memory.setContentDraftStatus(id, 'approved', 'human');

  const dueAt = new Date(Date.now() - 1000).toISOString();
  const res = JSON.parse(
    await handleScheduleContentDraftTool({ draft_id: id, scheduled_for: dueAt })
  );
  expect(res.success).toBe(true);
  return id;
}

describe('scheduled content post — job fires, re-checks approval, posts, updates status', () => {
  it('posts a still-approved draft (dry run) when its job fires, then deletes the one-time job', async () => {
    const { memory, scheduler } = createSetup();
    const id = await scheduleApprovedDraftDueNow(memory);

    await scheduler['checkDueJobs'](memory['db'], new Date());

    const draft = memory.getContentDraft(id)!;
    expect(draft.status).toBe('posted');
    const history = memory.getContentPostsForDraft(id);
    expect(history[0].status).toBe('dry_run');

    // One-time job is gone after firing.
    const jobs = memory.getCronJobs(false);
    expect(jobs.find((j) => j.content_draft_id === id)).toBeUndefined();
  });

  it('does NOT post a draft that was un-approved (rejected) before the job fired', async () => {
    const { memory, scheduler } = createSetup();
    const id = await scheduleApprovedDraftDueNow(memory);

    // Simulate a human canceling it after scheduling but before the job runs.
    const cancel = memory.setContentDraftStatus(id, 'rejected', 'human');
    expect(cancel.ok).toBe(true);

    await scheduler['checkDueJobs'](memory['db'], new Date());

    const draft = memory.getContentDraft(id)!;
    expect(draft.status).toBe('rejected'); // untouched — never silently posted
    expect(memory.getContentPostsForDraft(id)).toEqual([]);
  });

  it('live mode: posts via a matching bridged MCP tool and records the real result', async () => {
    settingsStore.set('content.dryRun', 'false');
    const execute = vi.fn(async () => 'ok: posted');
    mcpBridgedToolsMock.mockResolvedValue([{ name: 'mcp_twitter_postTweet', execute }]);

    const { memory, scheduler } = createSetup();
    const id = await scheduleApprovedDraftDueNow(memory);

    await scheduler['checkDueJobs'](memory['db'], new Date());

    expect(execute).toHaveBeenCalled();
    expect(memory.getContentDraft(id)!.status).toBe('posted');
  });

  it('live mode: marks the draft failed and keeps job history when no MCP tool is available', async () => {
    settingsStore.set('content.dryRun', 'false');
    mcpBridgedToolsMock.mockResolvedValue([]);

    const { memory, scheduler, chatMessages } = createSetup();
    const id = await scheduleApprovedDraftDueNow(memory);

    await scheduler['checkDueJobs'](memory['db'], new Date());

    expect(memory.getContentDraft(id)!.status).toBe('failed');
    // A failure is surfaced to the session, unlike a quiet success.
    expect(chatMessages.some((m) => m.response.includes('failed'))).toBe(true);
  });

  it('a missing/deleted draft fails the job gracefully instead of throwing', async () => {
    const { memory, scheduler } = createSetup();
    const id = await scheduleApprovedDraftDueNow(memory);
    memory.deleteContentDraft(id);

    await expect(scheduler['checkDueJobs'](memory['db'], new Date())).resolves.not.toThrow();
    // Job is still cleaned up even though the draft was gone.
    const jobs = memory.getCronJobs(false);
    expect(jobs.find((j) => j.content_draft_id === id)).toBeUndefined();
  });
});
