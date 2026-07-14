/**
 * Phase 0 scoped-memory isolation guarantees.
 *
 * These are the load-bearing tests for "personal vs shared, selected in the UI":
 *  1. Personal <-> shared isolation (both directions).
 *  2. Brand A can't recall Brand B.
 *  3. The same (category, subject) coexists across scopes.
 *  4. Consolidation stays within a scope and never fuses across scopes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { serializeVector } from '../../src/memory/embeddings';
import { retrieveRelevantFacts, semanticSearchFacts } from '../../src/memory/semantic';
import {
  resolveVisibleScopes,
  resolveNearestScope,
  nextBroaderScope,
  clientScope,
  chatScope,
} from '../../src/memory/scope';
import type { SessionContext } from '../../src/memory/sessions';

// ── Pure scope resolution ─────────────────────────────────────────────────────

describe('resolveVisibleScopes', () => {
  const ctx = (over: Partial<SessionContext>): SessionContext => ({
    contextType: 'personal',
    clientId: null,
    projectKey: null,
    ...over,
  });

  it('personal sees only chat + user (personal is the ONLY place user is visible)', () => {
    expect(resolveVisibleScopes(ctx({ contextType: 'personal' }), 'S')).toEqual(['chat:S', 'user']);
  });

  it('world sees chat + world, never user', () => {
    const scopes = resolveVisibleScopes(ctx({ contextType: 'world' }), 'S');
    expect(scopes).toEqual(['chat:S', 'world']);
    expect(scopes).not.toContain('user');
  });

  it('client sees chat + client + world (its base), never user', () => {
    const scopes = resolveVisibleScopes(ctx({ contextType: 'client', clientId: 'acme' }), 'S');
    expect(scopes).toEqual(['chat:S', 'client:acme', 'world']);
    expect(scopes).not.toContain('user');
  });

  it('project sees chat + project + client + world, never user', () => {
    const scopes = resolveVisibleScopes(
      ctx({ contextType: 'project', clientId: 'acme', projectKey: 'site' }),
      'S'
    );
    expect(scopes).toEqual(['chat:S', 'project:site', 'client:acme', 'world']);
    expect(scopes).not.toContain('user');
  });

  it('nextBroaderScope walks the ladder chat \u2192 project \u2192 client \u2192 world', () => {
    const visible = ['chat:S', 'project:P', 'client:C', 'world'];
    expect(nextBroaderScope(visible, 'chat:S')).toBe('project:P');
    expect(nextBroaderScope(visible, 'project:P')).toBe('client:C');
    expect(nextBroaderScope(visible, 'client:C')).toBe('world');
    expect(nextBroaderScope(visible, 'world')).toBeNull();
  });

  it('nextBroaderScope never promotes personal (user) memory', () => {
    expect(nextBroaderScope(['chat:S', 'user'], 'user')).toBeNull();
    expect(nextBroaderScope(['chat:S', 'user'], 'chat:S')).toBeNull();
  });

  it('nearest write scope follows the selection (brand while a client is active)', () => {
    expect(resolveNearestScope(ctx({ contextType: 'personal' }))).toBe('user');
    expect(resolveNearestScope(ctx({ contextType: 'world' }))).toBe('world');
    expect(resolveNearestScope(ctx({ contextType: 'client', clientId: 'acme' }))).toBe(
      'client:acme'
    );
    expect(
      resolveNearestScope(ctx({ contextType: 'project', clientId: 'acme', projectKey: 'site' }))
    ).toBe('project:site');
  });
});

// ── Scoped recall over a real facts table ─────────────────────────────────────

describe('scoped recall isolation', () => {
  let db: Database.Database;

  // A tiny orthogonal-vector space so we control similarity precisely.
  const vec = (a: number, b: number, c: number): Buffer =>
    serializeVector(Float32Array.from([a, b, c]));
  const QUERY = Float32Array.from([1, 0, 0]); // matches any fact stored with [1,0,0]

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        importance INTEGER DEFAULT 50,
        last_accessed_at TEXT,
        updated_at TEXT DEFAULT '2024-01-01',
        embedding BLOB
      );
    `);
  });

  const insert = (subject: string, scope: string, v: Buffer): void => {
    db.prepare(
      'INSERT INTO facts (category, subject, content, scope, embedding) VALUES (?, ?, ?, ?, ?)'
    ).run('info', subject, `${subject} content`, scope, v);
  };

  it('a shared context never recalls personal (user) facts, even on a perfect match', () => {
    insert('secret', 'user', vec(1, 0, 0)); // personal, perfect match to QUERY
    insert('brand_voice', clientScope('acme'), vec(1, 0, 0)); // brand, perfect match

    // Client context: visible = [chat:S, client:acme, world] — user excluded.
    const visible = resolveVisibleScopes(
      { contextType: 'client', clientId: 'acme', projectKey: null },
      'S'
    );
    const hits = semanticSearchFacts(db, QUERY, 6, visible);
    const subjects = hits.map((h) => h.subject);
    expect(subjects).toContain('brand_voice');
    expect(subjects).not.toContain('secret');
  });

  it('personal context never recalls brand facts', () => {
    insert('secret', 'user', vec(1, 0, 0));
    insert('brand_voice', clientScope('acme'), vec(1, 0, 0));

    const visible = resolveVisibleScopes(
      { contextType: 'personal', clientId: null, projectKey: null },
      'S'
    );
    const subjects = semanticSearchFacts(db, QUERY, 6, visible).map((h) => h.subject);
    expect(subjects).toContain('secret');
    expect(subjects).not.toContain('brand_voice');
  });

  it('Brand A cannot recall Brand B (one brand never sees another)', () => {
    insert('voice_a', clientScope('brandA'), vec(1, 0, 0));
    insert('voice_b', clientScope('brandB'), vec(1, 0, 0)); // perfect match, other brand

    const visibleForA = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const subjects = semanticSearchFacts(db, QUERY, 6, visibleForA).map((h) => h.subject);
    expect(subjects).toContain('voice_a');
    expect(subjects).not.toContain('voice_b');
  });

  it('retrieveRelevantFacts injection is scope-filtered too', () => {
    insert('secret', 'user', vec(1, 0, 0));
    insert('brand_voice', clientScope('acme'), vec(1, 0, 0));

    const visible = resolveVisibleScopes(
      { contextType: 'client', clientId: 'acme', projectKey: null },
      'S'
    );
    const injected = retrieveRelevantFacts(db, QUERY, 8, 3000, visible);
    expect(injected).toContain('brand_voice');
    expect(injected).not.toContain('secret');
  });

  it('specificity breaks near-ties so nearer (chat) memory wins', () => {
    // Two near-identical matches; the chat-scoped one must rank first.
    insert('broad', 'world', vec(1, 0, 0));
    insert('local', chatScope('S'), vec(1, 0, 0));
    const visible = resolveVisibleScopes(
      { contextType: 'world', clientId: null, projectKey: null },
      'S'
    );
    const hits = semanticSearchFacts(db, QUERY, 6, visible);
    expect(hits[0]!.subject).toBe('local');
  });
});

// ── MemoryManager-level coexistence + consolidation ───────────────────────────

vi.mock('../../src/memory/semantic', async (importOriginal) => {
  // Keep the real recall/scoring functions; stub only the async embedding writes
  // so saveFact doesn't spin up the embedding model during these tests.
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

describe('scoped coexistence + consolidation (MemoryManager)', () => {
  it('the same (category, subject) coexists across scopes without collision', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    const idUser = memory.saveFact('brand', 'voice', 'Playful', false, 'user');
    const idA = memory.saveFact('brand', 'voice', 'Formal', false, clientScope('brandA'));
    const idB = memory.saveFact('brand', 'voice', 'Bold', false, clientScope('brandB'));

    // Three distinct rows — no upsert collision on (category, subject).
    expect(new Set([idUser, idA, idB]).size).toBe(3);

    const voices = memory.getAllFacts().filter((f) => f.subject === 'voice');
    expect(voices).toHaveLength(3);
    expect(voices.map((v) => `${v.scope}:${v.content}`).sort()).toEqual(
      ['client:brandA:Formal', 'client:brandB:Bold', 'user:Playful'].sort()
    );

    // Re-saving one scope updates only that scope's row.
    memory.saveFact('brand', 'voice', 'Elegant', false, clientScope('brandA'));
    const after = memory.getAllFacts().filter((f) => f.subject === 'voice');
    expect(after).toHaveLength(3);
    expect(after.find((f) => f.scope === clientScope('brandA'))!.content).toBe('Elegant');
    expect(after.find((f) => f.scope === clientScope('brandB'))!.content).toBe('Bold');
    memory.close();
  });

  it('getFactsForContext fallback is scope-filtered (no leak when embeddings are down)', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    memory.saveFact('info', 'secret', 'Personal only', false, 'user');
    memory.saveFact('info', 'brandA_fact', 'Brand A only', false, clientScope('brandA'));
    memory.saveFact('info', 'brandB_fact', 'Brand B only', false, clientScope('brandB'));

    // Brand A context: the wholesale dump must show only brand A + world scopes.
    const brandAVisible = resolveVisibleScopes(
      { contextType: 'client', clientId: 'brandA', projectKey: null },
      'S'
    );
    const brandADump = memory.getFactsForContext(brandAVisible);
    expect(brandADump).toContain('Brand A only');
    expect(brandADump).not.toContain('Personal only');
    expect(brandADump).not.toContain('Brand B only');

    // Personal context: only personal facts, never any brand.
    const personalVisible = resolveVisibleScopes(
      { contextType: 'personal', clientId: null, projectKey: null },
      'S'
    );
    const personalDump = memory.getFactsForContext(personalVisible);
    expect(personalDump).toContain('Personal only');
    expect(personalDump).not.toContain('Brand A only');
    expect(personalDump).not.toContain('Brand B only');

    // No-arg (legacy/global) call is unchanged — sees everything.
    const globalDump = memory.getFactsForContext();
    expect(globalDump).toContain('Personal only');
    expect(globalDump).toContain('Brand A only');
    expect(globalDump).toContain('Brand B only');
    memory.close();
  });

  it('promoteFact moves a fact up the ladder, merging on collision at the target', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    // Promote a chat-scoped lesson up to the client scope (no collision).
    const chatId = memory.saveFact('lessons', 'tone', 'Keep it terse', false, chatScope('S'));
    const promoted = memory.promoteFact(chatId, clientScope('acme'));
    expect(promoted.ok).toBe(true);
    const moved = memory.getAllFacts().find((f) => f.id === promoted.id);
    expect(moved!.scope).toBe(clientScope('acme'));

    // Now a collision: same (category, subject) already exists at the target.
    const chatId2 = memory.saveFact('lessons', 'tone', 'Terse AND warm', false, chatScope('S'));
    const merged = memory.promoteFact(chatId2, clientScope('acme'));
    expect(merged.ok).toBe(true);
    const tones = memory.getAllFacts().filter((f) => f.subject === 'tone');
    // Merged into one row at the client scope with the promoted content.
    expect(tones).toHaveLength(1);
    expect(tones[0]!.scope).toBe(clientScope('acme'));
    expect(tones[0]!.content).toBe('Terse AND warm');
    memory.close();
  });

  it("an in-app fact create defaults to the session's nearest scope (client while a client is active)", async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    // Simulate the IPC create path: resolve the session's nearest write scope
    // (what facts:create does) and save there. A lesson authored while a client
    // is active must live at that brand — never leak to Personal.
    memory.createClient({ id: 'acme', name: 'Acme' });
    const session = memory.createSession('Working on Acme');
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'acme',
      projectKey: null,
    });

    const scope = resolveNearestScope(memory.getSessionContext(session.id));
    expect(scope).toBe(clientScope('acme'));
    const id = memory.saveFact('lessons', 'headline', 'Lead with the benefit', false, scope);

    const fact = memory.getFact(id);
    expect(fact!.scope).toBe(clientScope('acme'));

    // It is visible in the client context and absent from Personal — no leak.
    const clientVisible = resolveVisibleScopes(memory.getSessionContext(session.id), session.id);
    expect(memory.getFactsForContext(clientVisible)).toContain('Lead with the benefit');
    const personalVisible = resolveVisibleScopes(
      { contextType: 'personal', clientId: null, projectKey: null },
      session.id
    );
    expect(memory.getFactsForContext(personalVisible)).not.toContain('Lead with the benefit');
    memory.close();
  });

  it('consolidation stays within a scope and never fuses across scopes', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const { consolidateMemory } = await import('../../src/memory/consolidation');
    const memory = new MemoryManager(':memory:');

    // Long facts so a short merged upsert satisfies shrink-safety.
    const a1 = memory.saveFact(
      'info',
      'a1',
      'Brand A fact number one is fairly long here',
      false,
      clientScope('brandA')
    );
    const a2 = memory.saveFact(
      'info',
      'a2',
      'Brand A fact number two is fairly long here',
      false,
      clientScope('brandA')
    );
    const b1 = memory.saveFact(
      'info',
      'b1',
      'Brand B fact number one is fairly long here',
      false,
      clientScope('brandB')
    );

    // A summarizer that, for whatever facts it's shown, tries to delete EVERY id
    // 1..10 (simulating a model hallucinating cross-scope ids) and upsert a short
    // merged fact. Isolation must ensure it only ever affects the current scope.
    const summarizer = vi.fn(async (prompt: string) => {
      const isBrandA = prompt.includes('a1') || prompt.includes('a2');
      return JSON.stringify({
        facts: {
          delete_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          upsert: [{ category: 'info', subject: isBrandA ? 'a' : 'b', content: 'merged' }],
        },
      });
    });

    await consolidateMemory(memory, { force: true, summarizer });

    const byScope = (scope: string): string[] =>
      memory
        .getAllFacts()
        .filter((f) => f.scope === scope)
        .map((f) => f.subject)
        .sort();

    // Each brand consolidated to its OWN merged fact; neither wiped the other.
    expect(byScope(clientScope('brandA'))).toEqual(['a']);
    expect(byScope(clientScope('brandB'))).toEqual(['b']);
    // Cross-scope ids in delete_ids were ignored — brand B survived brand A's pass.
    void a1;
    void a2;
    void b1;
    memory.close();
  });
});
