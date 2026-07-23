import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  importDocsIntoClient,
  SecretScanError,
  DEFAULT_EXCLUDES,
} from '../../src/clients/docs-import';
import { ensureObsidianVault, VAULT_GITIGNORE_CONTENT } from '../../src/clients/vault-setup';
import { setClientsRoot, clientPaths } from '../../src/clients/paths';
import type { AtelierBridgeMemory } from '../../src/memory/atelier-bridge';

function fakeMemory(): AtelierBridgeMemory & {
  facts: { id: number; category: string; subject: string; content: string; scope?: string }[];
} {
  const facts: { id: number; category: string; subject: string; content: string; scope?: string }[] =
    [];
  let nextId = 1;
  return {
    facts,
    saveFact: (category, subject, content, _sensitive, scope) => {
      const id = nextId++;
      facts.push({ id, category, subject, content, scope });
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
