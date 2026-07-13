/**
 * Memory tools for the agent
 *
 * - remember: Save facts to long-term memory
 * - forget: Remove facts from memory
 */

import { MemoryManager } from '../memory';
import { resolveNearestScope, resolveVisibleScopes, nextBroaderScope } from '../memory/scope';
import { getCurrentSessionId } from './session-context';

let memoryManager: MemoryManager | null = null;

export function setMemoryManager(memory: MemoryManager): void {
  memoryManager = memory;
}

export function getMemoryManager(): MemoryManager | null {
  return memoryManager;
}

/**
 * Scope a new fact to the session's selected memory space (personal vs a shared
 * brand). Selection drives the scope — the model never picks it — so a fact
 * saved while a Client is active lives at that brand, and personal facts stay
 * private. Falls back to the personal `user` scope.
 *
 * Exported so other tool modules with the same "scope writes to the active
 * session's nearest scope" contract (e.g. src/tools/content-tools.ts's
 * save_draft) reuse this exact logic rather than re-deriving it.
 */
export function nearestScopeForCurrentSession(memory: MemoryManager): string {
  try {
    return resolveNearestScope(memory.getSessionContext(getCurrentSessionId()));
  } catch {
    return 'user';
  }
}

/**
 * Scopes visible for recall in the session's selected context (personal never
 * mixes with shared). Exported for the same reason as
 * nearestScopeForCurrentSession above.
 */
export function visibleScopesForCurrentSession(memory: MemoryManager): string[] {
  const sessionId = getCurrentSessionId();
  try {
    return resolveVisibleScopes(memory.getSessionContext(sessionId), sessionId);
  } catch {
    return [`chat:${sessionId}`, 'user'];
  }
}

/**
 * Remember tool definition
 */
export function getRememberToolDefinition() {
  return {
    name: 'remember',
    description:
      'Save a fact to long-term memory. Keep each fact atomic (under 30 words, one piece of info per call). Use specific keys like "partner_name" not "family". Save proactively when user shares something meaningful. If the user asks you NOT to remember something, do not save it. For private or emotionally heavy facts (health, relationships, finances), save with sensitive: true so they are never proactively brought up.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category: user_info, preferences, projects, people, work, notes, decisions',
        },
        subject: {
          type: 'string',
          description:
            'Specific, descriptive key (e.g., "partner_name", "coffee_preference", "current_project")',
        },
        content: {
          type: 'string',
          description: 'The fact to remember (max 25-30 words, one piece of info only)',
        },
        sensitive: {
          type: 'boolean',
          description:
            'Mark true for private/emotionally heavy facts (health, relationships, finances). Sensitive facts are remembered but never proactively brought up unprompted.',
        },
      },
      required: ['category', 'subject', 'content'],
    },
  };
}

/**
 * Remember tool handler
 */
export async function handleRememberTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { category, subject, content, sensitive } = input as {
    category: string;
    subject: string;
    content: string;
    sensitive?: boolean;
  };

  if (!category || !subject || !content) {
    return JSON.stringify({ error: 'Missing required fields: category, subject, content' });
  }

  const scope = nearestScopeForCurrentSession(memoryManager);
  const id = memoryManager.saveFact(category, subject, content, sensitive, scope);
  console.log(
    `[Remember] Saved: [${category}] ${subject}${sensitive ? ' (sensitive)' : ''} @ ${scope}`
  );

  return JSON.stringify({
    success: true,
    message: `Remembered: ${subject}`,
    id,
    category,
    subject,
  });
}

/**
 * Forget tool definition
 */
export function getForgetToolDefinition() {
  return {
    name: 'forget',
    description:
      'Remove a fact from long-term memory. Forget by category + subject, or by fact ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category of the fact to forget',
        },
        subject: {
          type: 'string',
          description: 'Subject of the fact to forget',
        },
        id: {
          type: 'number',
          description: 'Fact ID (alternative to category+subject)',
        },
      },
      required: [],
    },
  };
}

/**
 * Forget tool handler
 */
export async function handleForgetTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { category, subject, id } = input as {
    category?: string;
    subject?: string;
    id?: number;
  };

  let deleted: boolean;

  if (id !== undefined) {
    deleted = memoryManager.deleteFact(id);
  } else if (category && subject) {
    deleted = memoryManager.deleteFactBySubject(category, subject);
  } else {
    return JSON.stringify({ error: 'Provide either id OR category+subject' });
  }

  if (deleted) {
    console.log(`[Forget] Deleted: ${id ?? `${category}/${subject}`}`);
    return JSON.stringify({ success: true, message: 'Fact forgotten' });
  } else {
    return JSON.stringify({ success: false, message: 'Fact not found' });
  }
}

/**
 * List facts tool definition (for /facts command)
 */
export function getListFactsToolDefinition() {
  return {
    name: 'list_facts',
    description:
      'List all known facts from memory. Use when user asks "what do you know about me" or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Optional: filter by category',
        },
      },
      required: [],
    },
  };
}

/**
 * List facts tool handler
 */
export async function handleListFactsTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { category } = input as { category?: string };

  let facts;
  if (category) {
    facts = memoryManager.getFactsByCategory(category);
  } else {
    facts = memoryManager.getAllFacts();
  }

  // Only show facts in the session's selected memory space (personal vs a shared
  // brand). Isolation by construction: shared contexts never list personal facts.
  const visibleScopes = new Set(visibleScopesForCurrentSession(memoryManager));
  facts = facts.filter((f) => visibleScopes.has(f.scope ?? 'user'));

  if (facts.length === 0) {
    return JSON.stringify({
      success: true,
      message: category ? `No facts in category: ${category}` : 'No facts stored yet',
      facts: [],
    });
  }

  return JSON.stringify({
    success: true,
    count: facts.length,
    facts: facts.map((f) => ({
      id: f.id,
      category: f.category,
      subject: f.subject,
      content: f.content,
    })),
  });
}

/**
 * Daily log tool definition
 */
export function getDailyLogToolDefinition() {
  return {
    name: 'daily_log',
    description:
      "Add an entry to today's daily log. Journal what the user worked on, talked about, decided, or how they seemed.",
    input_schema: {
      type: 'object' as const,
      properties: {
        entry: {
          type: 'string',
          description: 'One concise line describing what happened (auto-timestamped)',
        },
      },
      required: ['entry'],
    },
  };
}

/**
 * Extract meaningful words (>3 chars) from text, lowercased.
 */
function extractWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

/**
 * Check if a new entry is too similar to ANY existing log entry today.
 * Two checks:
 * 1. Word overlap — if >50% of the new entry's words appear in ANY single
 *    existing entry, it's a duplicate.
 * 2. Prefix match — if the first 60 chars of the new entry match the start
 *    of any existing entry (ignoring timestamps), it's a duplicate.
 */
function isDuplicateLogEntry(existingContent: string, newEntry: string): boolean {
  // Split into individual timestamped entries
  const entries = existingContent.split(/\n/).filter((l) => l.startsWith('['));
  if (entries.length === 0) return false;

  const newWords = extractWords(newEntry);
  if (newWords.size === 0) return false;

  // Normalize the new entry for prefix comparison (strip timestamp-like prefixes)
  const newNormalized = newEntry
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, '')
    .slice(0, 60);

  for (const entry of entries) {
    // Check 1: Prefix match against this entry (strip timestamp)
    const entryBody = entry.replace(/^\[.*?\]\s*/, '').toLowerCase();
    if (newNormalized.length >= 20 && entryBody.startsWith(newNormalized)) {
      return true;
    }

    // Check 2: Word overlap against this single entry
    const entryWords = extractWords(entryBody);
    if (entryWords.size === 0) continue;

    let overlap = 0;
    for (const word of newWords) {
      if (entryWords.has(word)) overlap++;
    }

    const overlapPct = overlap / newWords.size;
    if (overlapPct > 0.5) return true;
  }

  return false;
}

/**
 * Daily log tool handler
 */
export async function handleDailyLogTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { entry } = input as { entry: string };

  if (!entry || entry.trim().length === 0) {
    return JSON.stringify({ error: 'Entry is required' });
  }

  // Check for duplicate content against today's log
  const todayLog = memoryManager.getDailyLog();
  if (todayLog && isDuplicateLogEntry(todayLog.content, entry.trim())) {
    console.log(`[DailyLog] Skipped duplicate: ${entry.trim().slice(0, 60)}...`);
    return JSON.stringify({
      success: true,
      message:
        'Skipped — this topic is already logged today. Only log if something materially new happened.',
      date: todayLog.date,
      skipped: true,
    });
  }

  const log = memoryManager.appendToDailyLog(entry.trim());
  console.log(`[DailyLog] Added: ${entry.trim()}`);

  return JSON.stringify({
    success: true,
    message: 'Entry added to daily log',
    date: log.date,
  });
}

/**
 * Update fact tool definition
 */
export function getUpdateFactToolDefinition() {
  return {
    name: 'update_fact',
    description:
      'Correct or refine an existing fact by its ID (get IDs from list_facts or recall_memory). Use when the user updates info that is already remembered, instead of creating a duplicate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'The fact ID to update' },
        category: { type: 'string', description: 'New category (optional)' },
        subject: { type: 'string', description: 'New subject key (optional)' },
        content: { type: 'string', description: 'New content (optional)' },
        sensitive: {
          type: 'boolean',
          description:
            'Set true to mark the fact private/sensitive (never proactively brought up unprompted), false to unmark (optional)',
        },
      },
      required: ['id'],
    },
  };
}

/**
 * Update fact tool handler
 */
export async function handleUpdateFactTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }
  const { id, category, subject, content, sensitive } = input as {
    id?: number;
    category?: string;
    subject?: string;
    content?: string;
    sensitive?: boolean;
  };
  if (id === undefined) {
    return JSON.stringify({ error: 'id is required' });
  }
  if (
    category === undefined &&
    subject === undefined &&
    content === undefined &&
    sensitive === undefined
  ) {
    return JSON.stringify({ error: 'Provide at least one field to update' });
  }
  const updated = memoryManager.updateFact(id, { category, subject, content, sensitive });
  return JSON.stringify(
    updated
      ? { success: true, message: `Updated fact ${id}` }
      : { success: false, message: 'Fact not found or nothing changed' }
  );
}

/**
 * Promote memory tool definition
 */
export function getPromoteMemoryToolDefinition() {
  return {
    name: 'promote_memory',
    description:
      'Promote a remembered fact to a broader shared scope so it survives team-wide (chat \u2192 project \u2192 client \u2192 world). Use when a lesson learned in this conversation or brand should apply more widely. Get the fact id from list_facts or recall_memory. Only works in a shared context (World/Client/Project), not personal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'number',
          description: 'The fact ID to promote (from list_facts/recall_memory)',
        },
      },
      required: ['id'],
    },
  };
}

/**
 * Promote memory tool handler — moves a fact one step up the scope ladder,
 * derived from the session's selected context.
 */
export async function handlePromoteMemoryTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }
  const { id } = input as { id?: number };
  if (id === undefined) {
    return JSON.stringify({ error: 'id is required' });
  }

  const sessionId = getCurrentSessionId();
  const context = memoryManager.getSessionContext(sessionId);
  const visibleScopes = resolveVisibleScopes(context, sessionId);

  const fact = memoryManager.getAllFacts().find((f) => f.id === id);
  if (!fact) {
    return JSON.stringify({ success: false, message: 'Fact not found' });
  }
  // Only promote facts visible in this context (no reaching into other spaces).
  if (!visibleScopes.includes(fact.scope ?? 'user')) {
    return JSON.stringify({
      success: false,
      message: 'That fact is not in the current memory space.',
    });
  }

  const target = nextBroaderScope(visibleScopes, fact.scope ?? 'user');
  if (!target) {
    return JSON.stringify({
      success: false,
      message:
        'Nothing broader to promote to \u2014 already at the widest shared scope (or personal memory, which stays private).',
    });
  }

  const result = memoryManager.promoteFact(id, target);
  console.log(`[PromoteMemory] Fact ${id}: ${fact.scope} \u2192 ${target}`);
  return JSON.stringify(
    result.ok
      ? { success: true, message: `Promoted to ${target}`, id: result.id, scope: target }
      : { success: false, message: 'Promotion failed' }
  );
}

/**
 * Recall memory tool definition
 */
export function getRecallMemoryToolDefinition() {
  return {
    name: 'recall_memory',
    description:
      'Semantically search your own memory for facts relevant to a query, even when the wording differs (e.g. "back injury" recalls "herniated L4 disc"). Use mid-conversation when you need to remember something specific the user mentioned before.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What to recall, in natural language',
        },
        kind: {
          type: 'string',
          enum: ['fact', 'all'],
          description: 'What to search (default: fact)',
        },
      },
      required: ['query'],
    },
  };
}

/**
 * Recall memory tool handler
 */
export async function handleRecallMemoryTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { query } = input as { query: string; kind?: string };
  if (!query || query.trim().length === 0) {
    return JSON.stringify({ error: 'query is required' });
  }

  const visibleScopes = visibleScopesForCurrentSession(memoryManager);
  const visibleSet = new Set(visibleScopes);

  const embedding = await memoryManager.embedQuery(query);
  if (!embedding) {
    // Graceful degradation: fall back to LIKE search when embeddings unavailable,
    // then filter to the session's visible scopes so recall never crosses spaces.
    const facts = memoryManager.searchFacts(query).filter((f) => visibleSet.has(f.scope ?? 'user'));
    return JSON.stringify({
      success: true,
      mode: 'keyword',
      count: facts.length,
      facts: facts.map((f) => ({
        id: f.id,
        category: f.category,
        subject: f.subject,
        content: f.content,
      })),
    });
  }

  const matches = memoryManager.semanticSearchFacts(embedding, 6, visibleScopes);
  return JSON.stringify({
    success: true,
    mode: 'semantic',
    count: matches.length,
    facts: matches.map((f) => ({
      id: f.id,
      category: f.category,
      subject: f.subject,
      content: f.content,
      score: Math.round(f.score * 100) / 100,
    })),
  });
}

/**
 * Get all memory tools
 */
export function getMemoryTools() {
  return [
    {
      ...getRememberToolDefinition(),
      handler: handleRememberTool,
    },
    {
      ...getForgetToolDefinition(),
      handler: handleForgetTool,
    },
    {
      ...getListFactsToolDefinition(),
      handler: handleListFactsTool,
    },
    {
      ...getDailyLogToolDefinition(),
      handler: handleDailyLogTool,
    },
    {
      ...getRecallMemoryToolDefinition(),
      handler: handleRecallMemoryTool,
    },
    {
      ...getUpdateFactToolDefinition(),
      handler: handleUpdateFactTool,
    },
    {
      ...getPromoteMemoryToolDefinition(),
      handler: handlePromoteMemoryTool,
    },
  ];
}
