// src/clients/content-import.ts
// Pull-side counterpart to src/clients/content-export.ts: reads
// content-drafts.json and campaigns.json a teammate published and
// reconstructs any rows this install doesn't already have, so after one
// git clone/pull a teammate's drafts and campaigns are visible locally too —
// same "why" as src/clients/analytics-import.ts (queryable OFFLINE, no live
// re-fetch, no server round-trip).
//
// Two different merge disciplines in one file, matching sync.ts's
// append-only-vs-single-owner split (see sync.ts's isAppendOnly/isSingleOwner):
//
//  - The draft/campaign row ITSELF is single-owner-like: on a collision (an
//    existing local row with the same natural key), the LOCAL row always
//    wins untouched — this install's edits (a status transition, a body
//    edit) are never overwritten by a teammate's stale export. Exactly the
//    analytics precedent's "never UPDATE/REPLACE, only INSERT what's
//    missing", applied to a mutable row instead of an append-only snapshot.
//  - A draft's posts / a campaign's deliverables are append-only-like
//    (mirroring lessons.md's line-union merge): even when the OWNING draft/
//    campaign already exists locally and is left untouched, any post/
//    deliverable from the file that isn't already present under that local
//    row (by its own natural key) still gets appended. A teammate's post-log
//    entry or deliverable never gets silently dropped just because the
//    parent row happened to already exist.
//
// Natural dedupe keys (no raw autoincrement PK is ever compared or trusted,
// same reasoning as analytics-import.ts avoiding content_post_id):
//   draft:       channel + title + createdAt      (createdAt is set once at
//                creation and never touched by updateContentDraft, so it's a
//                stable "moment" key exactly like analytics' capturedAt)
//   post:        channel + status + externalRef + createdAt, scoped to its
//                (now-resolved) LOCAL draft id
//   campaign:    name + createdAt
//   deliverable: title + createdAt, scoped to its (now-resolved) LOCAL
//                campaign id
//
// Referential integrity: a deliverable's `dependsOnTitle` (see
// content-export.ts) is resolved to a LOCAL deliverable id by title, scoped
// to the same campaign — built from whatever local deliverables already
// exist for that campaign PLUS whatever this same import batch has inserted
// so far (file order is already a valid topological order: content-export.ts
// reads deliverables via getDeliverablesForCampaign's `ORDER BY id ASC`, and
// addDeliverable only ever lets a deliverable depend on one that already
// existed at creation time, so a dependency always precedes its dependent in
// the export). An unresolvable reference (the named deliverable was never
// exported, or belongs to a different scope) is NOT a crash — the deliverable
// still imports, just with no dependency, and a warning is logged. A
// deliverable's `resultRef` is carried through as opaque text; when it
// encodes `content_draft:<id>`, that id belongs to the EXPORTING install and
// is not translated (see content-export.ts's module doc) — a known,
// documented limitation, not a referential-integrity hazard, since result_ref
// has no DB-level FK.

import fs from 'fs';
import path from 'path';
import { rootDirForScope } from './export';
import type { ContentDraftExportRow, CampaignExportRow } from './content-export';
import type {
  ContentDraft,
  ContentPost,
  ContentDraftStatus,
  ContentPostStatus,
  ImportContentDraftInput,
  RecordContentPostInput,
} from '../memory/content-drafts';
import type {
  Campaign,
  CampaignDeliverable,
  CampaignStatus,
  DeliverableStatus,
  ImportCampaignInput,
  ImportDeliverableInput,
} from '../memory/campaigns';

/** Memory-store surface the importer needs (a subset of MemoryManager). */
export interface ContentImportMemory {
  getContentDraftsForScopes(visibleScopes: string[]): ContentDraft[];
  getContentPostsForDraft(draftId: number): ContentPost[];
  importContentDraft(input: ImportContentDraftInput): number;
  recordContentPost(input: RecordContentPostInput): number;
  getCampaignsForScopes(visibleScopes: string[]): Campaign[];
  getDeliverablesForCampaign(campaignId: number): CampaignDeliverable[];
  importCampaign(input: ImportCampaignInput): number;
  importCampaignDeliverable(input: ImportDeliverableInput): number;
}

const DRAFT_STATUSES: ContentDraftStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'scheduled',
  'posted',
  'failed',
];
const POST_STATUSES: ContentPostStatus[] = ['posted', 'failed', 'dry_run'];
const CAMPAIGN_STATUSES: CampaignStatus[] = ['active', 'paused', 'completed', 'archived'];
const DELIVERABLE_STATUSES: DeliverableStatus[] = [
  'pending',
  'in_progress',
  'review',
  'done',
  'blocked',
];

/** Normalize an untrusted status to the DB's CHECK domain — anything else (hand-edited file, future export format) falls back to a safe default rather than throwing a constraint violation. Mirrors analytics-import.ts's normalizeSource. */
function normalizeStatus<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function draftKey(channel: string, title: string, createdAt: string): string {
  return `${channel}\u0000${title}\u0000${createdAt}`;
}

function postKey(
  channel: string,
  status: string,
  externalRef: string | null,
  createdAt: string
): string {
  return `${channel}\u0000${status}\u0000${externalRef ?? ''}\u0000${createdAt}`;
}

function campaignKey(name: string, createdAt: string): string {
  return `${name}\u0000${createdAt}`;
}

function deliverableKey(title: string, createdAt: string): string {
  return `${title}\u0000${createdAt}`;
}

function isValidDraftRow(row: unknown): row is ContentDraftExportRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.channel === 'string' &&
    r.channel.length > 0 &&
    typeof r.title === 'string' &&
    typeof r.body === 'string' &&
    typeof r.createdAt === 'string' &&
    r.createdAt.length > 0
  );
}

function isValidPostRow(row: unknown): row is ContentDraftExportRow['posts'][number] {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.channel === 'string' &&
    r.channel.length > 0 &&
    typeof r.createdAt === 'string' &&
    r.createdAt.length > 0
  );
}

function isValidCampaignRow(row: unknown): row is CampaignExportRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.name === 'string' &&
    r.name.length > 0 &&
    typeof r.createdAt === 'string' &&
    r.createdAt.length > 0
  );
}

function isValidDeliverableRow(row: unknown): row is CampaignExportRow['deliverables'][number] {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.title === 'string' &&
    r.title.length > 0 &&
    typeof r.createdAt === 'string' &&
    r.createdAt.length > 0
  );
}

/** Read + validate one of the two export files at rootDir. Returns [] when missing, empty, or malformed — never throws. Mirrors analytics-import.ts's readAnalyticsJson. */
function readExportJson<T>(
  rootDir: string,
  filename: string,
  isValid: (row: unknown) => row is T
): T[] {
  const abs = path.join(rootDir, '.atelier', 'memory', filename);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf-8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

export interface ImportContentDraftsResult {
  drafts: number;
  posts: number;
}

/**
 * Import a scope's shared content-drafts.json. A draft whose (channel,
 * title, createdAt) key already exists locally is left completely untouched
 * (single-owner: local status/edits win) — but its posts are still scanned
 * for anything new to append. A draft with no local match is inserted with
 * its full exported state (status, schedule, etc.), then ALL of its exported
 * posts are appended under the new local id. Never overwrites, never
 * crashes on one bad row. A no-op for scopes without a repo or a missing/
 * empty/malformed export file.
 */
export function importContentDraftsFromBrain(
  memory: ContentImportMemory,
  scope: string
): ImportContentDraftsResult {
  const rootDir = rootDirForScope(scope);
  if (!rootDir) return { drafts: 0, posts: 0 };
  const rows = readExportJson(rootDir, 'content-drafts.json', isValidDraftRow);
  if (rows.length === 0) return { drafts: 0, posts: 0 };

  const existingDrafts = memory.getContentDraftsForScopes([scope]);
  const draftIdByKey = new Map<string, number>(
    existingDrafts.map((d) => [draftKey(d.channel, d.title, d.created_at), d.id])
  );

  let draftsInserted = 0;
  let postsInserted = 0;

  for (const row of rows) {
    const key = draftKey(row.channel, row.title, row.createdAt);
    let localDraftId = draftIdByKey.get(key);

    if (localDraftId === undefined) {
      try {
        localDraftId = memory.importContentDraft({
          scope,
          channel: row.channel,
          title: row.title,
          body: row.body,
          status: normalizeStatus(row.status, DRAFT_STATUSES, 'draft'),
          scheduledFor: row.scheduledFor,
          postedAt: row.postedAt,
          externalRef: row.externalRef,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        draftIdByKey.set(key, localDraftId);
        draftsInserted++;
      } catch (e) {
        console.error(`[Content] Skipped one malformed draft (${row.channel}/${row.title}):`, e);
        continue;
      }
    }

    // Append-only sub-merge: import any posts under this draft (new or
    // already-existing) that aren't already present locally, keyed within
    // this one draft's LOCAL id.
    const existingPostKeys = new Set(
      memory
        .getContentPostsForDraft(localDraftId)
        .map((p) => postKey(p.channel, p.status, p.external_ref, p.created_at))
    );
    for (const post of Array.isArray(row.posts) ? row.posts.filter(isValidPostRow) : []) {
      // Compute the dedupe key from the NORMALIZED status, not the raw
      // exported value — otherwise a malformed status (hand-edited file)
      // would compute a DIFFERENT key than what's actually stored (DB rows
      // only ever hold a normalized status), so a re-import could never find
      // its own previously-inserted row and would duplicate it on every pull.
      const normalizedStatus = normalizeStatus(post.status, POST_STATUSES, 'dry_run');
      const pKey = postKey(
        post.channel,
        normalizedStatus,
        post.externalRef ?? null,
        post.createdAt
      );
      if (existingPostKeys.has(pKey)) continue;
      try {
        memory.recordContentPost({
          draftId: localDraftId,
          scope,
          channel: post.channel,
          status: normalizedStatus,
          detail: post.detail ?? null,
          externalRef: post.externalRef ?? null,
          createdAt: post.createdAt,
        });
        existingPostKeys.add(pKey);
        postsInserted++;
      } catch (e) {
        console.error(
          `[Content] Skipped one malformed post (${post.channel}/${post.createdAt}):`,
          e
        );
      }
    }
  }

  return { drafts: draftsInserted, posts: postsInserted };
}

export interface ImportCampaignsResult {
  campaigns: number;
  deliverables: number;
}

/**
 * Import a scope's shared campaigns.json. Same single-owner-row /
 * append-only-children split as importContentDraftsFromBrain: an existing
 * local campaign is never modified, but missing deliverables are still
 * appended under it. `dependsOnTitle` is resolved to a local deliverable id
 * scoped to the same campaign, seeded from whatever already exists locally
 * plus whatever this batch has inserted so far — an unresolvable reference
 * imports the deliverable anyway with no dependency (never a crash).
 */
export function importCampaignsFromBrain(
  memory: ContentImportMemory,
  scope: string
): ImportCampaignsResult {
  const rootDir = rootDirForScope(scope);
  if (!rootDir) return { campaigns: 0, deliverables: 0 };
  const rows = readExportJson(rootDir, 'campaigns.json', isValidCampaignRow);
  if (rows.length === 0) return { campaigns: 0, deliverables: 0 };

  const existingCampaigns = memory.getCampaignsForScopes([scope]);
  const campaignIdByKey = new Map<string, number>(
    existingCampaigns.map((c) => [campaignKey(c.name, c.created_at), c.id])
  );

  let campaignsInserted = 0;
  let deliverablesInserted = 0;

  for (const row of rows) {
    const key = campaignKey(row.name, row.createdAt);
    let localCampaignId = campaignIdByKey.get(key);

    if (localCampaignId === undefined) {
      try {
        localCampaignId = memory.importCampaign({
          scope,
          name: row.name,
          brief: row.brief,
          status: normalizeStatus(row.status, CAMPAIGN_STATUSES, 'active'),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
        campaignIdByKey.set(key, localCampaignId);
        campaignsInserted++;
      } catch (e) {
        console.error(`[Content] Skipped one malformed campaign (${row.name}):`, e);
        continue;
      }
    }

    const existingDeliverables = memory.getDeliverablesForCampaign(localCampaignId);
    const deliverableKeySet = new Set(
      existingDeliverables.map((d) => deliverableKey(d.title, d.created_at))
    );
    // Seed the title->local-id map with whatever already exists locally, so
    // a dependency created in a PRIOR import/pull still resolves.
    const localIdByTitle = new Map<string, number>(
      existingDeliverables.map((d) => [d.title, d.id])
    );

    for (const deliverable of Array.isArray(row.deliverables)
      ? row.deliverables.filter(isValidDeliverableRow)
      : []) {
      const dKey = deliverableKey(deliverable.title, deliverable.createdAt);
      if (deliverableKeySet.has(dKey)) continue;

      let dependsOn: number | null = null;
      if (deliverable.dependsOnTitle) {
        const resolved = localIdByTitle.get(deliverable.dependsOnTitle);
        if (resolved !== undefined) {
          dependsOn = resolved;
        } else {
          console.warn(
            `[Content] Deliverable "${deliverable.title}" depends on "${deliverable.dependsOnTitle}", which wasn't found locally — importing with no dependency.`
          );
        }
      }

      try {
        const newId = memory.importCampaignDeliverable({
          campaignId: localCampaignId,
          lane: deliverable.lane,
          title: deliverable.title,
          description: deliverable.description,
          status: normalizeStatus(deliverable.status, DELIVERABLE_STATUSES, 'pending'),
          assignedSpecialist: deliverable.assignedSpecialist,
          dependsOn,
          resultRef: deliverable.resultRef,
          createdAt: deliverable.createdAt,
          updatedAt: deliverable.updatedAt,
        });
        deliverableKeySet.add(dKey);
        localIdByTitle.set(deliverable.title, newId);
        deliverablesInserted++;
      } catch (e) {
        console.error(`[Content] Skipped one malformed deliverable (${deliverable.title}):`, e);
      }
    }
  }

  return { campaigns: campaignsInserted, deliverables: deliverablesInserted };
}

export interface ImportContentResult extends ImportContentDraftsResult, ImportCampaignsResult {}

/**
 * Import both content drafts/posts and campaigns/deliverables for a scope in
 * one call — the single entry point wired into the same pull/join/auto-pull
 * call sites as importAnalyticsFromBrain. Order between the two is
 * independent (campaigns' `dependsOnTitle` resolution is entirely
 * self-contained per campaign; a deliverable's `resultRef` is never
 * translated against imported drafts, see module doc) — drafts import first
 * purely for readability, matching the task's "content drafts/posts AND
 * campaigns" ordering.
 */
export function importContentFromBrain(
  memory: ContentImportMemory,
  scope: string
): ImportContentResult {
  const draftsResult = importContentDraftsFromBrain(memory, scope);
  const campaignsResult = importCampaignsFromBrain(memory, scope);
  return { ...draftsResult, ...campaignsResult };
}
