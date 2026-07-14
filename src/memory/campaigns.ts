/**
 * Campaign / plan data model (roadmap item 10): a lightweight persisted
 * object so the orchestrating model can manage multi-deliverable work across
 * turns and days, without inventing a new execution engine. The campaign is
 * durable STATE only — actually doing a deliverable's work still goes
 * through the existing subagent tool (src/tools/subagent.ts); this module
 * just tracks what's planned, what's blocked on what, and what's done.
 *
 * Two tables:
 *  - `campaigns` — one row per plan, scoped like facts/content_drafts
 *    (`scope` = 'user' | 'world' | 'client:<id>' | 'project:<key>').
 *  - `campaign_deliverables` — one row per unit of work inside a campaign,
 *    with an optional `depends_on` pointing at another deliverable in the
 *    SAME campaign. Dependency enforcement (`canStartDeliverable`) is pure
 *    and unit-testable: a deliverable can't move to 'in_progress' while its
 *    dependency isn't 'done'.
 *
 * `result_ref` is free text by convention: when a deliverable's output is a
 * content-workflow draft (roadmap item 6), the natural link is
 * `content_draft:<id>` — see linkDeliverableToContentDraft — so the campaign
 * board can cross-reference into the Content queue panel without a schema-
 * level foreign key (a deliverable's result isn't always a draft; sometimes
 * it's just a summary of work done directly).
 */

import type Database from 'better-sqlite3';

export type CampaignStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Campaign {
  id: number;
  scope: string;
  name: string;
  brief: string;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

export type DeliverableStatus = 'pending' | 'in_progress' | 'review' | 'done' | 'blocked';

export interface CampaignDeliverable {
  id: number;
  campaign_id: number;
  lane: string | null;
  title: string;
  description: string;
  status: DeliverableStatus;
  assigned_specialist: string | null;
  depends_on: number | null;
  result_ref: string | null;
  created_at: string;
  updated_at: string;
}

// ============ Deliverable status transitions ============

/**
 * Allowed status transitions. Forgiving on undo edges (review->in_progress
 * for revision requests, blocked->pending to re-queue, done->review to
 * reopen) so a human/agent isn't stuck when priorities change — same
 * philosophy as content-drafts.ts's TRANSITIONS table.
 */
const TRANSITIONS: Record<DeliverableStatus, DeliverableStatus[]> = {
  pending: ['in_progress', 'blocked'],
  in_progress: ['review', 'done', 'blocked', 'pending'],
  review: ['done', 'in_progress', 'blocked'],
  done: ['review'],
  blocked: ['pending', 'in_progress'],
};

export interface TransitionCheck {
  ok: boolean;
  error?: string;
}

/**
 * Pure transition check — no DB access. Does NOT enforce the depends_on
 * dependency gate (that needs to look up the dependency's row, so it lives
 * in `canStartDeliverable` below); this only checks the status graph itself.
 */
export function canTransitionDeliverable(
  from: DeliverableStatus,
  to: DeliverableStatus
): TransitionCheck {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return { ok: false, error: `Cannot transition deliverable from "${from}" to "${to}".` };
  }
  return { ok: true };
}

/** Minimal shape canStartDeliverable needs from a dependency row — decoupled from the full CampaignDeliverable type for easy unit testing. */
export interface DependencyLike {
  id: number;
  status: DeliverableStatus;
}

/**
 * Dependency enforcement (roadmap item 10, requirement 2): a deliverable can
 * only move to 'in_progress' when its `depends_on` target (if any) is
 * 'done'. No dependency at all always passes. Pure function — the DB-layer
 * `setDeliverableStatus` below calls this after resolving the dependency row,
 * so the rule is unit-testable without touching SQLite.
 */
export function canStartDeliverable(dependency: DependencyLike | null): TransitionCheck {
  if (!dependency) return { ok: true };
  if (dependency.status !== 'done') {
    return {
      ok: false,
      error: `Cannot start — this deliverable depends on #${dependency.id}, which is still "${dependency.status}" (needs to be "done").`,
    };
  }
  return { ok: true };
}

// ============ Campaign CRUD ============

export interface CreateCampaignInput {
  scope: string;
  name: string;
  brief?: string;
}

export function createCampaign(db: Database.Database, input: CreateCampaignInput): number {
  const stmt = db.prepare(`
    INSERT INTO campaigns (scope, name, brief, status)
    VALUES (?, ?, ?, 'active')
  `);
  const result = stmt.run(input.scope, input.name, input.brief ?? '');
  return result.lastInsertRowid as number;
}

export function getCampaign(db: Database.Database, id: number): Campaign | null {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Campaign | undefined;
  return row ?? null;
}

/**
 * List campaigns visible to the given scopes (nearest-first chain from
 * resolveVisibleScopes), optionally filtered to one status. Same isolation
 * contract as content-drafts.ts's getContentDraftsForScopes — an empty scope
 * list returns [] rather than falling through to an unfiltered dump.
 */
export function getCampaignsForScopes(
  db: Database.Database,
  visibleScopes: string[],
  status?: CampaignStatus
): Campaign[] {
  if (visibleScopes.length === 0) return [];
  const scopeClause = visibleScopes.map(() => '?').join(', ');
  const statusClause = status ? 'AND status = ?' : '';
  const params = status ? [...visibleScopes, status] : visibleScopes;
  return db
    .prepare(
      `SELECT * FROM campaigns WHERE scope IN (${scopeClause}) ${statusClause} ORDER BY updated_at DESC`
    )
    .all(...params) as Campaign[];
}

export interface UpdateCampaignFields {
  name?: string;
  brief?: string;
  status?: CampaignStatus;
}

export function updateCampaign(
  db: Database.Database,
  id: number,
  fields: UpdateCampaignFields
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.brief !== undefined) {
    sets.push('brief = ?');
    values.push(fields.brief);
  }
  if (fields.status !== undefined) {
    sets.push('status = ?');
    values.push(fields.status);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  const result = db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteCampaign(db: Database.Database, id: number): boolean {
  // Deliverables carry a NOT NULL FK to their campaign — clear them first so
  // the campaign row can always be deleted regardless of FK enforcement mode.
  db.prepare('DELETE FROM campaign_deliverables WHERE campaign_id = ?').run(id);
  const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============ Deliverable CRUD ============

export interface AddDeliverableInput {
  campaignId: number;
  lane?: string | null;
  title: string;
  description?: string;
  assignedSpecialist?: string | null;
  dependsOn?: number | null;
}

export interface AddDeliverableResult {
  ok: boolean;
  id?: number;
  error?: string;
}

/**
 * Add a deliverable to a campaign. Validates `dependsOn` (if given) actually
 * belongs to the SAME campaign — a cross-campaign dependency would make
 * `canStartDeliverable`'s lookup meaningless and let one brand's plan block
 * on another's internal state.
 */
export function addDeliverable(
  db: Database.Database,
  input: AddDeliverableInput
): AddDeliverableResult {
  const campaign = getCampaign(db, input.campaignId);
  if (!campaign) return { ok: false, error: `Campaign #${input.campaignId} not found.` };

  if (input.dependsOn !== undefined && input.dependsOn !== null) {
    const dep = getDeliverable(db, input.dependsOn);
    if (!dep) return { ok: false, error: `Dependency deliverable #${input.dependsOn} not found.` };
    if (dep.campaign_id !== input.campaignId) {
      return {
        ok: false,
        error: `Dependency deliverable #${input.dependsOn} belongs to a different campaign.`,
      };
    }
  }

  const stmt = db.prepare(`
    INSERT INTO campaign_deliverables
      (campaign_id, lane, title, description, status, assigned_specialist, depends_on)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `);
  const result = stmt.run(
    input.campaignId,
    input.lane ?? null,
    input.title,
    input.description ?? '',
    input.assignedSpecialist ?? null,
    input.dependsOn ?? null
  );
  // Touch the parent campaign's updated_at so "recently active" ordering reflects new work.
  db.prepare("UPDATE campaigns SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?").run(
    input.campaignId
  );
  return { ok: true, id: result.lastInsertRowid as number };
}

export function getDeliverable(db: Database.Database, id: number): CampaignDeliverable | null {
  const row = db.prepare('SELECT * FROM campaign_deliverables WHERE id = ?').get(id) as
    | CampaignDeliverable
    | undefined;
  return row ?? null;
}

export function getDeliverablesForCampaign(
  db: Database.Database,
  campaignId: number
): CampaignDeliverable[] {
  return db
    .prepare('SELECT * FROM campaign_deliverables WHERE campaign_id = ? ORDER BY id ASC')
    .all(campaignId) as CampaignDeliverable[];
}

export interface SetDeliverableStatusResult {
  ok: boolean;
  error?: string;
}

/**
 * Transition a deliverable's status, enforcing BOTH the status-graph check
 * (canTransitionDeliverable) and, when the target is 'in_progress', the
 * dependency gate (canStartDeliverable) — this is the single DB-layer
 * enforcement point every caller (the update_deliverable_status agent tool,
 * any future UI action) goes through, so a transition-table bug in one
 * caller can't bypass the dependency rule.
 */
export function setDeliverableStatus(
  db: Database.Database,
  id: number,
  to: DeliverableStatus,
  resultRef?: string | null
): SetDeliverableStatusResult {
  const deliverable = getDeliverable(db, id);
  if (!deliverable) return { ok: false, error: `Deliverable #${id} not found.` };

  const statusCheck = canTransitionDeliverable(deliverable.status, to);
  if (!statusCheck.ok) return { ok: false, error: statusCheck.error };

  if (to === 'in_progress' && deliverable.depends_on !== null) {
    const dep = getDeliverable(db, deliverable.depends_on);
    const depCheck = canStartDeliverable(dep ? { id: dep.id, status: dep.status } : null);
    if (!depCheck.ok) return { ok: false, error: depCheck.error };
  }

  const sets: string[] = ['status = ?'];
  const values: unknown[] = [to];
  if (resultRef !== undefined) {
    sets.push('result_ref = ?');
    values.push(resultRef);
  }
  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  db.prepare(`UPDATE campaign_deliverables SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  // Touch the parent campaign too, so "recently active" ordering reflects deliverable churn.
  db.prepare("UPDATE campaigns SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?").run(
    deliverable.campaign_id
  );
  return { ok: true };
}

/**
 * Link a deliverable's result to a content-workflow draft (roadmap item 10,
 * requirement 3) — sets result_ref to the `content_draft:<id>` convention so
 * the campaign board can cross-reference into the Content queue panel.
 * Thin wrapper over setDeliverableStatus's resultRef param so callers don't
 * need to know the string format.
 */
export function linkDeliverableToContentDraft(
  db: Database.Database,
  deliverableId: number,
  contentDraftId: number
): SetDeliverableStatusResult {
  const deliverable = getDeliverable(db, deliverableId);
  if (!deliverable) return { ok: false, error: `Deliverable #${deliverableId} not found.` };
  db.prepare(
    "UPDATE campaign_deliverables SET result_ref = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?"
  ).run(`content_draft:${contentDraftId}`, deliverableId);
  return { ok: true };
}

/**
 * Extract the linked content_draft id from a deliverable's result_ref, if it
 * follows the 'content_draft:<id>' convention (see
 * linkDeliverableToContentDraft above and campaign-panel.js's client-side
 * regex, which this mirrors). Pure — the campaign -> content -> analytics
 * join (src/memory/index.ts's getCampaignAnalytics) uses this to resolve
 * which content drafts a campaign's deliverables actually reference. Returns
 * null for any other result_ref shape (a plain summary string, or none).
 */
export function contentDraftIdFromResultRef(resultRef: string | null | undefined): number | null {
  if (!resultRef) return null;
  const m = /^content_draft:(\d+)$/.exec(resultRef);
  return m ? parseInt(m[1], 10) : null;
}

export function deleteDeliverable(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM campaign_deliverables WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * The next unblocked, not-yet-started deliverable in a campaign — 'pending'
 * status with either no dependency or a dependency that's already 'done'.
 * Used by the "nudge" UI action and the optional cron hook (roadmap item
 * 10.5) to compose "advance campaign X" prompts without the caller needing
 * to re-derive the dependency logic.
 */
export function getNextUnblockedDeliverable(
  db: Database.Database,
  campaignId: number
): CampaignDeliverable | null {
  const deliverables = getDeliverablesForCampaign(db, campaignId);
  const byId = new Map(deliverables.map((d) => [d.id, d]));
  for (const d of deliverables) {
    if (d.status !== 'pending') continue;
    if (d.depends_on === null) return d;
    const dep = byId.get(d.depends_on);
    if (dep && dep.status === 'done') return d;
  }
  return null;
}
