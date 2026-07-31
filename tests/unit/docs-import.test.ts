import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  importDocsIntoClient,
  SecretScanError,
  DEFAULT_EXCLUDES,
} from '../../src/clients/docs-import';
import { ensureObsidianVault, VAULT_GITIGNORE_CONTENT } from '../../src/clients/vault-setup';
import { setClientsRoot, clientPaths } from '../../src/clients/paths';
import type { AtelierBridgeMemory } from '../../src/memory/atelier-bridge';
import { saveFact, getFactsByCategory, deleteFact, createFactsCache } from '../../src/memory/facts';
import {
  backfillMissingEmbeddings,
  semanticSearchFacts,
  retrieveRelevantFacts,
} from '../../src/memory/semantic';
import { embedText } from '../../src/memory/embeddings';
import { resolveVisibleScopes, clientScope } from '../../src/memory/scope';

function fakeMemory(): AtelierBridgeMemory & {
  facts: {
    id: number;
    category: string;
    subject: string;
    content: string;
    scope?: string;
    content_hash?: string | null;
  }[];
} {
  const facts: {
    id: number;
    category: string;
    subject: string;
    content: string;
    scope?: string;
    content_hash?: string | null;
  }[] = [];
  let nextId = 1;
  return {
    facts,
    // Mirrors the real facts.ts saveFact's upsert-by-(scope,category,subject)
    // semantics and its content_hash bookkeeping — mirrorMemoryDir's
    // content-hash dedup needs both: re-saving an existing subject must
    // UPDATE it in place (not duplicate it), and content_hash must be
    // populated so "unchanged since last mirror" is actually detectable.
    saveFact: (category, subject, content, _sensitive, scope) => {
      const contentHash = require('crypto')
        .createHash('sha256')
        .update(content, 'utf-8')
        .digest('hex');
      const existing = facts.find(
        (f) =>
          f.category === category &&
          f.subject === subject &&
          (f.scope ?? 'user') === (scope ?? 'user')
      );
      if (existing) {
        existing.content = content;
        existing.content_hash = contentHash;
        return existing.id;
      }
      const id = nextId++;
      facts.push({ id, category, subject, content, scope, content_hash: contentHash });
      return id;
    },
    getFactsByCategory: (category) => facts.filter((f) => f.category === category),
    deleteFact: (id) => {
      const idx = facts.findIndex((f) => f.id === id);
      if (idx < 0) return false;
      facts.splice(idx, 1);
      return true;
    },
  };
}

describe('importDocsIntoClient', () => {
  let clientsRoot: string;
  let sourceDir: string;
  const clientId = 'acme';

  beforeEach(() => {
    clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-import-clients-'));
    setClientsRoot(clientsRoot);
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-import-source-'));
  });

  afterEach(() => {
    setClientsRoot('');
    fs.rmSync(clientsRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(sourceDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }

  it('copies a clean source tree into the reserved docs/ subtree', async () => {
    write('brand/voice-guide.md', '# Voice\nUnderstated, evidence-first.');
    write('comms/pr-release/announcement.md', '# Announcement');

    const result = await importDocsIntoClient({ clientId, sourceDir });

    expect(result.copiedFiles.sort()).toEqual(
      ['brand/voice-guide.md', 'comms/pr-release/announcement.md'].sort()
    );
    expect(result.skippedReservedPaths).toEqual([]);
    expect(result.ingestedFiles).toBe(0);

    const destRoot = path.join(clientPaths(clientId).rootDir, 'docs');
    expect(fs.readFileSync(path.join(destRoot, 'brand/voice-guide.md'), 'utf-8')).toContain(
      'Understated'
    );
    expect(
      fs.readFileSync(path.join(destRoot, 'comms/pr-release/announcement.md'), 'utf-8')
    ).toContain('Announcement');
  });

  it('excludes every DEFAULT_EXCLUDES entry regardless of depth', async () => {
    // One nested occurrence of every default-excluded name, plus one real file.
    write('.env', 'SHOULD_NOT_COPY=1');
    write('.git/HEAD', 'ref: refs/heads/main');
    write('.claude/settings.json', '{}');
    write('.remember/logs/today.log', 'log line');
    write('.gg/agents/foo.md', 'agent def');
    write('.mcp-servers/config.json', '{}');
    write('sub/.DS_Store', 'binary junk');
    write('sub/node_modules/pkg/index.js', 'module.exports = {}');
    write('.obsidian/workspace.json', '{"main": {}}');
    write('.obsidian/workspace-mobile.json', '{"main": {}}');
    write('.obsidian/app.json', '{}'); // NOT excluded — only workspace*.json is
    write('keep/real-doc.md', '# Keep me');

    const result = await importDocsIntoClient({ clientId, sourceDir });

    expect(result.copiedFiles.sort()).toEqual(['.obsidian/app.json', 'keep/real-doc.md'].sort());
    // Sanity: confirm none of the excluded dirs exist on disk under docs/.
    const destRoot = path.join(clientPaths(clientId).rootDir, 'docs');
    for (const excluded of DEFAULT_EXCLUDES) {
      expect(fs.existsSync(path.join(destRoot, excluded))).toBe(false);
    }
    expect(fs.existsSync(path.join(destRoot, '.obsidian/workspace.json'))).toBe(false);
    expect(fs.existsSync(path.join(destRoot, '.obsidian/workspace-mobile.json'))).toBe(false);
  });

  it('honors additional caller-supplied excludes on top of the defaults', async () => {
    write('private-notes/draft.md', 'internal only');
    write('public/announcement.md', 'public');

    const result = await importDocsIntoClient({
      clientId,
      sourceDir,
      excludes: ['private-notes'],
    });

    expect(result.copiedFiles).toEqual(['public/announcement.md']);
  });

  it('refuses to proceed and writes nothing when a secret is planted', async () => {
    write('brand/voice-guide.md', '# Voice guide, all clean');
    write('ops/deploy-notes.md', 'Deploy key: ghp_' + 'a'.repeat(36));

    await expect(importDocsIntoClient({ clientId, sourceDir })).rejects.toBeInstanceOf(
      SecretScanError
    );

    // No partial copy — the whole docs/ subtree must not exist.
    const destRoot = path.join(clientPaths(clientId).rootDir, 'docs');
    expect(fs.existsSync(destRoot)).toBe(false);
  });

  it('SecretScanError reports every offending file, not just the first', async () => {
    write('a.md', 'ghp_' + 'a'.repeat(36));
    write('b.md', 'aws_secret_access_key = "whatever"');

    try {
      await importDocsIntoClient({ clientId, sourceDir });
      expect.fail('expected SecretScanError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretScanError);
      const scanErr = err as SecretScanError;
      expect(scanErr.offending.map((o) => o.path).sort()).toEqual(['a.md', 'b.md']);
    }
  });

  it('never overwrites an exporter-owned path even if the source tries to (e.g. subtree pointed at .atelier/memory)', async () => {
    const rootDir = clientPaths(clientId).rootDir;
    const memoryDir = path.join(rootDir, '.atelier', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'voice.md'), '# App-owned canonical voice\nDo not touch.');

    write('voice.md', '# Imported voice — should NOT land here');
    write('glossary.md', '# Glossary — fine to import');

    const result = await importDocsIntoClient({
      clientId,
      sourceDir,
      subtree: '.atelier/memory',
    });

    expect(result.skippedReservedPaths).toEqual(['.atelier/memory/voice.md']);
    expect(result.copiedFiles).toEqual(['glossary.md']);
    expect(fs.readFileSync(path.join(memoryDir, 'voice.md'), 'utf-8')).toContain(
      'App-owned canonical voice'
    );
    expect(fs.readFileSync(path.join(memoryDir, 'glossary.md'), 'utf-8')).toContain('Glossary');
  });

  it('skips binary files in the secret scan but still copies them', async () => {
    const abs = path.join(sourceDir, 'asset.bin');
    fs.writeFileSync(abs, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));

    const result = await importDocsIntoClient({ clientId, sourceDir });

    expect(result.copiedFiles).toEqual(['asset.bin']);
  });

  it('ingestToMemory mirrors copied markdown into recallable memory, namespaced under the subtree', async () => {
    write('brand/voice-guide.md', '# Voice\nUnderstated, evidence-first.');
    write('comms/announcement.md', '# Announcement\nShipping soon.');
    write('assets/logo.png', 'not-real-png-bytes');

    const memory = fakeMemory();
    const result = await importDocsIntoClient({
      clientId,
      sourceDir,
      ingestToMemory: true,
      memory,
    });

    // Only the two .md files are mirrored — the binary asset is copied but not ingested.
    expect(result.ingestedFiles).toBe(2);
    const rows = memory.getFactsByCategory('atelier-memory');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scope === 'client:acme')).toBe(true);
    const subjects = rows.map((r) => r.subject).sort();
    expect(subjects).toEqual(['docs/brand/voice-guide.md', 'docs/comms/announcement.md']);
  });

  it('ingestToMemory re-import stays idempotent (no duplicate rows)', async () => {
    write('brand/voice-guide.md', '# Voice');
    const memory = fakeMemory();

    await importDocsIntoClient({ clientId, sourceDir, ingestToMemory: true, memory });
    await importDocsIntoClient({ clientId, sourceDir, ingestToMemory: true, memory });

    expect(memory.getFactsByCategory('atelier-memory')).toHaveLength(1);
  });

  it('throws synchronously (before any I/O) when ingestToMemory is true but memory is missing', async () => {
    write('brand/voice-guide.md', '# Voice');
    await expect(
      importDocsIntoClient({ clientId, sourceDir, ingestToMemory: true })
    ).rejects.toThrow(/memory.*required/i);
  });

  it('throws when sourceDir does not exist', async () => {
    await expect(
      importDocsIntoClient({ clientId, sourceDir: path.join(sourceDir, 'nope') })
    ).rejects.toThrow();
  });

  // ── GAP A: prune stale deletes ────────────────────────────────────────────

  it('prunes a destRoot file whose source counterpart was deleted since the last import', async () => {
    write('brand/voice-guide.md', '# Voice');
    write('brand/gone-soon.md', '# Will be deleted at the source');

    const first = await importDocsIntoClient({ clientId, sourceDir });
    expect(first.copiedFiles.sort()).toEqual(['brand/gone-soon.md', 'brand/voice-guide.md']);
    expect(first.prunedFiles).toEqual([]);

    const destRoot = path.join(clientPaths(clientId).rootDir, 'docs');
    expect(fs.existsSync(path.join(destRoot, 'brand/gone-soon.md'))).toBe(true);

    // Delete at the source, then re-import.
    fs.rmSync(path.join(sourceDir, 'brand/gone-soon.md'));
    const second = await importDocsIntoClient({ clientId, sourceDir });

    expect(second.copiedFiles).toEqual(['brand/voice-guide.md']);
    expect(second.prunedFiles).toEqual(['brand/gone-soon.md']);
    expect(fs.existsSync(path.join(destRoot, 'brand/gone-soon.md'))).toBe(false);
    // The file that's still at the source survives untouched.
    expect(fs.readFileSync(path.join(destRoot, 'brand/voice-guide.md'), 'utf-8')).toContain('Voice');
  });

  it('prune never touches files outside the managed subtree (e.g. a hand-added .obsidian file)', async () => {
    write('brand/voice-guide.md', '# Voice');
    await importDocsIntoClient({ clientId, sourceDir });

    const rootDir = clientPaths(clientId).rootDir;
    const destRoot = path.join(rootDir, 'docs');
    // Something outside docs/ that a real vault would have — must survive any
    // prune pass untouched: prune only ever deletes destRoot-relative paths
    // recorded in the manifest (stored under .atelier/docs-import-manifests/,
    // outside destRoot), and is additionally guarded to never resolve outside
    // destRoot regardless of manifest contents.
    fs.mkdirSync(path.join(rootDir, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, '.obsidian', 'app.json'), '{}');

    fs.rmSync(path.join(sourceDir, 'brand/voice-guide.md'));
    const result = await importDocsIntoClient({ clientId, sourceDir });

    expect(result.prunedFiles).toEqual(['brand/voice-guide.md']);
    expect(fs.existsSync(path.join(destRoot, 'brand/voice-guide.md'))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, '.obsidian', 'app.json'))).toBe(true);
  });

  it('memory mirror stops re-ingesting a file once it has been pruned from destRoot', async () => {
    write('brand/voice-guide.md', '# Voice');
    write('brand/gone-soon.md', '# Will be deleted at the source');
    const memory = fakeMemory();

    await importDocsIntoClient({ clientId, sourceDir, ingestToMemory: true, memory });
    expect(memory.getFactsByCategory('atelier-memory').map((f) => f.subject).sort()).toEqual(
      ['docs/brand/gone-soon.md', 'docs/brand/voice-guide.md'].sort()
    );

    fs.rmSync(path.join(sourceDir, 'brand/gone-soon.md'));
    await importDocsIntoClient({ clientId, sourceDir, ingestToMemory: true, memory });

    const subjects = memory.getFactsByCategory('atelier-memory').map((f) => f.subject);
    expect(subjects).toEqual(['docs/brand/voice-guide.md']);
  });

  // ── GAP B: non-.md text formats also ingest ───────────────────────────────────────────────────────

  it('ingestToMemory also mirrors .txt files (not just .md)', async () => {
    write('notes/plain.txt', 'Plain-text brand notes, no markdown syntax.');
    write('assets/logo.png', 'not-real-png-bytes');
    const memory = fakeMemory();

    const result = await importDocsIntoClient({
      clientId,
      sourceDir,
      ingestToMemory: true,
      memory,
    });

    expect(result.ingestedFiles).toBe(1);
    const rows = memory.facts.filter((f) => f.category === 'atelier-memory');
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('docs/notes/plain.txt');
    expect(rows[0].content).toContain('Plain-text brand notes');
  });

  // ── GAP C: large files are chunked ───────────────────────────────────────────────────────

  it('ingestToMemory splits a large file into multiple chunked facts, all recallable under one subject prefix', async () => {
    const paragraph = 'This is one paragraph of brand narrative prose. '.repeat(20); // ~1000 chars
    const bigDoc = Array.from({ length: 6 }, (_, i) => `${paragraph} (section ${i})`).join('\n\n');
    write('brand/big-narrative.md', bigDoc);
    const memory = fakeMemory();

    const result = await importDocsIntoClient({
      clientId,
      sourceDir,
      ingestToMemory: true,
      memory,
    });

    expect(result.ingestedFiles).toBe(1); // one file...
    const rows = memory.facts.filter((f) => f.category === 'atelier-memory');
    expect(rows.length).toBeGreaterThan(1); // ...but multiple chunked facts
    for (const row of rows) {
      expect(row.subject).toMatch(/^docs\/brand\/big-narrative\.md#chunk-\d+$/);
      expect(row.content.length).toBeLessThanOrEqual(800);
    }
    // Every chunk's subject is unique (stable per-chunk keys).
    expect(new Set(rows.map((r) => r.subject)).size).toBe(rows.length);
  });
});

describe('ensureObsidianVault', () => {
  let clientsRoot: string;
  const clientId = 'acme';

  beforeEach(() => {
    clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-setup-clients-'));
    setClientsRoot(clientsRoot);
  });

  afterEach(() => {
    setClientsRoot('');
    fs.rmSync(clientsRoot, { recursive: true, force: true });
  });

  it('writes .gitignore and the three .obsidian json files when absent', () => {
    const result = ensureObsidianVault(clientId);

    expect(result.gitignoreWritten).toBe(true);
    expect(result.obsidianFilesWritten.sort()).toEqual(
      ['app.json', 'appearance.json', 'core-plugins.json'].sort()
    );

    const rootDir = clientPaths(clientId).rootDir;
    expect(fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf-8')).toBe(VAULT_GITIGNORE_CONTENT);
    expect(fs.existsSync(path.join(rootDir, '.obsidian', 'app.json'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, '.obsidian', 'appearance.json'))).toBe(true);
    expect(fs.existsSync(path.join(rootDir, '.obsidian', 'core-plugins.json'))).toBe(true);
  });

  it('is idempotent — re-running never overwrites existing files', () => {
    ensureObsidianVault(clientId);

    const rootDir = clientPaths(clientId).rootDir;
    // Simulate a human's hand-customized vault config.
    fs.writeFileSync(path.join(rootDir, '.gitignore'), 'custom-line\n');
    fs.writeFileSync(path.join(rootDir, '.obsidian', 'appearance.json'), '{"custom": true}\n');

    const result = ensureObsidianVault(clientId);

    expect(result.gitignoreWritten).toBe(false);
    expect(result.obsidianFilesWritten).toEqual([]);
    expect(fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf-8')).toBe('custom-line\n');
    expect(fs.readFileSync(path.join(rootDir, '.obsidian', 'appearance.json'), 'utf-8')).toBe(
      '{"custom": true}\n'
    );
  });

  it('partial state: only creates the files that are actually missing', () => {
    const rootDir = clientPaths(clientId).rootDir;
    fs.mkdirSync(path.join(rootDir, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, '.obsidian', 'app.json'), '{"already": "here"}\n');

    const result = ensureObsidianVault(clientId);

    expect(result.gitignoreWritten).toBe(true);
    expect(result.obsidianFilesWritten.sort()).toEqual(['appearance.json', 'core-plugins.json'].sort());
    expect(fs.readFileSync(path.join(rootDir, '.obsidian', 'app.json'), 'utf-8')).toBe(
      '{"already": "here"}\n'
    );
  });
});

/**
 * End-to-end cross-client retrieval isolation, through the REAL pipeline
 * (importDocsIntoClient -> AtelierMemoryBridge.mirrorDocsDir -> real facts.ts
 * saveFact -> real embedFactAsync) with REAL embeddings (the actual MiniLM
 * model, not mocked) — not synthetic same-category facts hand-inserted like
 * tests/unit/scoped-memory.test.ts's existing 'Brand A cannot recall Brand B'
 * coverage. This exercises the exact atelier-memory / chunked docs/% subjects
 * the import pipeline actually produces, which that generic coverage doesn't
 * touch at all.
 *
 * Uses a real (non-mocked) AtelierBridgeMemory backed by a real better-sqlite3
 * db + facts.ts's real functions, so saveFact's fire-and-forget embedFactAsync
 * actually calls the real embedding model. backfillMissingEmbeddings is then
 * explicitly awaited after each import so every fact has a real, landed
 * embedding before any retrieval assertion runs — no reliance on fire-and-
 * forget timing.
 */
describe('cross-client retrieval isolation — real pipeline, real embeddings', () => {
  let clientsRoot: string;
  let sourceDirA: string;
  let sourceDirB: string;
  let db: Database.Database;
  let memory: AtelierBridgeMemory;

  beforeEach(() => {
    clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-import-isolation-clients-'));
    setClientsRoot(clientsRoot);
    sourceDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-import-isolation-source-a-'));
    sourceDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-import-isolation-source-b-'));

    // Real facts table — same shape production uses (see src/memory/index.ts's
    // CREATE TABLE + migrations), so saveFact/backfillMissingEmbeddings/
    // semanticSearchFacts/retrieveRelevantFacts all run their real code paths.
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        importance INTEGER DEFAULT 50,
        sensitive INTEGER DEFAULT 0,
        last_accessed_at TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        embedding BLOB,
        content_hash TEXT
      );
      -- backfillMissingEmbeddings also queries these; empty is fine here.
      CREATE TABLE soul (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aspect TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB
      );
      CREATE TABLE daily_log_rollups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        embedding BLOB
      );
    `);
    const cache = createFactsCache();
    memory = {
      saveFact: (category, subject, content, sensitive, scope) =>
        saveFact(db, category, subject, content, cache, sensitive, scope),
      getFactsByCategory: (category) => getFactsByCategory(db, category),
      deleteFact: (id) => deleteFact(db, id, cache),
    };
  });

  afterEach(() => {
    db.close();
    setClientsRoot('');
    fs.rmSync(clientsRoot, { recursive: true, force: true });
    fs.rmSync(sourceDirA, { recursive: true, force: true });
    fs.rmSync(sourceDirB, { recursive: true, force: true });
  });

  it(
    'client B\'s imported docs never surface when recalling for client A, even on a strong semantic match',
    async () => {
      // Deliberately similar/overlapping brand-voice language across both
      // clients, so a naive unscoped search WOULD return both — isolation has
      // to come from the scope filter, not from the content being dissimilar.
      fs.mkdirSync(path.join(sourceDirA, 'brand'), { recursive: true });
      fs.writeFileSync(
        path.join(sourceDirA, 'brand', 'voice.md'),
        '# Brand Voice\nOur tone is bold, playful, and confident. We speak directly to our customers.'
      );
      fs.mkdirSync(path.join(sourceDirB, 'brand'), { recursive: true });
      fs.writeFileSync(
        path.join(sourceDirB, 'brand', 'voice.md'),
        '# Brand Voice\nOur tone is bold, playful, and confident. We speak directly to our customers too.'
      );

      await importDocsIntoClient({
        clientId: 'brandA',
        sourceDir: sourceDirA,
        ingestToMemory: true,
        memory,
      });
      await importDocsIntoClient({
        clientId: 'brandB',
        sourceDir: sourceDirB,
        ingestToMemory: true,
        memory,
      });
      // Force every fire-and-forget embedFactAsync call to actually land
      // before querying — no reliance on timing.
      await backfillMissingEmbeddings(db);

      const queryVector = await embedText('What is our brand voice and tone?');
      const visibleForA = resolveVisibleScopes(
        { contextType: 'client', clientId: 'brandA', projectKey: null },
        'test-session'
      );

      const hits = semanticSearchFacts(db, queryVector, 10, visibleForA);
      const subjectsA = hits.map((h) => h.subject);
      expect(subjectsA).toContain('docs/brand/voice.md'); // brand A's own doc IS recalled
      expect(hits.every((h) => h.scope === clientScope('brandA'))).toBe(true); // every hit is A's scope
      expect(hits.some((h) => h.scope === clientScope('brandB'))).toBe(false); // never B's scope

      // Same assertion through the context-injection path the agent actually uses.
      const injected = retrieveRelevantFacts(db, queryVector, 10, 4000, visibleForA);
      expect(injected).toContain('docs/brand/voice.md');
      // brandB's row content is near-identical prose — if scope filtering were
      // broken, this exact string would appear; this proves it doesn't leak in.
      expect(injected).not.toContain('too.');
    },
    30000
  );

  it(
    'chunked multi-paragraph docs stay isolated per client too (not just single-chunk files)',
    async () => {
      const paragraph = (label: string) =>
        `This is a paragraph of ${label} brand narrative prose describing positioning, audience, and tone in some detail. `.repeat(
          8
        );
      const bigDocA = Array.from({ length: 4 }, (_, i) => `${paragraph('Acme')} (section ${i})`).join(
        '\n\n'
      );
      const bigDocB = Array.from({ length: 4 }, (_, i) => `${paragraph('Acme')} (section ${i})`).join(
        '\n\n'
      ); // same wording as A's, different client — worst case for leakage

      fs.mkdirSync(path.join(sourceDirA, 'brand'), { recursive: true });
      fs.writeFileSync(path.join(sourceDirA, 'brand', 'narrative.md'), bigDocA);
      fs.mkdirSync(path.join(sourceDirB, 'brand'), { recursive: true });
      fs.writeFileSync(path.join(sourceDirB, 'brand', 'narrative.md'), bigDocB);

      await importDocsIntoClient({
        clientId: 'brandA',
        sourceDir: sourceDirA,
        ingestToMemory: true,
        memory,
      });
      await importDocsIntoClient({
        clientId: 'brandB',
        sourceDir: sourceDirB,
        ingestToMemory: true,
        memory,
      });
      await backfillMissingEmbeddings(db);

      // Confirm this file really did chunk (multiple #chunk-N facts per client).
      const allFacts = getFactsByCategory(db, 'atelier-memory');
      const aChunks = allFacts.filter(
        (f) => f.scope === clientScope('brandA') && f.subject.startsWith('docs/brand/narrative.md#chunk-')
      );
      expect(aChunks.length).toBeGreaterThan(1);

      const queryVector = await embedText('positioning and audience narrative');
      const visibleForA = resolveVisibleScopes(
        { contextType: 'client', clientId: 'brandA', projectKey: null },
        'test-session'
      );
      const hits = semanticSearchFacts(db, queryVector, 20, visibleForA);

      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.scope === clientScope('brandA'))).toBe(true);
      expect(hits.some((h) => h.scope === clientScope('brandB'))).toBe(false);
      expect(hits.every((h) => h.subject.startsWith('docs/brand/narrative.md'))).toBe(true);
    },
    30000
  );
});
