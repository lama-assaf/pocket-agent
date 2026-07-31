// src/clients/content-export.ts
// Publish loop for content drafts/posts and campaigns/deliverables — same
// shape as src/clients/analytics-export.ts: writes a scope's own rows out to
// its on-disk brain as BOTH a human-readable, git-diffable .md summary and a
// lossless, machine-readable .json (the pull-side counterpart,
// src/clients/content-import.ts, reconstructs rows from the .json). So a
// teammate pulling the client repo sees drafts/campaigns another operator
// created, not just voice/lessons/analytics.
//
// Two independent trees, not four flat files: content_posts nest under their
// owning draft, and campaign_deliverables nest under their owning campaign —
// each is a hard local-DB foreign key (content_posts.draft_id,
// campaign_deliverables.campaign_id) that only means something paired with
// its parent, so the export mirrors that ownership instead of forcing a
// separate join key. `id` / `draft_id` / `campaign_id` (all local
// autoincrement PKs/FKs) are never in the JSON — same reasoning as
// analytics-export.ts excluding `content_post_id`: they're this install's own
// row numbers and aren't portable. `session_id` / `cron_job_id` on a draft
// are excluded for the same reason (local FKs to a session / scheduled cron
// job). A deliverable's `result_ref` is carried as opaque text: when it
// follows the `content_draft:<id>` convention (src/memory/campaigns.ts's
// linkDeliverableToContentDraft), that id is the EXPORTING install's local
// draft id and may not point at anything meaningful after import — a known,
// documented limitation, not a crash risk (result_ref has no DB-level FK
// constraint, so an unresolvable reference just sits there as inert text).

import fs from 'fs';
import path from 'path';
import { rootDirForScope } from './export';
import type {
  ContentDraft,
  ContentPost,
  ContentDraftStatus,
  ContentPostStatus,
} from '../memory/content-drafts';
import type {
  Campaign,
  CampaignDeliverable,
  CampaignStatus,
  DeliverableStatus,
} from '../memory/campaigns';

export interface ContentPostExportRow {
  channel: string;
  status: ContentPostStatus;
  detail: string | null;
  externalRef: string | null;
  createdAt: string;
}

export interface ContentDraftExportRow {
  channel: string;
  title: string;
  body: string;
  status: ContentDraftStatus;
  scheduledFor: string | null;
  postedAt: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  posts: ContentPostExportRow[];
}

export interface DeliverableExportRow {
  lane: string | null;
  title: string;
  description: string;
  status: DeliverableStatus;
  assignedSpecialist: string | null;
  /** Title of the same-campaign deliverable this one depends on, or null. A
   * portable stand-in for the local `depends_on` id (see content-import.ts). */
  dependsOnTitle: string | null;
  resultRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignExportRow {
  name: string;
  brief: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  deliverables: DeliverableExportRow[];
}

const CONTENT_DRAFTS_HEADER =
  '# Content drafts\n\n_Per-brand content workflow. Exported from the Content queue \u2014 team-shared, read-only here._\n';
const CAMPAIGNS_HEADER =
  '# Campaigns\n\n_Multi-deliverable plans. Exported from the Campaigns board \u2014 team-shared, read-only here._\n';

function draftsMarkdown(drafts: ContentDraftExportRow[]): string {
  // Stable ordering (channel, then title) so repeated exports produce
  // byte-identical files (clean diffs) \u2014 same discipline as
  // analytics-export.ts's postsMarkdown.
  const sorted = [...drafts].sort(
    (a, b) => a.channel.localeCompare(b.channel) || a.title.localeCompare(b.title)
  );
  const lines = sorted.flatMap((d) => {
    const title = d.title || '(untitled)';
    const summary = `- **[${d.channel}] ${title}** \u2014 ${d.status} (created ${d.createdAt})`;
    if (d.posts.length === 0) return [summary];
    const postLines = d.posts.map(
      (p) => `  - ${p.status} on ${p.createdAt}${p.externalRef ? ` \u2014 ${p.externalRef}` : ''}`
    );
    return [summary, ...postLines];
  });
  return `${CONTENT_DRAFTS_HEADER}\n${lines.join('\n')}\n`;
}

function campaignsMarkdown(campaigns: CampaignExportRow[]): string {
  const sorted = [...campaigns].sort((a, b) => a.name.localeCompare(b.name));
  const lines = sorted.flatMap((c) => {
    const summary = `- **${c.name}** \u2014 ${c.status} (${c.deliverables.length} deliverable${c.deliverables.length === 1 ? '' : 's'})`;
    const deliverableLines = c.deliverables.map(
      (d) =>
        `  - [${d.status}] ${d.title}${d.dependsOnTitle ? ` (depends on: ${d.dependsOnTitle})` : ''}`
    );
    return [summary, ...deliverableLines];
  });
  return `${CAMPAIGNS_HEADER}\n${lines.join('\n')}\n`;
}

/**
 * Build the lossless JSON tree content-import.ts re-imports from. Nests each
 * draft's posts (fetched via getContentPostsForDraft, already scoped to that
 * one draft) inline. Same stable sort as draftsMarkdown.
 */
function draftsJson(
  drafts: Array<{ draft: ContentDraft; posts: ContentPost[] }>
): ContentDraftExportRow[] {
  const sorted = [...drafts].sort(
    (a, b) =>
      a.draft.channel.localeCompare(b.draft.channel) || a.draft.title.localeCompare(b.draft.title)
  );
  return sorted.map(({ draft, posts }) => ({
    channel: draft.channel,
    title: draft.title,
    body: draft.body,
    status: draft.status,
    scheduledFor: draft.scheduled_for,
    postedAt: draft.posted_at,
    externalRef: draft.external_ref,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    posts: posts.map((p) => ({
      channel: p.channel,
      status: p.status,
      detail: p.detail,
      externalRef: p.external_ref,
      createdAt: p.created_at,
    })),
  }));
}

/**
 * Build the lossless JSON tree for campaigns, nesting each campaign's
 * deliverables inline. `depends_on` (a local deliverable id) is translated to
 * `dependsOnTitle` \u2014 the referenced deliverable's title, a portable stand-in
 * content-import.ts resolves back to whatever local id that title gets on
 * the importing install.
 */
function campaignsJson(
  campaigns: Array<{ campaign: Campaign; deliverables: CampaignDeliverable[] }>
): CampaignExportRow[] {
  const sorted = [...campaigns].sort((a, b) => a.campaign.name.localeCompare(b.campaign.name));
  return sorted.map(({ campaign, deliverables }) => {
    const byId = new Map(deliverables.map((d) => [d.id, d]));
    return {
      name: campaign.name,
      brief: campaign.brief,
      status: campaign.status,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at,
      deliverables: deliverables.map((d) => ({
        lane: d.lane,
        title: d.title,
        description: d.description,
        status: d.status,
        assignedSpecialist: d.assigned_specialist,
        dependsOnTitle: d.depends_on !== null ? (byId.get(d.depends_on)?.title ?? null) : null,
        resultRef: d.result_ref,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
    };
  });
}

/**
 * Build the rootDir-relative files for a scope's OWN content drafts/posts.
 * Pure \u2014 no I/O \u2014 directly testable. Returns {} when there's nothing to
 * export, matching analytics-export.ts's "omit empty buckets" convention.
 */
export function buildContentDraftsExportFiles(
  drafts: Array<{ draft: ContentDraft; posts: ContentPost[] }>
): Record<string, string> {
  if (drafts.length === 0) return {};
  const rows = draftsJson(drafts);
  return {
    '.atelier/memory/content-drafts.md': draftsMarkdown(rows),
    '.atelier/memory/content-drafts.json': `${JSON.stringify(rows, null, 2)}\n`,
  };
}

/** Same shape as buildContentDraftsExportFiles, for campaigns/deliverables. */
export function buildCampaignsExportFiles(
  campaigns: Array<{ campaign: Campaign; deliverables: CampaignDeliverable[] }>
): Record<string, string> {
  if (campaigns.length === 0) return {};
  const rows = campaignsJson(campaigns);
  return {
    '.atelier/memory/campaigns.md': campaignsMarkdown(rows),
    '.atelier/memory/campaigns.json': `${JSON.stringify(rows, null, 2)}\n`,
  };
}

/** Memory-store surface the exporter needs (a subset of MemoryManager). */
export interface ContentExportMemory {
  getContentDraftsForScopes(visibleScopes: string[]): ContentDraft[];
  getContentPostsForDraft(draftId: number): ContentPost[];
  getCampaignsForScopes(visibleScopes: string[]): Campaign[];
  getDeliverablesForCampaign(campaignId: number): CampaignDeliverable[];
}

/**
 * Materialize a scope's OWN content drafts/posts AND campaigns/deliverables
 * into its on-disk brain \u2014 same "how" as analytics-export.ts's
 * exportAnalyticsToDisk: resolve rootDir, write only non-empty files, create
 * parent dirs as needed. A no-op for scopes without a repo (project/personal)
 * or with nothing to export. Returns the rootDir-relative paths written.
 */
export function exportContentToDisk(memory: ContentExportMemory, scope: string): string[] {
  const rootDir = rootDirForScope(scope);
  if (!rootDir) return [];

  const drafts = memory
    .getContentDraftsForScopes([scope])
    .map((draft) => ({ draft, posts: memory.getContentPostsForDraft(draft.id) }));
  const campaigns = memory.getCampaignsForScopes([scope]).map((campaign) => ({
    campaign,
    deliverables: memory.getDeliverablesForCampaign(campaign.id),
  }));

  const files: Record<string, string> = {
    ...buildContentDraftsExportFiles(drafts),
    ...buildCampaignsExportFiles(campaigns),
  };

  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    written.push(rel);
  }
  return written;
}
