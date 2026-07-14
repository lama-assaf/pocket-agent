import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import git from 'isomorphic-git';
import {
  isAppendOnly,
  isSingleOwner,
  unionAppendOnly,
  reconcileFile,
  commitAll,
  isRepo,
} from '../../src/clients/sync';

describe('sync file classification', () => {
  it('classifies append-only logs', () => {
    expect(isAppendOnly('.atelier/memory/lessons.md')).toBe(true);
    expect(isAppendOnly('.atelier/memory/decisions/2024-01-01.md')).toBe(true);
    expect(isAppendOnly('.atelier/memory/voice.md')).toBe(false);
  });

  it('classifies single-owner files', () => {
    expect(isSingleOwner('.atelier/memory/voice.md')).toBe(true);
    expect(isSingleOwner('guardrails/banned-words.md')).toBe(true);
    expect(isSingleOwner('.atelier/memory/lessons.md')).toBe(false);
  });

  it('classifies enablement files (enabled-agents.md / enabled-mcp.md) as single-owner', () => {
    expect(isSingleOwner('.atelier/memory/enabled-agents.md')).toBe(true);
    expect(isSingleOwner('.atelier/memory/enabled-mcp.md')).toBe(true);
    expect(isAppendOnly('.atelier/memory/enabled-agents.md')).toBe(false);
    expect(isAppendOnly('.atelier/memory/enabled-mcp.md')).toBe(false);
  });
});

describe('unionAppendOnly', () => {
  it('keeps every distinct line, ours first then new theirs', () => {
    const ours = '- a\n- b\n';
    const theirs = '- b\n- c\n';
    expect(unionAppendOnly(ours, theirs)).toBe('- a\n- b\n- c\n');
  });

  it('dedups identical concurrent appends (no double entries)', () => {
    const ours = '- shared\n- mine\n';
    const theirs = '- shared\n- yours\n';
    expect(unionAppendOnly(ours, theirs)).toBe('- shared\n- mine\n- yours\n');
  });

  it('ignores blank lines and trailing whitespace', () => {
    expect(unionAppendOnly('- a  \n\n', '\n- a\n- b\n')).toBe('- a\n- b\n');
  });

  it('returns empty string for two empty inputs', () => {
    expect(unionAppendOnly('', '')).toBe('');
  });
});

describe('reconcileFile', () => {
  it('unions append-only logs so no operator loses a lesson', () => {
    const merged = reconcileFile('.atelier/memory/lessons.md', '- ours\n', '- theirs\n');
    expect(merged).toBe('- ours\n- theirs\n');
  });

  it('single-owner defaults to keeping theirs', () => {
    expect(reconcileFile('.atelier/memory/voice.md', 'ours voice', 'theirs voice')).toBe(
      'theirs voice'
    );
  });

  it('single-owner can keep ours when preferred', () => {
    expect(reconcileFile('guardrails/banned-words.md', 'ours', 'theirs', 'ours')).toBe('ours');
  });

  it('identical sides are returned unchanged (no spurious merge)', () => {
    expect(reconcileFile('.atelier/memory/lessons.md', '- same\n', '- same\n')).toBe('- same\n');
  });

  it('unknown memory files default to the append-safe union', () => {
    expect(reconcileFile('.atelier/memory/glossary.md', '- a\n', '- b\n')).toBe('- a\n- b\n');
  });
});

describe('git plumbing (commitAll / isRepo)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
    await git.init({ fs, dir, defaultBranch: 'main' });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('isRepo is false before any commit, true after', async () => {
    expect(await isRepo(dir)).toBe(false);
    fs.mkdirSync(path.join(dir, '.atelier', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.atelier', 'memory', 'lessons.md'), '- first\n');
    const sha = await commitAll(dir, 'seed');
    expect(sha).toBeTruthy();
    expect(await isRepo(dir)).toBe(true);
  });

  it('commitAll stages adds, then returns null on a clean tree', async () => {
    fs.writeFileSync(path.join(dir, 'lessons.md'), '- a\n');
    const first = await commitAll(dir, 'add lessons');
    expect(first).toBeTruthy();
    // Nothing changed since the last commit → nothing to commit.
    expect(await commitAll(dir, 'noop')).toBeNull();
  });

  it('commitAll stages deletions', async () => {
    const file = path.join(dir, 'voice.md');
    fs.writeFileSync(file, 'brand voice');
    await commitAll(dir, 'add voice');
    fs.rmSync(file);
    const sha = await commitAll(dir, 'remove voice');
    expect(sha).toBeTruthy();
    const files = await git.listFiles({ fs, dir, ref: 'HEAD' });
    expect(files).not.toContain('voice.md');
  });
});
