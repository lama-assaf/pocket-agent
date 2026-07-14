// src/clients/sync.ts
// Token-authed git transport for world + client brains. isomorphic-git is
// pure-JS (bundles cleanly in Electron, no native module) and does
// clone/pull/commit/push with a token — unlike the marketplace's unauthenticated
// read-only tarball fetch, which can't touch private, read-write client repos.
//
// Memory files are append-mostly: lessons.md and decisions/ are append-only logs
// where concurrent operators almost never truly collide, so a diverged pull is
// reconciled by UNIONING lines rather than surfacing a raw git conflict marker.
// Single-owner files (voice.md, guardrails/) take a plain "keep theirs / keep
// yours" resolution instead.

import fs from 'fs';
import path from 'path';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

export interface GitIdentity {
  name: string;
  email: string;
}

export interface SyncOptions {
  dir: string;
  url: string;
  token: string;
  ref?: string;
  author?: GitIdentity;
}

/** Which side wins for a single-owner file when both sides changed it. */
export type SingleOwnerPreference = 'theirs' | 'ours';

const DEFAULT_AUTHOR: GitIdentity = { name: 'Pocket Agent', email: 'agent@pocket.local' };

/** GitHub token auth: token as username with a throwaway password. */
function authFor(token: string): { username: string; password: string } {
  return { username: token, password: 'x-oauth-basic' };
}

// ── Pure reconciliation helpers (unit-tested; no git/fs) ─────────────────────

/**
 * True for append-only memory logs (lessons.md, decisions/*), where merging by
 * line-union is safe and correct. Path is relative to the repo root.
 */
export function isAppendOnly(relPath: string): boolean {
  const norm = relPath.split(path.sep).join('/');
  const base = norm.split('/').pop() ?? norm;
  return base === 'lessons.md' || norm.includes('/decisions/') || norm.startsWith('decisions/');
}

/**
 * True for single-owner files (voice.md, enabled-agents.md, enabled-mcp.md,
 * anything under guardrails/), edited rarely and by one owner — resolved by
 * keeping one whole side, never unioned. Enablement files represent current
 * on/off state (like voice.md), not an accumulating log (like lessons.md) —
 * unioning both sides on divergence would leave stale, contradictory
 * enabled/disabled lines for the same subject.
 */
export function isSingleOwner(relPath: string): boolean {
  const norm = relPath.split(path.sep).join('/');
  const base = norm.split('/').pop() ?? norm;
  return (
    base === 'voice.md' ||
    base === 'enabled-agents.md' ||
    base === 'enabled-mcp.md' ||
    norm.includes('guardrails/') ||
    norm.startsWith('guardrails/')
  );
}

/**
 * Union two versions of an append-only log: keep every distinct non-empty line,
 * in order, "ours" first then any new "theirs" lines. Trailing newline preserved.
 * This is the whole "append-mostly keeps live safe" property in one function.
 */
export function unionAppendOnly(ours: string, theirs: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const block of [ours, theirs]) {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\s+$/, '');
      const key = line.trim();
      if (key.length === 0) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out.length ? out.join('\n') + '\n' : '';
}

/**
 * Reconcile one file's two sides by class: append-only → union; single-owner →
 * keep the preferred side; anything else defaults to the append-safe union.
 * Returns the merged content to write to the working tree.
 */
export function reconcileFile(
  relPath: string,
  ours: string,
  theirs: string,
  prefer: SingleOwnerPreference = 'theirs'
): string {
  if (ours === theirs) return ours;
  if (isSingleOwner(relPath)) return prefer === 'ours' ? ours : theirs;
  if (isAppendOnly(relPath)) return unionAppendOnly(ours, theirs);
  // Unknown memory file: default to the append-safe union so nothing is lost.
  return unionAppendOnly(ours, theirs);
}

// ── Git I/O ──────────────────────────────────────────────────────────────────

/** Clone a repo with token auth. Fresh checkout of `ref` (default the repo HEAD). */
export async function cloneBrain(opts: SyncOptions): Promise<void> {
  fs.mkdirSync(opts.dir, { recursive: true });
  await git.clone({
    fs,
    http,
    dir: opts.dir,
    url: opts.url,
    ...(opts.ref ? { ref: opts.ref } : {}),
    singleBranch: true,
    onAuth: () => authFor(opts.token),
  });
}

/** True when `dir` is an initialized git working tree. */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    await git.resolveRef({ fs, dir, ref: 'HEAD' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage every change (adds, mods, deletes) and commit. Returns the new commit
 * sha, or null when the working tree was already clean (nothing to commit).
 */
export async function commitAll(
  dir: string,
  message: string,
  author: GitIdentity = DEFAULT_AUTHOR
): Promise<string | null> {
  const staged = await stageAllChanges(dir);
  if (staged === 0) return null;
  return git.commit({ fs, dir, message, author });
}

/**
 * Stage every changed path (adds, mods, deletes), skipping unmodified files.
 * statusMatrix rows are `[filepath, head, workdir, stage]`; a file is unchanged
 * only when head===1 && workdir===1 && stage===1. Returns the number staged.
 */
async function stageAllChanges(dir: string): Promise<number> {
  const matrix = await git.statusMatrix({ fs, dir });
  let staged = 0;
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue; // unmodified
    if (workdir === 0) await git.remove({ fs, dir, filepath });
    else await git.add({ fs, dir, filepath });
    staged++;
  }
  return staged;
}

/**
 * Pull with token auth. Tries a fast-forward first (the common append-only
 * case); on divergence, reconciles known memory files in the working tree
 * (append-only union / single-owner preference), commits the merge, and returns
 * `merged: true`. `push` the result afterward.
 */
export async function pullBrain(
  opts: SyncOptions & { prefer?: SingleOwnerPreference }
): Promise<{ merged: boolean }> {
  const author = opts.author ?? DEFAULT_AUTHOR;
  const ref = opts.ref ?? (await git.currentBranch({ fs, dir: opts.dir })) ?? 'main';

  await git.fetch({
    fs,
    http,
    dir: opts.dir,
    url: opts.url,
    ref,
    singleBranch: true,
    onAuth: () => authFor(opts.token),
  });

  const remoteRef = `refs/remotes/origin/${ref}`;
  const theirs = await git.resolveRef({ fs, dir: opts.dir, ref: remoteRef });
  const ours = await git.resolveRef({ fs, dir: opts.dir, ref: 'HEAD' });
  if (theirs === ours) return { merged: false };

  // Fast-forward when our HEAD is an ancestor of theirs.
  if (await isAncestor(opts.dir, ours, theirs)) {
    await git.writeRef({ fs, dir: opts.dir, ref: `refs/heads/${ref}`, value: theirs, force: true });
    await git.checkout({ fs, dir: opts.dir, ref, force: true });
    return { merged: false };
  }

  // Diverged: reconcile file-by-file, then record a two-parent merge commit.
  await reconcileWorkingTree(opts.dir, ours, theirs, opts.prefer ?? 'theirs');
  await stageAllChanges(opts.dir);
  await git.commit({
    fs,
    dir: opts.dir,
    message: `Merge origin/${ref} (append-mostly reconcile)`,
    author,
    parent: [ours, theirs],
  });
  return { merged: true };
}

/** Push the current branch with token auth. */
export async function pushBrain(opts: SyncOptions): Promise<void> {
  const ref = opts.ref ?? (await git.currentBranch({ fs, dir: opts.dir })) ?? 'main';
  await git.push({
    fs,
    http,
    dir: opts.dir,
    url: opts.url,
    ref,
    onAuth: () => authFor(opts.token),
  });
}

/** Whether `oldSha` is an ancestor of `newSha` (i.e. a fast-forward is possible). */
async function isAncestor(dir: string, oldSha: string, newSha: string): Promise<boolean> {
  try {
    return await git.isDescendent({ fs, dir, oid: newSha, ancestor: oldSha, depth: -1 });
  } catch {
    return false;
  }
}

/**
 * Reconcile the working tree against the remote commit `theirs`, merging each
 * changed memory file by class. Reads "their" blob from the fetched commit tree
 * and the current working-tree content as "ours".
 */
async function reconcileWorkingTree(
  dir: string,
  ours: string,
  theirs: string,
  prefer: SingleOwnerPreference
): Promise<void> {
  const theirFiles = await listCommitFiles(dir, theirs);
  const ourFiles = await listCommitFiles(dir, ours);
  const all = new Set<string>([...theirFiles.keys(), ...ourFiles.keys()]);

  for (const rel of all) {
    const abs = path.join(dir, rel);
    const theirContent = theirFiles.get(rel) ?? null;
    // Prefer the live working-tree content as "ours" (may have uncommitted edits).
    let ourContent = ourFiles.get(rel) ?? null;
    try {
      ourContent = fs.readFileSync(abs, 'utf-8');
    } catch {
      /* file may not exist on our side */
    }

    if (theirContent === null && ourContent === null) continue;
    if (theirContent === null) continue; // only ours has it — keep as is
    if (ourContent === null) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, theirContent, 'utf-8');
      continue;
    }
    const merged = reconcileFile(rel, ourContent, theirContent, prefer);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, merged, 'utf-8');
  }
}

/** Read all blob paths+contents from a commit tree into a map (text files). */
async function listCommitFiles(dir: string, oid: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const filepaths = await git.listFiles({ fs, dir, ref: oid });
  for (const rel of filepaths) {
    try {
      const { blob } = await git.readBlob({ fs, dir, oid, filepath: rel });
      out.set(rel, Buffer.from(blob).toString('utf-8'));
    } catch {
      /* skip unreadable blob */
    }
  }
  return out;
}
