import Database from 'better-sqlite3';
import crypto from 'crypto';
import { embedFactAsync } from './semantic';

// ============ Update / sensitivity ============

// ============ Types ============

export interface Fact {
  id: number;
  category: string;
  subject: string;
  content: string;
  /** Isolation scope: 'user' (personal), 'world', 'client:<id>', 'project:<key>', 'chat:<id>'. */
  scope: string;
  importance: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * sha256(content) hex digest, kept in sync by saveFact on every insert/update
   * (see computeFactContentHash). Lets a caller compare "would this write
   * actually change anything?" without a round-trip UPDATE — the content-hash
   * dedup used by docs-import's mirrorMemoryDir (src/memory/atelier-bridge.ts)
   * to skip re-saving/re-embedding an unchanged file. Only populated by
   * queries that explicitly select it (getFactsByCategory, getFact); null on
   * a pre-migration row that hasn't been re-saved since the column was added.
   */
  content_hash: string | null;
}

/**
 * sha256(content) hex digest — the content-hash dedup key stored in
 * facts.content_hash. Exported so a caller (mirrorMemoryDir) can compute a
 * candidate's hash locally and compare it against a previously-stored fact's
 * content_hash WITHOUT calling saveFact, entirely skipping the write (and the
 * re-embed it triggers) when nothing actually changed.
 */
export function computeFactContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Cache for facts context — invalidated on any fact mutation.
 */
export interface FactsCache {
  contextCache: string | null;
  contextCacheValid: boolean;
}

/**
 * Create a fresh (empty) FactsCache.
 */
export function createFactsCache(): FactsCache {
  return { contextCache: null, contextCacheValid: false };
}

// ============ Memory budget constants ============

/** Hard character budget for facts injected into the system prompt (~1,000 tokens) */
export const FACTS_CHAR_BUDGET = 3000;

/**
 * Character budget for the facts *store* (all facts in SQLite). Consolidation
 * triggers at 80% of this. Deliberately much larger than the injection budget:
 * retrieval is semantic top-k, so store size doesn't affect per-message context
 * cost (cf. Letta's unbounded archival memory vs small core memory).
 * ~15,000 chars ≈ 150–200 atomic facts.
 */
export const FACTS_STORE_BUDGET = 15000;

// ============ Fact CRUD methods ============

/**
 * Save a fact to long-term memory (with embedding).
 *
 * The upsert key is `(scope, category, subject)` — the scope makes the same
 * `(category, subject)` (e.g. `voice`) coexist across brands and the personal
 * store without one overwriting another. Defaults to the `user` (personal) scope.
 */
export function saveFact(
  db: Database.Database,
  category: string,
  subject: string,
  content: string,
  cache: FactsCache,
  sensitive?: boolean,
  scope: string = 'user'
): number {
  const existing = db
    .prepare(
      `
      SELECT id FROM facts WHERE scope = ? AND category = ? AND subject = ?
    `
    )
    .get(scope, category, subject) as { id: number } | undefined;

  const contentHash = computeFactContentHash(content);
  let factId: number;

  if (existing) {
    db.prepare(
      `
        UPDATE facts SET content = ?, content_hash = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?
      `
    ).run(content, contentHash, existing.id);
    factId = existing.id;
    // Only touch the flag when explicitly provided — preserve manual UI settings otherwise
    if (sensitive !== undefined) {
      db.prepare('UPDATE facts SET sensitive = ? WHERE id = ?').run(sensitive ? 1 : 0, factId);
    }
  } else {
    const stmt = db.prepare(`
        INSERT INTO facts (category, subject, content, content_hash, scope, sensitive)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
    const result = stmt.run(category, subject, content, contentHash, scope, sensitive ? 1 : 0);
    factId = result.lastInsertRowid as number;
  }

  // Invalidate facts context cache
  cache.contextCacheValid = false;

  // Embed in the background — never blocks the caller
  embedFactAsync(db, factId);

  return factId;
}

/**
 * Update a fact's editable fields by id. Re-embeds in the background.
 * Returns true when a row was changed.
 */
export function updateFact(
  db: Database.Database,
  id: number,
  fields: {
    category?: string;
    subject?: string;
    content?: string;
    sensitive?: boolean;
    scope?: string;
  },
  cache: FactsCache
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.category !== undefined) {
    sets.push('category = ?');
    values.push(fields.category);
  }
  if (fields.scope !== undefined) {
    sets.push('scope = ?');
    values.push(fields.scope);
  }
  if (fields.subject !== undefined) {
    sets.push('subject = ?');
    values.push(fields.subject);
  }
  if (fields.content !== undefined) {
    sets.push('content = ?');
    values.push(fields.content);
    // Keep content_hash in sync with content so a later content-hash dedup
    // comparison (mirrorMemoryDir) never sees a stale hash for a fact edited
    // through this path.
    sets.push('content_hash = ?');
    values.push(computeFactContentHash(fields.content));
  }
  if (fields.sensitive !== undefined) {
    sets.push('sensitive = ?');
    values.push(fields.sensitive ? 1 : 0);
  }
  if (sets.length === 0) return false;

  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  const result = db.prepare(`UPDATE facts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  if (result.changes > 0) {
    cache.contextCacheValid = false;
    // Only re-embed when semantic content changed — flag-only/scope-only updates don't affect embeddings
    if (
      fields.category !== undefined ||
      fields.subject !== undefined ||
      fields.content !== undefined
    ) {
      embedFactAsync(db, id);
    }
  }
  return result.changes > 0;
}

/**
 * Promote a fact to a broader scope (chat → project → client → world), so a
 * lesson learned locally becomes team-wide. If the target scope already holds a
 * fact with the same (category, subject), the source content is merged onto it
 * and the source row is removed (respecting the `(scope, category, subject)`
 * upsert key); otherwise the fact's scope is simply moved up.
 *
 * Returns the id of the fact now living at `targetScope`, or null when the
 * source fact doesn't exist. Re-embeds in the background (scope text is part of
 * neither the embedding nor the key, so only a merge that changes content does).
 */
export function promoteFact(
  db: Database.Database,
  id: number,
  targetScope: string,
  cache: FactsCache
): { ok: boolean; id: number | null } {
  const src = db
    .prepare('SELECT id, category, subject, content, scope FROM facts WHERE id = ?')
    .get(id) as
    | { id: number; category: string; subject: string; content: string; scope: string }
    | undefined;
  if (!src) return { ok: false, id: null };
  if (src.scope === targetScope) return { ok: true, id: src.id };

  const existing = db
    .prepare('SELECT id FROM facts WHERE scope = ? AND category = ? AND subject = ?')
    .get(targetScope, src.category, src.subject) as { id: number } | undefined;

  if (existing) {
    // Merge: the promoted (more-recent) content wins at the target, drop source.
    db.prepare(
      "UPDATE facts SET content = ?, content_hash = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?"
    ).run(src.content, computeFactContentHash(src.content), existing.id);
    db.prepare('DELETE FROM facts WHERE id = ?').run(src.id);
    cache.contextCacheValid = false;
    embedFactAsync(db, existing.id);
    return { ok: true, id: existing.id };
  }

  db.prepare(
    "UPDATE facts SET scope = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?"
  ).run(targetScope, src.id);
  cache.contextCacheValid = false;
  return { ok: true, id: src.id };
}

/**
 * Set the sensitive flag on a fact (excluded from resurfacing). Returns true when changed.
 */
export function setFactSensitive(
  db: Database.Database,
  id: number,
  sensitive: boolean,
  cache: FactsCache
): boolean {
  const result = db
    .prepare('UPDATE facts SET sensitive = ? WHERE id = ?')
    .run(sensitive ? 1 : 0, id);
  if (result.changes > 0) cache.contextCacheValid = false;
  return result.changes > 0;
}

/**
 * Get a single fact by id, or null when it doesn't exist. Used by in-app fact
 * authoring to return the freshly-created/updated row.
 */
export function getFact(db: Database.Database, id: number): Fact | null {
  const row = db
    .prepare(
      `SELECT id, category, subject, content, scope, importance, last_accessed_at, created_at, updated_at, content_hash
       FROM facts WHERE id = ?`
    )
    .get(id) as Fact | undefined;
  return row ?? null;
}

/**
 * Get all facts ordered by category and subject.
 */
export function getAllFacts(db: Database.Database): Fact[] {
  const stmt = db.prepare(`
      SELECT id, category, subject, content, scope, importance, last_accessed_at, created_at, updated_at
      FROM facts
      ORDER BY category, subject
    `);
  return stmt.all() as Fact[];
}

/**
 * Format a single fact line for context injection. Includes an "as of" date so
 * the model can resolve conflicts with dated sources (e.g. daily logs) by
 * recency — a fact's truth can go stale even though it was true when saved.
 */
function formatFactLine(fact: Fact): string {
  const date = fact.updated_at?.slice(0, 10) ?? '';
  const suffix = date ? ` _(as of ${date})_` : '';
  return fact.subject
    ? `- **${fact.subject}**: ${fact.content}${suffix}`
    : `- ${fact.content}${suffix}`;
}

/**
 * Get facts formatted for context injection.
 * Sorts by importance DESC, truncates at FACTS_CHAR_BUDGET, and includes
 * a usage header with memory pressure warning when >80% full.
 * Uses the cache to avoid re-computing when nothing has changed.
 *
 * `visibleScopes` is required at the type level (not optional) so a caller
 * within this codebase can't silently forget to scope this call — an omitted
 * scope list used to look like a valid call while dumping every scope's
 * facts unfiltered. (Legacy JS/test callers that still pass no argument keep
 * working identically via the wholesale-cache path below; only typed src/
 * callers are now forced to pass one explicitly.)
 */
export function getFactsForContext(
  db: Database.Database,
  cache: FactsCache,
  visibleScopes: string[]
): string {
  // Scoped path (chat-engine fallback when embeddings are unavailable): filter to
  // the selected context's scopes so this wholesale dump can't leak personal or
  // other-brand facts. Computed fresh — the global cache can't represent a
  // per-scope result, and this degraded path is rare.
  if (visibleScopes === undefined) {
    // Return cached result if valid (avoids repeated DB queries on every message)
    if (cache.contextCacheValid && cache.contextCache !== null) {
      return cache.contextCache;
    }
  } else if (visibleScopes.length === 0) {
    // An empty visible-scope list means "nothing visible" — never fall through to
    // an unfiltered query (which would dump every scope).
    return '';
  }

  const where =
    visibleScopes !== undefined
      ? `WHERE scope IN (${visibleScopes.map(() => '?').join(', ')})`
      : '';
  const params = visibleScopes ?? [];

  // Fetch facts sorted by importance DESC, then recency
  const facts = db
    .prepare(
      `SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
       FROM facts
       ${where}
       ORDER BY importance DESC, updated_at DESC`
    )
    .all(...params) as Fact[];

  if (facts.length === 0) {
    if (visibleScopes === undefined) {
      cache.contextCache = '';
      cache.contextCacheValid = true;
    }
    return '';
  }

  // Build fact lines, accumulating chars up to budget
  // Reserve space for the header line (estimated ~80 chars max)
  const headerReserve = 100;
  const contentBudget = FACTS_CHAR_BUDGET - headerReserve;

  const includedFacts: Fact[] = [];
  const byCategory = new Map<string, Fact[]>();
  let usedChars = 0;

  for (const fact of facts) {
    const line = formatFactLine(fact);
    // Account for category header if this is the first fact in its category
    const categoryHeader = byCategory.has(fact.category) ? '' : `\n### ${fact.category}\n`;
    const additionalChars = categoryHeader.length + line.length + 1; // +1 for newline

    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    includedFacts.push(fact);

    const list = byCategory.get(fact.category) || [];
    list.push(fact);
    byCategory.set(fact.category, list);
  }

  // Update last_accessed_at for included facts
  if (includedFacts.length > 0) {
    const ids = includedFacts.map((f) => f.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE facts SET last_accessed_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  // Build header
  const header = `## Known Facts`;

  const lines: string[] = [header];
  for (const [category, categoryFacts] of byCategory) {
    lines.push(`\n### ${category}`);
    for (const fact of categoryFacts) {
      lines.push(formatFactLine(fact));
    }
  }

  const result = lines.join('\n');
  // Only the unscoped (global) result is cached; scoped results vary per session.
  if (visibleScopes === undefined) {
    cache.contextCache = result;
    cache.contextCacheValid = true;
  }
  return result;
}

/**
 * Get memory usage stats for the facts *store* budget (consolidation trigger).
 * Measures all stored facts — unlike context injection, nothing is truncated
 * here; pct can exceed 100 until consolidation shrinks the store.
 *
 * Pass `scope` to measure a single memory space (used by the Brain's per-space
 * capacity bar so it matches the scoped fact list above it). No scope = every
 * space — the global figure the nightly consolidation trigger reads.
 */
export function getFactsMemoryUsage(
  db: Database.Database,
  scope?: string
): {
  usedChars: number;
  budgetChars: number;
  pct: number;
} {
  const where = scope ? 'WHERE scope = ?' : '';
  const facts = db
    .prepare(`SELECT category, subject, content FROM facts ${where}`)
    .all(...(scope ? [scope] : [])) as Array<{
    category: string;
    subject: string;
    content: string;
  }>;

  const seenCategories = new Set<string>();
  let usedChars = 0;

  for (const fact of facts) {
    const line = fact.subject ? `- **${fact.subject}**: ${fact.content}` : `- ${fact.content}`;
    const categoryHeader = seenCategories.has(fact.category) ? '' : `\n### ${fact.category}\n`;
    usedChars += categoryHeader.length + line.length + 1;
    seenCategories.add(fact.category);
  }

  const pct = Math.round((usedChars / FACTS_STORE_BUDGET) * 100);
  return { usedChars, budgetChars: FACTS_STORE_BUDGET, pct };
}

/**
 * Delete a fact by ID. Returns true if a row was deleted.
 */
export function deleteFact(db: Database.Database, id: number, cache: FactsCache): boolean {
  const stmt = db.prepare('DELETE FROM facts WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0) {
    cache.contextCacheValid = false; // Invalidate cache
  }
  return result.changes > 0;
}

/**
 * Delete a fact by category + subject. Returns true if a row was deleted.
 */
export function deleteFactBySubject(
  db: Database.Database,
  category: string,
  subject: string,
  cache: FactsCache
): boolean {
  const stmt = db.prepare('DELETE FROM facts WHERE category = ? AND subject = ?');
  const result = stmt.run(category, subject);
  if (result.changes > 0) {
    cache.contextCacheValid = false; // Invalidate cache
  }
  return result.changes > 0;
}

/**
 * Simple LIKE-based fact search by content, subject, or category.
 */
export function searchFacts(db: Database.Database, query: string, category?: string): Fact[] {
  const pattern = `%${query}%`;
  if (category) {
    return db
      .prepare(
        `SELECT id, category, subject, content, scope, importance, last_accessed_at, created_at, updated_at
         FROM facts
         WHERE category = ? AND (content LIKE ? OR subject LIKE ?)
         ORDER BY updated_at DESC
         LIMIT 6`
      )
      .all(category, pattern, pattern) as Fact[];
  }
  return db
    .prepare(
      `SELECT id, category, subject, content, scope, importance, last_accessed_at, created_at, updated_at
       FROM facts
       WHERE content LIKE ? OR subject LIKE ? OR category LIKE ?
       ORDER BY updated_at DESC
       LIMIT 6`
    )
    .all(pattern, pattern, pattern) as Fact[];
}

/**
 * Get all facts for a category restricted to a set of scopes, via the
 * `idx_facts_category_scope` composite index — an indexed `WHERE category = ?
 * AND scope IN (...)` lookup instead of a full-table `getAllFacts()` +
 * in-memory filter. Backs scoped resolution paths that used to scan every
 * fact on every call: enablement (src/agent/enablement.ts), agent overrides
 * (src/agent/agent-overrides.ts), and how-to-act (src/agent/how-to-act.ts).
 * Returns [] when `scopes` is empty (never falls through to an unfiltered
 * query — same "nothing visible" contract as getFactsForContext).
 */
export function getFactsByCategoryAndScopes(
  db: Database.Database,
  category: string,
  scopes: string[]
): Fact[] {
  if (scopes.length === 0) return [];
  const placeholders = scopes.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, category, subject, content, scope, importance, last_accessed_at, created_at, updated_at
       FROM facts
       WHERE category = ? AND scope IN (${placeholders})`
    )
    .all(category, ...scopes) as Fact[];
}

/**
 * Get all facts for a given category.
 */
export function getFactsByCategory(db: Database.Database, category: string): Fact[] {
  const stmt = db.prepare(`
      SELECT id, category, subject, content, scope, importance, last_accessed_at, created_at, updated_at, content_hash
      FROM facts
      WHERE category = ?
      ORDER BY subject, updated_at DESC
    `);
  return stmt.all(category) as Fact[];
}

/**
 * Brain-freshness snapshot for a client's imported docs (the
 * `atelier-memory` facts under `docs/%` written by docs-import.ts's
 * mirrorDocsDir — see src/memory/atelier-bridge.ts). Used by the ingestion
 * observability IPC/UI (clients:memoryStatus) to show fact count, how many
 * are actually embedded/recallable vs still pending, and how long ago the
 * brain was last touched — not just the one-shot file-copy counts
 * ImportDocsResult already surfaces.
 */
export interface ClientDocsMemoryStatus {
  /** Total atelier-memory facts under docs/% for this scope (chunks count individually). */
  factCount: number;
  /** Of those, how many have a non-null embedding (recallable via semantic search). */
  embeddedCount: number;
  /** factCount - embeddedCount — awaiting embedding (see semantic.ts's embedFactsBatch/backfillMissingEmbeddings). */
  pendingCount: number;
  /** MAX(updated_at) across those facts, or null when there are none yet. */
  lastSyncedAt: string | null;
}

/**
 * Query a scope's (e.g. `client:acme`) doc-ingestion memory status. A single
 * query — COUNT(*) for the total, COUNT(embedding) for the non-null subset
 * (SQLite's COUNT(col) skips NULLs), MAX(updated_at) for freshness — no
 * schema change needed.
 */
export function getClientDocsMemoryStatus(
  db: Database.Database,
  scope: string
): ClientDocsMemoryStatus {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as factCount,
         COUNT(embedding) as embeddedCount,
         MAX(updated_at) as lastSyncedAt
       FROM facts
       WHERE scope = ? AND category = 'atelier-memory' AND subject LIKE 'docs/%'`
    )
    .get(scope) as { factCount: number; embeddedCount: number; lastSyncedAt: string | null };

  return {
    factCount: row.factCount,
    embeddedCount: row.embeddedCount,
    pendingCount: row.factCount - row.embeddedCount,
    lastSyncedAt: row.lastSyncedAt,
  };
}

/**
 * Get a list of distinct fact categories.
 */
export function getFactCategories(db: Database.Database): string[] {
  const stmt = db.prepare(`
      SELECT DISTINCT category FROM facts ORDER BY category
    `);
  const rows = stmt.all() as { category: string }[];
  return rows.map((r) => r.category);
}

// ============ Importance decay ============

/**
 * Decay importance for facts not accessed recently.
 * Run at app startup to gradually demote stale facts.
 *
 * - Facts not accessed in 30+ days: importance -= 10 (min 10)
 * - Facts not accessed in 90+ days: importance -= 20 (min 5)
 */
export function decayFactImportance(db: Database.Database): void {
  // 90+ days first (larger decay), then 30+ days
  const decayed90 = db
    .prepare(
      `UPDATE facts
       SET importance = MAX(5, importance - 20)
       WHERE last_accessed_at IS NOT NULL
         AND last_accessed_at < datetime('now', '-90 days')
         AND importance > 5`
    )
    .run();

  const decayed30 = db
    .prepare(
      `UPDATE facts
       SET importance = MAX(10, importance - 10)
       WHERE last_accessed_at IS NOT NULL
         AND last_accessed_at < datetime('now', '-30 days')
         AND last_accessed_at >= datetime('now', '-90 days')
         AND importance > 10`
    )
    .run();

  const total = (decayed90.changes || 0) + (decayed30.changes || 0);
  if (total > 0) {
    console.log(
      `[Memory] Decayed importance for ${total} stale facts (90d: ${decayed90.changes}, 30d: ${decayed30.changes})`
    );
  }
}
