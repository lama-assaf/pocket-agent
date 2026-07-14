/**
 * Memory consolidation: merge/dedup facts, resolve contradictions, and evolve
 * soul aspects. Shared by the in-turn near-full compactor (ChatEngine) and the
 * nightly sleep-time maintenance job (CronScheduler).
 *
 * The apply logic preserves the original safety property: upsert merged entries
 * first, and only delete the originals when the result actually shrinks memory.
 */

import type { MemoryManager } from './index';
import type { Summarizer } from './summarizer';
import { summarizeText } from './summarizer';

/** Status callback so callers can surface progress in their own UI/log channels. */
export type ConsolidationStatus = (message: string, detail?: string) => void;

export interface ConsolidateOptions {
  /** Run even when usage is below the 80% threshold (nightly job uses this). */
  force?: boolean;
  /** Also reflect on recent logs/rollups and evolve up to 2 soul aspects. */
  reflect?: boolean;
  /** Optional progress callback. */
  onStatus?: ConsolidationStatus;
  /** Override the summarizer (tests inject a deterministic one). */
  summarizer?: Summarizer;
}

export interface ConsolidateResult {
  ran: boolean;
  factsDeleted: number;
  factsAdded: number;
  soulDeleted: number;
  soulAdded: number;
}

interface FactData {
  id: number;
  category: string;
  subject: string;
  content: string;
  scope: string;
  importance: number;
  days_since_accessed: number;
}

interface CompactionResult {
  facts?: {
    delete_ids?: number[];
    upsert?: Array<{ category: string; subject: string; content: string }>;
  };
  soul?: {
    delete_aspects?: string[];
    upsert?: Array<{ aspect: string; content: string }>;
  };
}

/**
 * Parse a possibly markdown-fenced JSON object from model output.
 * Returns null when no JSON object can be extracted.
 */
function extractJson(text: string): CompactionResult | null {
  let jsonStr = text.trim();
  const fenced = jsonStr.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenced) {
    jsonStr = fenced[1]!.trim();
  } else {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
  }
  try {
    return JSON.parse(jsonStr) as CompactionResult;
  } catch {
    return null;
  }
}

/**
 * Build the consolidation prompt. When `contradictionAware`, the prompt also
 * asks the model to supersede conflicting facts (latest truth wins) via delete_ids.
 */
function buildConsolidationPrompt(args: {
  factsData: FactData[];
  soulData: Array<{ aspect: string; content: string }>;
  factsOver: boolean;
  soulOver: boolean;
  contradictionAware: boolean;
  duplicateClusters: Array<Array<{ id: number; subject: string; content: string }>>;
  recentJournal?: string;
}): string {
  const {
    factsData,
    soulData,
    factsOver,
    soulOver,
    contradictionAware,
    duplicateClusters,
    recentJournal,
  } = args;

  const totalFactChars = factsData.reduce(
    (sum, f) => sum + f.category.length + f.subject.length + f.content.length,
    0
  );
  const totalSoulChars = soulData.reduce((sum, s) => sum + s.aspect.length + s.content.length, 0);
  const targetFactChars = Math.round(totalFactChars * 0.6);
  const targetSoulChars = Math.round(totalSoulChars * 0.6);

  const parts: string[] = [
    'Compact these memory entries. Return ONLY raw JSON, no markdown fences.',
    '',
  ];

  if (factsOver) {
    parts.push(
      `FACTS: currently ${totalFactChars} chars across ${factsData.length} entries. Your upserted facts MUST total UNDER ${targetFactChars} chars (sum of category+subject+content for each).`
    );
  }
  if (soulOver) {
    parts.push(
      `SOUL: currently ${totalSoulChars} chars across ${soulData.length} entries. Your upserted soul MUST total UNDER ${targetSoulChars} chars (sum of aspect+content for each).`
    );
  }

  parts.push('');
  parts.push('WHAT TO DROP (priority order):');
  parts.push(
    '- Each fact has "importance" (0-100, decays over time) and "days_since_accessed" (how many days since this fact was last relevant in conversation)'
  );
  parts.push(
    '- DROP FIRST: low importance + high days_since_accessed — these are stale, rarely discussed topics'
  );
  parts.push(
    '- DROP NEXT: duplicates and near-duplicates (same person/topic across multiple keys)'
  );
  parts.push(
    '- KEEP: high importance OR recently accessed (days_since_accessed < 7) — these are actively discussed'
  );
  parts.push('');
  if (contradictionAware) {
    parts.push('CONTRADICTIONS (resolve, latest truth wins):');
    parts.push(
      '- If two facts about the SAME subject conflict (e.g. "lives in Austin" vs "lives in Denver"), keep the most recent/most-accessed one and put the OTHER id in delete_ids.'
    );
    parts.push(
      '- Emit a single corrected fact in upsert when merging conflicting info; never keep both sides of a contradiction.'
    );
    if (recentJournal) {
      parts.push(
        '- The recent journal below is dated GROUND TRUTH for current life state. If a fact is outdated relative to the journal (e.g. fact says "reconciled with partner" but the journal records a breakup afterwards), UPDATE the fact to the current state via upsert, or delete it if no longer true.'
      );
    }
    parts.push('');
  }
  if (factsOver && duplicateClusters.length > 0) {
    parts.push('LIKELY DUPLICATES (pre-clustered by semantic similarity — merge each cluster):');
    for (const cluster of duplicateClusters.slice(0, 12)) {
      const ids = cluster.map((c) => c.id).join(', ');
      const subjects = cluster.map((c) => c.subject || c.content.slice(0, 20)).join(' | ');
      parts.push(`- ids [${ids}]: ${subjects}`);
    }
    parts.push('');
  }
  parts.push('DEDUPLICATION:');
  parts.push('- Same person/topic split across multiple subject keys → merge into ONE');
  parts.push('- Near-duplicate subject names → keep only one');
  parts.push('- Overlapping info across entries → consolidate');
  parts.push('');
  parts.push('COMPRESSION:');
  parts.push('- Each fact content: MAX 10 words. Telegram-style. No filler.');
  parts.push('- Prefer fewer entries with dense info over many granular ones');
  parts.push('');

  const responseShape: string[] = [];
  if (factsOver) {
    parts.push(
      `## Facts (${factsData.length} entries, ${totalFactChars} chars → target <${targetFactChars} chars)`
    );
    parts.push(JSON.stringify(factsData, null, 2));
    parts.push('');
    responseShape.push(
      '"facts": { "delete_ids": [<ids to remove>], "upsert": [{ "category": "...", "subject": "...", "content": "..." }] }'
    );
  }
  if (soulOver) {
    parts.push(
      `## Soul (${soulData.length} entries, ${totalSoulChars} chars → target <${targetSoulChars} chars)`
    );
    parts.push(JSON.stringify(soulData, null, 2));
    parts.push('');
    responseShape.push(
      '"soul": { "delete_aspects": ["<aspect names to remove>"], "upsert": [{ "aspect": "...", "content": "..." }] }'
    );
  }

  if (recentJournal) {
    parts.push('## Recent journal (dated ground truth — do not compact, reference only)');
    parts.push(recentJournal);
    parts.push('');
  }

  parts.push('## Expected JSON response format');
  parts.push('{');
  parts.push('  ' + responseShape.join(',\n  '));
  parts.push('}');

  return parts.join('\n');
}

/**
 * Apply a parsed consolidation result to memory with shrink-only safety.
 */
function applyResult(
  memory: MemoryManager,
  result: CompactionResult,
  factsData: FactData[],
  soulData: Array<{ aspect: string; content: string }>,
  onStatus?: ConsolidationStatus,
  factScope: string = 'user'
): { factsDeleted: number; factsAdded: number; soulDeleted: number; soulAdded: number } {
  let factsDeleted = 0;
  let factsAdded = 0;
  let soulDeleted = 0;
  let soulAdded = 0;

  if (result.facts) {
    const upserts = result.facts.upsert ?? [];
    // Only delete ids the model was actually shown for THIS scope. A hallucinated
    // or cross-scope id can't reach memory.deleteFact() (which deletes by raw id),
    // so consolidation of one scope can never delete another brand's/personal fact.
    const inScopeIds = new Set(factsData.map((f) => f.id));
    const deleteIds = (result.facts.delete_ids ?? []).filter((id) => inScopeIds.has(id));
    if (deleteIds.length > 0 || upserts.length > 0) {
      onStatus?.(
        'reorganizing facts... 🗂️',
        `${deleteIds.length} to remove, ${upserts.length} consolidated`
      );
    }

    const deletedChars = factsData
      .filter((f) => deleteIds.includes(f.id))
      .reduce((sum, f) => sum + f.category.length + f.subject.length + f.content.length, 0);
    const upsertChars = upserts.reduce(
      (sum, f) => sum + f.category.length + f.subject.length + f.content.length,
      0
    );

    if (upsertChars < deletedChars) {
      // Upserts are tagged with the scope being consolidated — a merged brand
      // fact stays at that brand, never leaking into another scope or personal.
      for (const fact of upserts) {
        memory.saveFact(fact.category, fact.subject, fact.content, undefined, factScope);
        factsAdded++;
      }
    } else if (upserts.length > 0) {
      console.log(
        `[Consolidation] Skipping fact upserts — would add ${upsertChars} chars vs removing ${deletedChars} chars`
      );
    }

    for (const id of deleteIds) {
      if (memory.deleteFact(id)) factsDeleted++;
    }
  }

  if (result.soul) {
    const deleteAspects = result.soul.delete_aspects ?? [];
    const upserts = result.soul.upsert ?? [];
    if (deleteAspects.length > 0 || upserts.length > 0) {
      onStatus?.(
        'refining soul notes... ✨',
        `${deleteAspects.length} to merge, ${upserts.length} refined`
      );
    }

    const deletedChars = soulData
      .filter((s) => deleteAspects.includes(s.aspect))
      .reduce((sum, s) => sum + s.aspect.length + s.content.length, 0);
    const upsertChars = upserts.reduce((sum, s) => sum + s.aspect.length + s.content.length, 0);

    if (upsertChars < deletedChars) {
      for (const item of upserts) {
        memory.setSoulAspect(item.aspect, item.content);
        soulAdded++;
      }
    } else if (upserts.length > 0) {
      console.log(
        `[Consolidation] Skipping soul upserts — would add ${upsertChars} chars vs removing ${deletedChars} chars`
      );
    }

    for (const aspect of deleteAspects) {
      if (memory.deleteSoulAspect(aspect)) soulDeleted++;
    }
  }

  return { factsDeleted, factsAdded, soulDeleted, soulAdded };
}

/**
 * Consolidate facts and soul. When `force` is false, only runs when facts/soul
 * usage is ≥80%. Returns a result summary; `ran` is false when nothing was due.
 */
export async function consolidateMemory(
  memory: MemoryManager,
  opts: ConsolidateOptions = {}
): Promise<ConsolidateResult> {
  const summarizer = opts.summarizer ?? summarizeText;
  const onStatus = opts.onStatus;
  const empty: ConsolidateResult = {
    ran: false,
    factsDeleted: 0,
    factsAdded: 0,
    soulDeleted: 0,
    soulAdded: 0,
  };

  const factsUsage = memory.getFactsMemoryUsage();
  const soulUsage = memory.getSoulMemoryUsage();
  const factsOver = opts.force || factsUsage.pct >= 80;
  const soulOver = opts.force || soulUsage.pct >= 80;

  // Reflection can run on its own even when nothing is over budget.
  const runReflection = async (): Promise<number> =>
    opts.reflect ? reflectOnSoul(memory, summarizer) : 0;

  if (!factsOver && !soulOver) {
    const soulAdded = await runReflection();
    return soulAdded > 0 ? { ...empty, ran: true, soulAdded } : empty;
  }

  onStatus?.('scanning memory... 🔍');

  const now = Date.now();
  const allFactData: FactData[] = (factsOver ? memory.getAllFacts() : []).map((f) => {
    const lastAccess = f.last_accessed_at ? new Date(f.last_accessed_at).getTime() : 0;
    const daysSinceAccess = lastAccess ? Math.round((now - lastAccess) / 86_400_000) : 999;
    return {
      id: f.id,
      category: f.category,
      subject: f.subject,
      content: f.content,
      scope: f.scope ?? 'user',
      importance: f.importance,
      days_since_accessed: daysSinceAccess,
    };
  });
  const soulData = (soulOver ? memory.getAllSoulAspects() : []).map((s) => ({
    aspect: s.aspect,
    content: s.content,
  }));

  if (allFactData.length === 0 && soulData.length === 0) {
    const soulAdded = await runReflection();
    return soulAdded > 0 ? { ...empty, ran: true, soulAdded } : empty;
  }

  // Recent journal as ground truth: lets the model catch facts that went stale
  // relative to dated life events (e.g. fact says "reconciled", log records a
  // breakup later). Capped so it can't crowd out the entries being compacted.
  const recentJournal = factsOver ? memory.getDailyLogsContext(7).slice(0, 2000) : '';

  let ran = false;
  let factsDeleted = 0;
  let factsAdded = 0;
  let soulDeleted = 0;
  let soulAdded = 0;

  // ── Facts: consolidate WITHIN each scope, never across ──────────────────
  // Merging/dedup/contradiction resolution is confined to one scope at a time,
  // so Brand A + Brand B + personal facts can never be fused together.
  const factsByScope = new Map<string, FactData[]>();
  for (const f of allFactData) {
    const list = factsByScope.get(f.scope) ?? [];
    list.push(f);
    factsByScope.set(f.scope, list);
  }

  for (const [scope, scopeFacts] of factsByScope) {
    if (scopeFacts.length === 0) continue;
    const duplicateClusters = memory.findNearDuplicateFacts(0.82, scope);
    const prompt = buildConsolidationPrompt({
      factsData: scopeFacts,
      soulData: [],
      factsOver: true,
      soulOver: false,
      contradictionAware: true,
      duplicateClusters,
      recentJournal,
    });

    onStatus?.('compacting memories... 🧹', scope);
    const responseText = await summarizer(prompt, 2048);
    if (!responseText) continue;
    const parsed = extractJson(responseText);
    if (!parsed) {
      console.log(`[Consolidation] Could not parse model response for scope ${scope}, skipping`);
      continue;
    }
    const applied = applyResult(memory, parsed, scopeFacts, [], onStatus, scope);
    factsDeleted += applied.factsDeleted;
    factsAdded += applied.factsAdded;
    ran = true;
  }

  // ── Soul: agent identity is global (not brand-scoped), consolidated once ──
  if (soulOver && soulData.length > 0) {
    const prompt = buildConsolidationPrompt({
      factsData: [],
      soulData,
      factsOver: false,
      soulOver: true,
      contradictionAware: true,
      duplicateClusters: [],
      recentJournal,
    });
    onStatus?.('refining soul notes... ✨');
    const responseText = await summarizer(prompt, 2048);
    const parsed = responseText ? extractJson(responseText) : null;
    if (parsed) {
      const applied = applyResult(memory, parsed, [], soulData, onStatus);
      soulDeleted += applied.soulDeleted;
      soulAdded += applied.soulAdded;
      ran = true;
    }
  }

  // Optional reflection: evolve up to 2 soul aspects from recent logs/rollups.
  soulAdded += await runReflection();

  if (!ran && soulAdded === 0) {
    return empty;
  }

  console.log(
    `[Consolidation] facts (deleted ${factsDeleted}, added ${factsAdded}), soul (deleted ${soulDeleted}, added ${soulAdded})`
  );

  return { ran: true, factsDeleted, factsAdded, soulDeleted, soulAdded };
}

/**
 * Reflect on recent daily logs + rollups and upsert ≤2 evolved soul aspects.
 * Respects the soul budget by evicting only via the model's own consolidation.
 * Returns the number of aspects upserted.
 */
async function reflectOnSoul(memory: MemoryManager, summarizer: Summarizer): Promise<number> {
  const recentLogs = memory.getDailyLogsContext(7);
  const rollups = memory.getRollupsForContext(800);
  const material = [recentLogs, rollups].filter(Boolean).join('\n\n');
  if (!material.trim()) return 0;

  const existing = memory
    .getAllSoulAspects()
    .map((s) => `- ${s.aspect}: ${s.content}`)
    .join('\n');

  const prompt =
    `You are the agent reflecting on what you've learned about working with this user. ` +
    `Based on the recent journal below, propose AT MOST 2 soul aspects (durable behavioral guidance ` +
    `for how to work well with them). Keep each under 25 words. Avoid restating existing aspects. ` +
    `Return ONLY raw JSON: {"soul":{"upsert":[{"aspect":"...","content":"..."}]}}\n\n` +
    `## Existing aspects\n${existing || '(none)'}\n\n## Recent journal\n${material}`;

  const text = await summarizer(prompt, 512);
  if (!text) return 0;
  const parsed = extractJson(text);
  const upserts = parsed?.soul?.upsert ?? [];
  let added = 0;
  for (const item of upserts.slice(0, 2)) {
    if (item.aspect && item.content) {
      memory.setSoulAspect(item.aspect, item.content);
      added++;
    }
  }
  return added;
}
