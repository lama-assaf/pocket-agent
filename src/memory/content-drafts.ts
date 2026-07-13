/**
 * Content workflow data model (roadmap item 6): per-brand drafts that move
 * through a human-gated approval pipeline before anything gets posted.
 *
 * Two tables:
 *  - `content_drafts` — one row per piece of content, scoped like facts
 *    (`scope` = 'user' | 'world' | 'client:<id>' | 'project:<key>'). The
 *    row IS the current state (status, scheduling info) — cheap to query for
 *    the queue view.
 *  - `content_posts` — an append-only audit log of every post attempt
 *    (dry-run or real) against a draft, so "Show post history" has a real
 *    trail independent of the draft's current status. Chosen as a separate
 *    table (not just overloading content_drafts.status) because a draft can
 *    be posted, retried after a failure, or dry-run multiple times — each
 *    attempt is a distinct fact worth keeping, not a value to overwrite.
 *
 * State machine (see `canTransition`): approval (draft->pending_approval
 * is agent-callable; pending_approval->approved/rejected is human-only,
 * enforced here via the `actor` parameter — not just by which IPC/tool
 * happens to call in). The post/schedule tool layer (src/tools/content-tools.ts)
 * additionally hard-requires status === 'approved' before acting, so even a
 * transition-table bug can't let an unapproved draft get posted.
 */

import type Database from 'better-sqlite3';

export type ContentDraftStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'posted'
  | 'failed';

export interface ContentDraft {
  id: number;
  scope: string;
  session_id: string | null;
  channel: string;
  title: string;
  body: string;
  status: ContentDraftStatus;
  scheduled_for: string | null;
  posted_at: string | null;
  external_ref: string | null;
  cron_job_id: number | null;
  created_at: string;
  updated_at: string;
}

export type ContentPostStatus = 'posted' | 'failed' | 'dry_run';

export interface ContentPost {
  id: number;
  draft_id: number;
  scope: string;
  channel: string;
  status: ContentPostStatus;
  detail: string | null;
  external_ref: string | null;
  created_at: string;
}

/** Who is requesting a status transition — gates approve/reject to humans only. */
export type TransitionActor = 'agent' | 'human';

/**
 * Allowed status transitions, independent of actor. Kept intentionally
 * forgiving on the "undo"/"cancel" edges (rejected->draft, scheduled/approved
 * ->draft or ->rejected, failed->draft/approved) so a human isn't stuck when
 * something goes wrong, while the forward edges match the pipeline in the
 * roadmap item. 'approved'/'scheduled' can both reach 'rejected' directly —
 * a human canceling an approved-but-not-yet-scheduled item, or canceling one
 * that's already scheduled, is a single click, not a multi-step rewind.
 */
const TRANSITIONS: Record<ContentDraftStatus, ContentDraftStatus[]> = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected', 'draft'],
  approved: ['scheduled', 'posted', 'failed', 'draft', 'rejected'],
  rejected: ['draft'],
  scheduled: ['posted', 'failed', 'approved', 'draft', 'rejected'],
  posted: [],
  failed: ['draft', 'approved'],
};

/** Statuses only a human (never an agent tool) may transition INTO. */
const HUMAN_ONLY_TARGETS = new Set<ContentDraftStatus>(['approved', 'rejected']);

export interface TransitionCheck {
  ok: boolean;
  error?: string;
}

/**
 * Pure transition check — no DB access, so it's trivially unit-testable.
 * Approval/rejection (entering 'approved' or 'rejected') is rejected outright
 * for actor 'agent': this is the load-bearing rule that makes "approval is
 * human-only" a server-enforced guarantee, not just a UI convention.
 */
export function canTransition(
  from: ContentDraftStatus,
  to: ContentDraftStatus,
  actor: TransitionActor
): TransitionCheck {
  if (actor === 'agent' && HUMAN_ONLY_TARGETS.has(to)) {
    return { ok: false, error: `Only a human can set status "${to}" — this requires the approve/reject IPC action, not an agent tool.` };
  }
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return { ok: false, error: `Cannot transition content draft from "${from}" to "${to}".` };
  }
  return { ok: true };
}

// ============ CRUD ============

export interface CreateContentDraftInput {
  scope: string;
  sessionId?: string | null;
  channel: string;
  title?: string;
  body: string;
}

export function createContentDraft(db: Database.Database, input: CreateContentDraftInput): number {
  const stmt = db.prepare(`
    INSERT INTO content_drafts (scope, session_id, channel, title, body, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `);
  const result = stmt.run(
    input.scope,
    input.sessionId ?? null,
    input.channel,
    input.title ?? '',
    input.body
  );
  return result.lastInsertRowid as number;
}

export function getContentDraft(db: Database.Database, id: number): ContentDraft | null {
  const row = db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as
    | ContentDraft
    | undefined;
  return row ?? null;
}

/**
 * List drafts visible to the given scopes (nearest-first chain from
 * resolveVisibleScopes), optionally filtered to one status. Mirrors
 * facts.ts's scoped-query shape — an empty scope list returns [] rather
 * than falling through to an unfiltered dump (same isolation guarantee).
 */
export function getContentDraftsForScopes(
  db: Database.Database,
  visibleScopes: string[],
  status?: ContentDraftStatus
): ContentDraft[] {
  if (visibleScopes.length === 0) return [];
  const scopeClause = visibleScopes.map(() => '?').join(', ');
  const statusClause = status ? 'AND status = ?' : '';
  const params = status ? [...visibleScopes, status] : visibleScopes;
  return db
    .prepare(
      `SELECT * FROM content_drafts WHERE scope IN (${scopeClause}) ${statusClause} ORDER BY updated_at DESC`
    )
    .all(...params) as ContentDraft[];
}

export interface UpdateContentDraftFields {
  channel?: string;
  title?: string;
  body?: string;
}

/**
 * Edit a draft's content fields. Only permitted while status is 'draft' or
 * 'rejected' (editing a pending/approved/scheduled/posted item would silently
 * change what a human already reviewed or what's already live) — editing a
 * rejected draft resets it to 'draft' so it re-enters the pipeline from the
 * top. Returns an error string on a disallowed edit, null on success.
 */
export function updateContentDraft(
  db: Database.Database,
  id: number,
  fields: UpdateContentDraftFields
): { ok: boolean; error?: string } {
  const draft = getContentDraft(db, id);
  if (!draft) return { ok: false, error: `Draft #${id} not found.` };
  if (draft.status !== 'draft' && draft.status !== 'rejected') {
    return {
      ok: false,
      error: `Cannot edit a draft with status "${draft.status}" — only "draft" or "rejected" drafts can be edited.`,
    };
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.channel !== undefined) {
    sets.push('channel = ?');
    values.push(fields.channel);
  }
  if (fields.title !== undefined) {
    sets.push('title = ?');
    values.push(fields.title);
  }
  if (fields.body !== undefined) {
    sets.push('body = ?');
    values.push(fields.body);
  }
  // Editing a rejected draft re-enters the pipeline at 'draft'.
  if (draft.status === 'rejected') {
    sets.push('status = ?');
    values.push('draft' satisfies ContentDraftStatus);
  }
  if (sets.length === 0) return { ok: true };

  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  db.prepare(`UPDATE content_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return { ok: true };
}

export interface SetStatusOptions {
  scheduledFor?: string | null;
  cronJobId?: number | null;
  postedAt?: string | null;
  externalRef?: string | null;
}

/**
 * Transition a draft's status, enforcing `canTransition` (including the
 * human-only gate on approved/rejected). Returns an error string on a
 * disallowed transition or a missing draft; never partially applies.
 */
export function setContentDraftStatus(
  db: Database.Database,
  id: number,
  to: ContentDraftStatus,
  actor: TransitionActor,
  options: SetStatusOptions = {}
): { ok: boolean; error?: string } {
  const draft = getContentDraft(db, id);
  if (!draft) return { ok: false, error: `Draft #${id} not found.` };

  const check = canTransition(draft.status, to, actor);
  if (!check.ok) return { ok: false, error: check.error };

  const sets: string[] = ['status = ?'];
  const values: unknown[] = [to];
  if (options.scheduledFor !== undefined) {
    sets.push('scheduled_for = ?');
    values.push(options.scheduledFor);
  }
  if (options.cronJobId !== undefined) {
    sets.push('cron_job_id = ?');
    values.push(options.cronJobId);
  }
  if (options.postedAt !== undefined) {
    sets.push('posted_at = ?');
    values.push(options.postedAt);
  }
  if (options.externalRef !== undefined) {
    sets.push('external_ref = ?');
    values.push(options.externalRef);
  }
  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  db.prepare(`UPDATE content_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return { ok: true };
}

export function deleteContentDraft(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM content_drafts WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============ Post log (audit trail) ============

export interface RecordContentPostInput {
  draftId: number;
  scope: string;
  channel: string;
  status: ContentPostStatus;
  detail?: string | null;
  externalRef?: string | null;
}

export function recordContentPost(db: Database.Database, input: RecordContentPostInput): number {
  const stmt = db.prepare(`
    INSERT INTO content_posts (draft_id, scope, channel, status, detail, external_ref)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.draftId,
    input.scope,
    input.channel,
    input.status,
    input.detail ?? null,
    input.externalRef ?? null
  );
  return result.lastInsertRowid as number;
}

export function getContentPostsForDraft(db: Database.Database, draftId: number): ContentPost[] {
  return db
    .prepare('SELECT * FROM content_posts WHERE draft_id = ? ORDER BY created_at DESC')
    .all(draftId) as ContentPost[];
}

/** Post history visible to the given scopes — same isolation contract as getContentDraftsForScopes. */
export function getContentPostsForScopes(
  db: Database.Database,
  visibleScopes: string[],
  limit: number = 100
): ContentPost[] {
  if (visibleScopes.length === 0) return [];
  const scopeClause = visibleScopes.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT * FROM content_posts WHERE scope IN (${scopeClause}) ORDER BY created_at DESC LIMIT ?`
    )
    .all(...visibleScopes, limit) as ContentPost[];
}
