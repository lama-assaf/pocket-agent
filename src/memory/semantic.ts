/**
 * Semantic recall layer: embed memory rows on write, and retrieve the most
 * relevant facts/soul aspects/rollups for a given query embedding at read time.
 *
 * Retrieval is brute-force cosine over inline BLOB vectors — small personal
 * memory makes this <10ms and avoids native vector-index packaging.
 *
 * All write helpers are safe to call fire-and-forget: embedding never blocks a
 * chat turn, and failures degrade gracefully to the wholesale importance-sorted
 * fallbacks.
 */

import type Database from 'better-sqlite3';
import { cosineSimilarity, deserializeVector, embedText, serializeVector } from './embeddings';
import { scopeSpecificity } from './scope';

/** A scored row used internally during retrieval. */
interface ScoredRow<T> {
  row: T;
  score: number;
}

/**
 * When two facts are within this cosine window they count as a "tie" and the
 * more specific scope (chat > project > client > world > user) wins. Wide enough
 * to prefer local memory on near-ties, narrow enough that a clearly more
 * relevant fact from a broader scope still ranks first.
 */
const SCOPE_TIE_EPSILON = 0.02;

/**
 * Build a `scope IN (...)` filter for the given visible scopes. Returns an empty
 * clause when no scopes are supplied (legacy/global callers) so behavior is
 * unchanged unless a caller opts into scoping.
 */
function scopeFilter(visibleScopes?: string[]): { clause: string; params: string[] } {
  if (!visibleScopes || visibleScopes.length === 0) return { clause: '', params: [] };
  const placeholders = visibleScopes.map(() => '?').join(', ');
  return { clause: ` WHERE scope IN (${placeholders})`, params: visibleScopes };
}

/**
 * Score fact rows by cosine similarity, breaking near-ties by scope specificity
 * so nearer memory wins when relevance is effectively equal.
 */
function scoreFactRows(rows: FactRow[], queryEmbedding: Float32Array): ScoredRow<FactRow>[] {
  const scored: ScoredRow<FactRow>[] = [];
  for (const row of rows) {
    const vec = deserializeVector(row.embedding ?? null);
    if (!vec) continue;
    scored.push({ row, score: cosineSimilarity(queryEmbedding, vec) });
  }
  scored.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > SCOPE_TIE_EPSILON) return scoreDiff;
    const specDiff =
      scopeSpecificity(b.row.scope ?? 'user') - scopeSpecificity(a.row.scope ?? 'user');
    if (specDiff !== 0) return specDiff;
    return scoreDiff;
  });
  return scored;
}

/**
 * Embed arbitrary text and store the serialized vector into `table.embedding`
 * for the given row id. Fire-and-forget friendly: errors are logged, not thrown.
 */
async function embedAndStore(
  db: Database.Database,
  table: 'facts' | 'soul' | 'daily_log_rollups',
  id: number,
  text: string
): Promise<void> {
  try {
    if (!text || text.trim().length === 0) return;
    const vector = await embedText(text);
    const blob = serializeVector(vector);
    db.prepare(`UPDATE ${table} SET embedding = ? WHERE id = ?`).run(blob, id);
  } catch (e) {
    console.warn(`[Semantic] Failed to embed ${table}#${id}:`, e);
  }
}

/**
 * Embed a fact row (category/subject/content) and store the vector.
 */
export async function embedFact(db: Database.Database, id: number): Promise<void> {
  const row = db.prepare('SELECT category, subject, content FROM facts WHERE id = ?').get(id) as
    | { category: string; subject: string; content: string }
    | undefined;
  if (!row) return;
  const text = `${row.category} ${row.subject} ${row.content}`.trim();
  await embedAndStore(db, 'facts', id, text);
}

/**
 * Embed a soul aspect row (aspect/content) and store the vector.
 */
export async function embedSoulAspect(db: Database.Database, id: number): Promise<void> {
  const row = db.prepare('SELECT aspect, content FROM soul WHERE id = ?').get(id) as
    | { aspect: string; content: string }
    | undefined;
  if (!row) return;
  const text = `${row.aspect} ${row.content}`.trim();
  await embedAndStore(db, 'soul', id, text);
}

/**
 * Embed a daily-log rollup row and store the vector.
 */
export async function embedRollup(
  db: Database.Database,
  id: number,
  content: string
): Promise<void> {
  await embedAndStore(db, 'daily_log_rollups', id, content);
}

/**
 * Fire-and-forget embed of a fact (does not block the caller).
 */
export function embedFactAsync(db: Database.Database, id: number): void {
  void embedFact(db, id);
}

/**
 * Fire-and-forget embed of a soul aspect (does not block the caller).
 */
export function embedSoulAspectAsync(db: Database.Database, id: number): void {
  void embedSoulAspect(db, id);
}

/**
 * Backfill embeddings for any facts/soul/rollup rows whose embedding IS NULL.
 * Runs sequentially in the background; safe to call on startup.
 */
export async function backfillMissingEmbeddings(db: Database.Database): Promise<void> {
  const facts = db.prepare('SELECT id FROM facts WHERE embedding IS NULL').all() as Array<{
    id: number;
  }>;
  const souls = db.prepare('SELECT id FROM soul WHERE embedding IS NULL').all() as Array<{
    id: number;
  }>;
  const rollups = db
    .prepare('SELECT id, content FROM daily_log_rollups WHERE embedding IS NULL')
    .all() as Array<{ id: number; content: string }>;

  const total = facts.length + souls.length + rollups.length;
  if (total === 0) return;

  console.log(`[Semantic] Backfilling embeddings for ${total} row(s)...`);
  for (const f of facts) await embedFact(db, f.id);
  for (const s of souls) await embedSoulAspect(db, s.id);
  for (const r of rollups) await embedRollup(db, r.id, r.content);
  console.log('[Semantic] Embedding backfill complete');
}

/**
 * Generic brute-force cosine retrieval over a set of rows that carry an
 * `embedding` BLOB. Returns rows sorted by descending similarity (best first),
 * filtered to those with a usable vector.
 */
function scoreRows<T extends { embedding?: Buffer | Uint8Array | null }>(
  rows: T[],
  queryEmbedding: Float32Array
): ScoredRow<T>[] {
  const scored: ScoredRow<T>[] = [];
  for (const row of rows) {
    const vec = deserializeVector(row.embedding ?? null);
    if (!vec) continue;
    scored.push({ row, score: cosineSimilarity(queryEmbedding, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

interface FactRow {
  id: number;
  category: string;
  subject: string;
  content: string;
  scope?: string;
  updated_at?: string;
  embedding?: Buffer | Uint8Array | null;
}

/**
 * Format a fact line with an "as of" date so the model can resolve conflicts
 * with dated sources (daily logs, rollups) by recency.
 */
function formatFactRowLine(row: FactRow): string {
  const date = row.updated_at?.slice(0, 10) ?? '';
  const suffix = date ? ` _(as of ${date})_` : '';
  return row.subject
    ? `- **${row.subject}**: ${row.content}${suffix}`
    : `- ${row.content}${suffix}`;
}

/**
 * Retrieve the most relevant facts for a query embedding, formatted for context
 * injection within a character budget. Returns '' when nothing is embedded yet
 * (caller should fall back to the wholesale importance-sorted dump).
 */
export function retrieveRelevantFacts(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
  budgetChars: number,
  visibleScopes?: string[],
  minScore = 0.25
): string {
  const { clause, params } = scopeFilter(visibleScopes);
  const rows = db
    .prepare(
      `SELECT id, category, subject, content, scope, updated_at, embedding FROM facts${clause}`
    )
    .all(...params) as FactRow[];
  const scored = scoreFactRows(rows, queryEmbedding).filter((s) => s.score >= minScore);
  if (scored.length === 0) return '';

  const headerReserve = 100;
  const contentBudget = budgetChars - headerReserve;

  const byCategory = new Map<string, FactRow[]>();
  const includedIds: number[] = [];
  let usedChars = 0;

  for (const { row } of scored.slice(0, k)) {
    const line = formatFactRowLine(row);
    const categoryHeader = byCategory.has(row.category) ? '' : `\n### ${row.category}\n`;
    const additionalChars = categoryHeader.length + line.length + 1;
    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    includedIds.push(row.id);
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  if (includedIds.length === 0) return '';

  // Update last_accessed_at for surfaced facts
  const placeholders = includedIds.map(() => '?').join(',');
  db.prepare(
    `UPDATE facts SET last_accessed_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id IN (${placeholders})`
  ).run(...includedIds);

  const lines: string[] = ['## Known Facts'];
  for (const [category, facts] of byCategory) {
    lines.push(`\n### ${category}`);
    for (const fact of facts) {
      lines.push(formatFactRowLine(fact));
    }
  }
  return lines.join('\n');
}

interface SoulRow {
  id: number;
  aspect: string;
  content: string;
  embedding?: Buffer | Uint8Array | null;
}

/**
 * Retrieve the most relevant soul aspects for a query embedding, formatted for
 * context injection within a budget. `alwaysInclude` aspect names are pinned
 * (identity-critical) regardless of similarity. Returns '' when nothing embedded.
 */
export function retrieveRelevantSoul(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
  budgetChars: number,
  alwaysInclude: string[] = [],
  minScore = 0.25
): string {
  const rows = db.prepare('SELECT id, aspect, content, embedding FROM soul').all() as SoulRow[];
  if (rows.length === 0) return '';
  // Pinned (identity-critical) aspects are kept regardless of score; the rest
  // must clear the relevance threshold so weakly-related aspects don't dilute.
  const scored = scoreRows(rows, queryEmbedding).filter((s) => s.score >= minScore);

  const headerReserve = 80;
  const contentBudget = budgetChars - headerReserve;

  const pinnedSet = new Set(alwaysInclude.map((a) => a.toLowerCase()));
  const orderedRows: SoulRow[] = [];
  const seen = new Set<number>();

  // Pinned aspects first
  for (const row of rows) {
    if (pinnedSet.has(row.aspect.toLowerCase())) {
      orderedRows.push(row);
      seen.add(row.id);
    }
  }
  // Then by relevance
  for (const { row } of scored.slice(0, k)) {
    if (!seen.has(row.id)) {
      orderedRows.push(row);
      seen.add(row.id);
    }
  }

  const includedLines: string[] = [];
  let usedChars = 0;
  for (const aspect of orderedRows) {
    const aspectHeader = `\n### ${aspect.aspect}`;
    const additionalChars = aspectHeader.length + 1 + aspect.content.length;
    if (usedChars + additionalChars > contentBudget) break;
    usedChars += additionalChars;
    includedLines.push(aspectHeader);
    includedLines.push(aspect.content);
  }

  if (includedLines.length === 0) return '';
  return ['## Soul', ...includedLines].join('\n');
}

interface RollupRow {
  id: number;
  period_type: string;
  period_start: string;
  period_end: string;
  content: string;
  embedding?: Buffer | Uint8Array | null;
}

/**
 * Retrieve relevant daily-log rollups ("Earlier" context) for a query embedding.
 * Small budget by design. Returns '' when no relevant rollups are embedded.
 */
export function retrieveRelevantRollups(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k: number,
  budgetChars: number,
  minScore = 0.2
): string {
  const rows = db
    .prepare(
      'SELECT id, period_type, period_start, period_end, content, embedding FROM daily_log_rollups'
    )
    .all() as RollupRow[];
  if (rows.length === 0) return '';
  const scored = scoreRows(rows, queryEmbedding).filter((s) => s.score >= minScore);
  if (scored.length === 0) return '';

  const includedLines: string[] = [];
  let usedChars = 0;
  for (const { row } of scored.slice(0, k)) {
    const label =
      row.period_type === 'week' ? `Week of ${row.period_start}` : `${row.period_start} (month)`;
    const header = `\n### ${label}`;
    const additionalChars = header.length + 1 + row.content.length;
    if (usedChars + additionalChars > budgetChars) break;
    usedChars += additionalChars;
    includedLines.push(header);
    includedLines.push(row.content);
  }

  if (includedLines.length === 0) return '';
  return ['## Earlier', ...includedLines].join('\n');
}

/**
 * Find clusters of near-duplicate facts by cosine similarity above `threshold`.
 * Returns groups of fact ids (size >= 2) so the consolidation LLM can be told
 * which entries are likely duplicates/contradictions. Uses a simple
 * union-find-free greedy grouping over the upper-triangular similarity pairs.
 */
export function findNearDuplicateFacts(
  db: Database.Database,
  threshold = 0.82,
  scope?: string
): Array<Array<{ id: number; subject: string; content: string }>> {
  const where = scope ? ' WHERE scope = ?' : '';
  const rows = db
    .prepare(`SELECT id, category, subject, content, scope, embedding FROM facts${where}`)
    .all(...(scope ? [scope] : [])) as FactRow[];
  const vectors = rows
    .map((r) => ({ row: r, vec: deserializeVector(r.embedding ?? null) }))
    .filter((x): x is { row: FactRow; vec: Float32Array } => x.vec !== null);

  // group id per row index
  const group = new Map<number, number>();
  let nextGroup = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const a = vectors[i]!;
      const b = vectors[j]!;
      if (cosineSimilarity(a.vec, b.vec) >= threshold) {
        const gi = group.get(a.row.id);
        const gj = group.get(b.row.id);
        if (gi === undefined && gj === undefined) {
          const g = nextGroup++;
          group.set(a.row.id, g);
          group.set(b.row.id, g);
        } else if (gi !== undefined && gj === undefined) {
          group.set(b.row.id, gi);
        } else if (gi === undefined && gj !== undefined) {
          group.set(a.row.id, gj);
        }
      }
    }
  }

  const byGroup = new Map<number, Array<{ id: number; subject: string; content: string }>>();
  for (const { row } of vectors) {
    const g = group.get(row.id);
    if (g === undefined) continue;
    const list = byGroup.get(g) ?? [];
    list.push({ id: row.id, subject: row.subject, content: row.content });
    byGroup.set(g, list);
  }
  return [...byGroup.values()].filter((c) => c.length >= 2);
}

/**
 * Semantic search across facts for the `recall_memory` agent tool and UI search.
 * Returns the top-k facts by cosine similarity above a minimum score.
 */
export function semanticSearchFacts(
  db: Database.Database,
  queryEmbedding: Float32Array,
  k = 6,
  visibleScopes?: string[],
  minScore = 0.15
): Array<FactRow & { score: number }> {
  const { clause, params } = scopeFilter(visibleScopes);
  const rows = db
    .prepare(`SELECT id, category, subject, content, scope, embedding FROM facts${clause}`)
    .all(...params) as FactRow[];
  return scoreFactRows(rows, queryEmbedding)
    .filter((s) => s.score >= minScore)
    .slice(0, k)
    .map((s) => ({ ...s.row, score: s.score }));
}
