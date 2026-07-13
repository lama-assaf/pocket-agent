/**
 * Content workflow agent tools (roadmap item 6): save_draft and
 * submit_for_approval are model-callable. Approval/rejection is deliberately
 * NOT a tool here — it's human-only, enforced server-side by
 * src/memory/content-drafts.ts's canTransition (actor 'agent' can never
 * target 'approved'/'rejected') and exposed only via the approve/reject IPC
 * handlers in src/main/ipc/content-ipc.ts + the queue panel UI.
 *
 * post_content_draft and schedule_content_draft are model-callable but
 * hard-gated to `status === 'approved'` — see postApprovedDraft below, which
 * is also the function the scheduler (src/scheduler/index.ts) calls when a
 * scheduled job fires, so both paths share one enforcement point.
 */

import { getMemoryManager, nearestScopeForCurrentSession } from './memory-tools';
import { getCurrentSessionId } from './session-context';
import { SettingsManager } from '../settings';
import { getMcpBridgedTools } from '../agent/mcp-bridge';
import type { SessionContext } from '../memory/sessions';
import type { ContentDraft } from '../memory/index';
import type { MemoryManager } from '../memory/index';

// ============ save_draft ============

export function getSaveDraftToolDefinition() {
  return {
    name: 'save_draft',
    description:
      'Save a new content draft (post/article copy) for the active brand. Drafts start in "draft" status — call submit_for_approval when ready for a human to review. Never post or schedule directly; that requires human approval first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string',
          description: 'Target platform/channel, e.g. "twitter", "linkedin", "buffer", "blog"',
        },
        title: { type: 'string', description: 'Optional short title/label for the draft' },
        body: { type: 'string', description: 'The full content body/copy' },
      },
      required: ['channel', 'body'],
    },
  };
}

export async function handleSaveDraftTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { channel, title, body } = input as { channel: string; title?: string; body: string };
  if (!channel || !body) {
    return JSON.stringify({ error: 'Missing required fields: channel, body' });
  }

  const scope = nearestScopeForCurrentSession(memory);
  const sessionId = getCurrentSessionId();
  const id = memory.createContentDraft({ scope, sessionId, channel, title, body });
  console.log(`[Content] Saved draft #${id} [${channel}] @ ${scope}`);

  return JSON.stringify({ success: true, id, status: 'draft', scope, channel });
}

// ============ submit_for_approval ============

export function getSubmitForApprovalToolDefinition() {
  return {
    name: 'submit_for_approval',
    description:
      'Move a draft to "pending_approval" so a human can review it in the content queue. Only drafts in "draft" status can be submitted. Approval/rejection itself is human-only — you cannot approve your own drafts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        draft_id: { type: 'number', description: 'The draft ID to submit' },
      },
      required: ['draft_id'],
    },
  };
}

export async function handleSubmitForApprovalTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { draft_id } = input as { draft_id: number };
  if (!draft_id) return JSON.stringify({ error: 'Missing required field: draft_id' });

  const result = memory.setContentDraftStatus(draft_id, 'pending_approval', 'agent');
  if (!result.ok) return JSON.stringify({ error: result.error });

  return JSON.stringify({ success: true, id: draft_id, status: 'pending_approval' });
}

// ============ Shared post/schedule enforcement ============

export interface PostAttemptResult {
  ok: boolean;
  status: 'posted' | 'failed';
  dryRun: boolean;
  detail: string;
  externalRef: string | null;
  error?: string;
}

/** Tool-name heuristic for a bridged MCP tool that plausibly posts/publishes content. */
const POSTING_TOOL_NAME_RE = /post|publish|create.*draft|send.*post|schedule.*post/i;

/**
 * Find a bridged MCP tool that looks like a posting action for this draft's
 * channel. Best-effort heuristic (real MCP posting tools have wildly
 * different schemas — see src/mcp/client.ts's Typefully/Buffer verification
 * notes) — prefers a tool whose namespaced name (`mcp_<entryId>_<toolName>`)
 * contains the channel string, falling back to any posting-shaped tool name.
 */
async function findMcpPostingTool(
  sessionContext: SessionContext | undefined,
  sessionId: string,
  channel: string
) {
  const tools = await getMcpBridgedTools(sessionContext, sessionId);
  const channelNorm = channel.toLowerCase().replace(/[^a-z0-9]/g, '');
  const channelMatch = tools.find(
    (t) => t.name.toLowerCase().includes(channelNorm) && POSTING_TOOL_NAME_RE.test(t.name)
  );
  if (channelMatch) return channelMatch;
  return tools.find((t) => POSTING_TOOL_NAME_RE.test(t.name)) ?? null;
}

/**
 * Attempt to post an approved (or scheduled-and-still-approved) draft. This
 * is the SOLE enforcement point for "only approved drafts can be posted" —
 * both the post_content_draft tool and the scheduler's due-job handler call
 * this, so there is exactly one place that gates on status.
 *
 * Accepts status 'approved' OR 'scheduled': scheduling a draft
 * (schedule_content_draft / scheduleApprovedDraft) moves it to 'scheduled'
 * by design — that IS the durable "still approved, now queued" state the
 * roadmap's "job fires -> checks draft still approved" re-check reads. A
 * human canceling it before the job fires moves it to 'rejected'/'draft'
 * directly (see the TRANSITIONS table in content-drafts.ts), which this
 * still correctly refuses.
 *
 * Dry-run (default ON, `content.dryRun` setting): never calls a real MCP
 * tool. Records a `dry_run` post-log entry describing what would have been
 * sent and marks the draft 'posted' (the workflow completes symbolically —
 * there is no separate "dry-run" status in the roadmap's status enum).
 *
 * Live mode: looks for a bridged MCP posting tool matching the draft's
 * channel (see findMcpPostingTool). No match -> 'failed'. A match is called
 * with a best-effort generic payload; the MCP tool's own text response
 * becomes the post-log detail. A response starting with "Error:" (the shape
 * mcp-bridge.ts's buildAgentToolForMcpTool returns on an MCP-level error) is
 * treated as a failure.
 */
export async function postApprovedDraft(
  memory: MemoryManager,
  draft: ContentDraft,
  sessionContext: SessionContext | undefined,
  sessionId: string
): Promise<PostAttemptResult> {
  if (draft.status !== 'approved' && draft.status !== 'scheduled') {
    return {
      ok: false,
      status: 'failed',
      dryRun: false,
      detail: '',
      externalRef: null,
      error: `Draft #${draft.id} is not approved (status: "${draft.status}") — refusing to post.`,
    };
  }

  const dryRun = SettingsManager.get('content.dryRun') !== 'false'; // default ON

  if (dryRun) {
    const detail = `DRY RUN: would post to "${draft.channel}" — title="${draft.title}" body="${draft.body.slice(0, 200)}${draft.body.length > 200 ? '…' : ''}"`;
    memory.recordContentPost({
      draftId: draft.id,
      scope: draft.scope,
      channel: draft.channel,
      status: 'dry_run',
      detail,
    });
    memory.setContentDraftStatus(draft.id, 'posted', 'agent', { postedAt: new Date().toISOString() });
    return { ok: true, status: 'posted', dryRun: true, detail, externalRef: null };
  }

  const postingTool = await findMcpPostingTool(sessionContext, sessionId, draft.channel);
  if (!postingTool) {
    const detail = `No bridged MCP posting tool found for channel "${draft.channel}". Enable and configure a matching marketplace MCP server for this workspace, or check content.dryRun.`;
    memory.recordContentPost({
      draftId: draft.id,
      scope: draft.scope,
      channel: draft.channel,
      status: 'failed',
      detail,
    });
    memory.setContentDraftStatus(draft.id, 'failed', 'agent');
    return { ok: false, status: 'failed', dryRun: false, detail, externalRef: null, error: detail };
  }

  try {
    const result = await postingTool.execute(
      { text: draft.body, content: draft.body, body: draft.body, title: draft.title, message: draft.body },
      { signal: new AbortController().signal, toolCallId: `content-post-${draft.id}` }
    );
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    const failed = text.startsWith('Error:');
    memory.recordContentPost({
      draftId: draft.id,
      scope: draft.scope,
      channel: draft.channel,
      status: failed ? 'failed' : 'posted',
      detail: text.slice(0, 2000),
    });
    memory.setContentDraftStatus(
      draft.id,
      failed ? 'failed' : 'posted',
      'agent',
      failed ? {} : { postedAt: new Date().toISOString() }
    );
    return {
      ok: !failed,
      status: failed ? 'failed' : 'posted',
      dryRun: false,
      detail: text,
      externalRef: null,
      error: failed ? text : undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    memory.recordContentPost({
      draftId: draft.id,
      scope: draft.scope,
      channel: draft.channel,
      status: 'failed',
      detail: message,
    });
    memory.setContentDraftStatus(draft.id, 'failed', 'agent');
    return { ok: false, status: 'failed', dryRun: false, detail: message, externalRef: null, error: message };
  }
}

// ============ post_content_draft (immediate post) ============

export function getPostContentDraftToolDefinition() {
  return {
    name: 'post_content_draft',
    description:
      'Post an APPROVED draft now, routed through a connected MCP posting tool when available. Refuses any draft not in "approved" status. Honors dry-run mode (content.dryRun setting) — while on, this only logs what would be sent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        draft_id: { type: 'number', description: 'The draft ID to post (must be approved)' },
      },
      required: ['draft_id'],
    },
  };
}

export async function handlePostContentDraftTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { draft_id } = input as { draft_id: number };
  if (!draft_id) return JSON.stringify({ error: 'Missing required field: draft_id' });

  const draft = memory.getContentDraft(draft_id);
  if (!draft) return JSON.stringify({ error: `Draft #${draft_id} not found.` });

  const sessionId = getCurrentSessionId();
  let sessionContext: SessionContext | undefined;
  try {
    sessionContext = memory.getSessionContext(sessionId);
  } catch {
    sessionContext = undefined;
  }

  const result = await postApprovedDraft(memory, draft, sessionContext, sessionId);
  return JSON.stringify({
    success: result.ok,
    status: result.status,
    dryRun: result.dryRun,
    detail: result.detail,
    error: result.error,
  });
}

// ============ schedule_content_draft ============

export function getScheduleContentDraftToolDefinition() {
  return {
    name: 'schedule_content_draft',
    description:
      'Schedule an APPROVED draft to post at a future time via the cron scheduler. Refuses any draft not in "approved" status. When the schedule fires, the draft is re-checked and only posted if it is still approved.',
    input_schema: {
      type: 'object' as const,
      properties: {
        draft_id: { type: 'number', description: 'The draft ID to schedule (must be approved)' },
        scheduled_for: {
          type: 'string',
          description: 'ISO-8601 datetime to post at, e.g. "2026-07-15T09:00:00Z"',
        },
      },
      required: ['draft_id', 'scheduled_for'],
    },
  };
}

export interface ScheduleAttemptResult {
  ok: boolean;
  error?: string;
  scheduledFor?: string;
  cronJobId?: number;
}

/**
 * Schedule an approved draft to post at `scheduledForIso` via a one-time
 * cron job. Shared by both the schedule_content_draft agent tool and the
 * content queue UI's "Schedule" action (src/main/ipc/content-ipc.ts), so
 * there's exactly one place that creates the cron job / flips the draft to
 * 'scheduled'.
 */
export function scheduleApprovedDraft(
  memory: MemoryManager,
  draft: ContentDraft,
  scheduledForIso: string,
  actor: 'agent' | 'human',
  sessionIdHint?: string
): ScheduleAttemptResult {
  if (draft.status !== 'approved') {
    return { ok: false, error: `Draft #${draft.id} is not approved (status: "${draft.status}") — cannot schedule.` };
  }

  const runAt = new Date(scheduledForIso);
  if (Number.isNaN(runAt.getTime())) {
    return { ok: false, error: `Invalid scheduled_for datetime: "${scheduledForIso}"` };
  }

  const sessionId = draft.session_id ?? sessionIdHint ?? 'default';
  const jobName = `content-post-${draft.id}-${Date.now()}`;
  const cronJobId = memory.saveCronJob(
    jobName,
    scheduledForIso,
    `[content-post] draft #${draft.id}`,
    'desktop',
    sessionId
  );

  // saveCronJob only writes the base columns — fill in the extended fields
  // (schedule_type/run_at/job_type/content_draft_id/next_run_at) via the
  // dedicated helper, same "extended cron fields need direct access" pattern
  // scheduler-tools.ts documents for create_routine/create_reminder.
  memory.setCronJobForContentPost(cronJobId, runAt.toISOString(), draft.id);

  const result = memory.setContentDraftStatus(draft.id, 'scheduled', actor, {
    scheduledFor: runAt.toISOString(),
    cronJobId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, scheduledFor: runAt.toISOString(), cronJobId };
}

export async function handleScheduleContentDraftTool(input: unknown): Promise<string> {
  const memory = getMemoryManager();
  if (!memory) return JSON.stringify({ error: 'Memory not initialized' });

  const { draft_id, scheduled_for } = input as { draft_id: number; scheduled_for: string };
  if (!draft_id || !scheduled_for) {
    return JSON.stringify({ error: 'Missing required fields: draft_id, scheduled_for' });
  }

  const draft = memory.getContentDraft(draft_id);
  if (!draft) return JSON.stringify({ error: `Draft #${draft_id} not found.` });

  const result = scheduleApprovedDraft(memory, draft, scheduled_for, 'agent', getCurrentSessionId());
  if (!result.ok) return JSON.stringify({ error: result.error });

  return JSON.stringify({
    success: true,
    id: draft.id,
    status: 'scheduled',
    scheduled_for: result.scheduledFor,
    cron_job_id: result.cronJobId,
  });
}

// ============ Aggregate ============

export function getContentTools() {
  return [
    { ...getSaveDraftToolDefinition(), handler: handleSaveDraftTool },
    { ...getSubmitForApprovalToolDefinition(), handler: handleSubmitForApprovalTool },
    { ...getPostContentDraftToolDefinition(), handler: handlePostContentDraftTool },
    { ...getScheduleContentDraftToolDefinition(), handler: handleScheduleContentDraftTool },
  ];
}
