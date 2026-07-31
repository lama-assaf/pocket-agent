/**
 * Integration-level test of pullBrain's real divergence-merge path (real git
 * objects/commits via isomorphic-git, real fs) — clients-sync.test.ts already
 * unit-tests the pure reconciliation helpers (unionAppendOnly/reconcileFile)
 * in isolation; this file proves the same guarantee holds when pullBrain
 * ACTUALLY walks two diverged commit histories end to end: two operators
 * append different lessons while offline, then one of them pulls — both
 * lessons must survive, deduped, with no raw conflict markers.
 *
 * Only `git.fetch` (the real network transport) is stubbed — the divergent
 * "their" history is built for real via local git commits, and the
 * remote-tracking ref (`refs/remotes/origin/<branch>`) is written directly,
 * exactly what a real `fetch` would have left behind. Every other git
 * operation (commit, checkout, branch, merge-commit, readCommit) is the real
 * isomorphic-git implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let fetchOverride: (() => Promise<void>) | null = null;

vi.mock('isomorphic-git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('isomorphic-git')>();
  return {
    default: {
      ...actual.default,
      fetch: async (...args: unknown[]) => {
        if (fetchOverride) {
          await fetchOverride();
          return undefined as never;
        }
        return (actual.default.fetch as (...a: unknown[]) => unknown)(...args);
      },
    },
  };
});

// Imported AFTER the mock so pullBrain's internal `import git from 'isomorphic-git'` picks it up.
import git from 'isomorphic-git';
import { pullBrain, commitAll } from '../../src/clients/sync';
import { remirrorImportedDocsForScope } from '../../src/clients/live-sync';
import { setClientsRoot, clientPaths } from '../../src/clients/paths';
import { clientScope } from '../../src/memory/scope';
import { MemoryManager } from '../../src/memory/index';
import { AtelierMemoryBridge } from '../../src/memory/atelier-bridge';

describe('pullBrain — real divergence merge (append-mostly reconcile)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-pull-'));
    await git.init({ fs, dir, defaultBranch: 'main' });
    fs.mkdirSync(path.join(dir, '.atelier', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.atelier', 'memory', 'lessons.md'), '- shared\n');
    await commitAll(dir, 'seed');
  });

  afterEach(() => {
    fetchOverride = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const lessonsPath = () => path.join(dir, '.atelier', 'memory', 'lessons.md');

  it('unions two concurrently-diverged lessons.md appends into one merge commit, no dupes, nothing lost', async () => {
    // Branch off the seed to build "their" divergent history in parallel.
    await git.branch({ fs, dir, ref: 'theirs-branch' });

    // "Ours": append a lesson only we know about, on main.
    fs.writeFileSync(lessonsPath(), '- shared\n- ours-only\n');
    const oursSha = await commitAll(dir, 'ours: add lesson');
    expect(oursSha).toBeTruthy();

    // "Theirs": append a DIFFERENT lesson, from the seed point, on the side branch.
    await git.checkout({ fs, dir, ref: 'theirs-branch' });
    expect(fs.readFileSync(lessonsPath(), 'utf-8')).toBe('- shared\n'); // back to seed content
    fs.writeFileSync(lessonsPath(), '- shared\n- theirs-only\n');
    const theirsSha = await commitAll(dir, 'theirs: add lesson');
    expect(theirsSha).toBeTruthy();

    // Back to "our" side before pulling.
    await git.checkout({ fs, dir, ref: 'main' });
    expect(fs.readFileSync(lessonsPath(), 'utf-8')).toBe('- shared\n- ours-only\n');

    // Simulate what a real `git.fetch` would have left behind: theirs is now
    // reachable via the remote-tracking ref, without touching local HEAD/main.
    fetchOverride = async () => {
      await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: theirsSha!, force: true });
    };

    const result = await pullBrain({ dir, url: 'https://example.invalid/brain.git', token: 'x' });
    expect(result.merged).toBe(true);

    const merged = fs.readFileSync(lessonsPath(), 'utf-8');
    expect(merged).toContain('- shared');
    expect(merged).toContain('- ours-only');
    expect(merged).toContain('- theirs-only');
    // No duplication of the line both sides already shared.
    expect(merged.match(/- shared/g)).toHaveLength(1);

    // A genuine two-parent merge commit was recorded (not a fast-forward, not a silent overwrite).
    const headSha = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const { commit } = await git.readCommit({ fs, dir, oid: headSha });
    expect(commit.parent.sort()).toEqual([oursSha, theirsSha].sort());
  });

  it('fast-forwards (no merge commit) when our history is a strict ancestor of theirs', async () => {
    const seedSha = await git.resolveRef({ fs, dir, ref: 'HEAD' });

    // "Theirs" simply continues on from our exact current state — no divergence.
    fs.writeFileSync(lessonsPath(), '- shared\n- theirs-continued\n');
    const theirsSha = await commitAll(dir, 'theirs: continue');
    // Reset local HEAD back to the seed so pullBrain sees us "behind", not equal.
    await git.writeRef({ fs, dir, ref: 'refs/heads/main', value: seedSha, force: true });
    await git.checkout({ fs, dir, ref: 'main', force: true });
    expect(fs.readFileSync(lessonsPath(), 'utf-8')).toBe('- shared\n');

    fetchOverride = async () => {
      await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: theirsSha!, force: true });
    };

    const result = await pullBrain({ dir, url: 'https://example.invalid/brain.git', token: 'x' });
    expect(result.merged).toBe(false);
    expect(fs.readFileSync(lessonsPath(), 'utf-8')).toBe('- shared\n- theirs-continued\n');

    const headSha = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    expect(headSha).toBe(theirsSha);
  });

  it('is a no-op when our history already matches the remote exactly', async () => {
    const seedSha = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    fetchOverride = async () => {
      await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: seedSha, force: true });
    };

    const result = await pullBrain({ dir, url: 'https://example.invalid/brain.git', token: 'x' });
    expect(result.merged).toBe(false);
    expect(fs.readFileSync(lessonsPath(), 'utf-8')).toBe('- shared\n');
  });

  it('a single-owner file (voice.md) keeps "theirs" on divergence, never unions both sides', async () => {
    fs.writeFileSync(path.join(dir, '.atelier', 'memory', 'voice.md'), 'OUR VOICE');
    await commitAll(dir, 'add voice');

    await git.branch({ fs, dir, ref: 'theirs-branch' });
    fs.writeFileSync(path.join(dir, '.atelier', 'memory', 'voice.md'), 'OUR VOICE EDITED');
    const oursSha = await commitAll(dir, 'ours: edit voice');

    await git.checkout({ fs, dir, ref: 'theirs-branch' });
    fs.writeFileSync(path.join(dir, '.atelier', 'memory', 'voice.md'), 'THEIR VOICE EDITED');
    const theirsSha = await commitAll(dir, 'theirs: edit voice');

    await git.checkout({ fs, dir, ref: 'main' });

    fetchOverride = async () => {
      await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: theirsSha!, force: true });
    };

    const result = await pullBrain({ dir, url: 'https://example.invalid/brain.git', token: 'x' });
    expect(result.merged).toBe(true);
    const voiceContent = fs.readFileSync(path.join(dir, '.atelier', 'memory', 'voice.md'), 'utf-8');
    // Default preference is 'theirs' — single-owner files never union.
    expect(voiceContent).toBe('THEIR VOICE EDITED');
    expect(voiceContent).not.toContain('OUR VOICE EDITED');

    const headSha = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const { commit } = await git.readCommit({ fs, dir, oid: headSha });
    expect(commit.parent.sort()).toEqual([oursSha, theirsSha].sort());
  });
});

describe('remirrorImportedDocsForScope — pull-triggered docs/ reconciliation', () => {
  let clientsRoot: string;
  let dir: string;
  let memory: MemoryManager;
  const clientId = 'acme';
  const scope = clientScope(clientId);

  beforeEach(async () => {
    clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-pull-clientsroot-'));
    setClientsRoot(clientsRoot);
    dir = clientPaths(clientId).rootDir;
    fs.mkdirSync(dir, { recursive: true });
    await git.init({ fs, dir, defaultBranch: 'main' });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'keep.md'), '# Keep\nStays around.');
    fs.writeFileSync(path.join(dir, 'docs', 'deleted-soon.md'), '# Will be deleted\nGone soon.');
    await commitAll(dir, 'seed docs');
    memory = new MemoryManager(':memory:');
  });

  afterEach(() => {
    memory.close();
    fetchOverride = null;
    setClientsRoot('');
    fs.rmSync(clientsRoot, { recursive: true, force: true });
  });

  it('a pull that removes a docs/ file also removes its atelier-memory fact, with no manual re-import', async () => {
    const bridge = new AtelierMemoryBridge(memory);
    const before = await bridge.mirrorDocsDir(path.join(dir, 'docs'), scope, 'docs/');
    expect(before.files).toBe(2);
    const subjectsBefore = memory
      .getFactsByCategory('atelier-memory')
      .map((f) => f.subject)
      .sort();
    expect(subjectsBefore).toEqual(['docs/deleted-soon.md', 'docs/keep.md']);

    await git.branch({ fs, dir, ref: 'theirs-branch' });
    await git.checkout({ fs, dir, ref: 'theirs-branch' });
    fs.rmSync(path.join(dir, 'docs', 'deleted-soon.md'));
    const theirsSha = await commitAll(dir, 'theirs: delete deleted-soon.md');
    expect(theirsSha).toBeTruthy();
    await git.checkout({ fs, dir, ref: 'main', force: true });

    fetchOverride = async () => {
      await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: theirsSha!, force: true });
    };

    const result = await pullBrain({ dir, url: 'https://example.invalid/brain.git', token: 'x' });
    expect(result.merged).toBe(false);
    expect(fs.existsSync(path.join(dir, 'docs', 'deleted-soon.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'docs', 'keep.md'))).toBe(true);

    await remirrorImportedDocsForScope(memory, clientId);

    const subjectsAfter = memory
      .getFactsByCategory('atelier-memory')
      .map((f) => f.subject)
      .sort();
    expect(subjectsAfter).toEqual(['docs/keep.md']);
  });

  it('is a no-op for a client that has never imported docs (no docs/ dir on disk)', async () => {
    fs.rmSync(path.join(dir, 'docs'), { recursive: true, force: true });
    await expect(remirrorImportedDocsForScope(memory, clientId)).resolves.toBeUndefined();
    expect(memory.getFactsByCategory('atelier-memory')).toEqual([]);
  });

  it('is a no-op for the world scope (docs-import is client-only)', async () => {
    const bridge = new AtelierMemoryBridge(memory);
    await bridge.mirrorDocsDir(path.join(dir, 'docs'), scope, 'docs/');
    const before = memory.getFactsByCategory('atelier-memory').length;

    await remirrorImportedDocsForScope(memory, 'world');

    expect(memory.getFactsByCategory('atelier-memory').length).toBe(before);
  });

  it('is a no-op when memory is null', async () => {
    await expect(remirrorImportedDocsForScope(null, clientId)).resolves.toBeUndefined();
  });
});
