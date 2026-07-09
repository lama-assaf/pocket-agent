// src/marketplace/sync.ts
// Seeds bundled pack content on first run and updates it from the og GitHub repos.
// Depends only on the PackSource *type* + paths — NOT on the registry. PackSyncManager
// receives its sources via the constructor so this module stays self-contained and testable.
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import * as tar from 'tar';
import type { PackSource } from './types';
import { getPluginsRoot, getSeedRoot } from './paths';

/** Copy the bundled seed into pluginsRoot/<id> if that pack is not yet installed. Returns true if copied. */
export function installSeed(seedRoot: string, pluginsRoot: string, id: string): boolean {
  const dest = path.join(pluginsRoot, id);
  if (fs.existsSync(dest)) return false; // already installed — never clobber a user's copy
  const src = path.join(seedRoot, id);
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

/** Latest commit sha for repo/branch via GitHub API (unauthenticated; 60 req/hr is plenty). */
export async function latestSha(repo: string, branch: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'pocket-agent' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

/** Download+extract the repo tarball into destDir (strips the top-level <repo>-<sha>/ folder). */
export async function updatePack(source: PackSource, destDir: string): Promise<void> {
  const url = `https://codeload.github.com/${source.repo}/tar.gz/refs/heads/${source.branch}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pocket-agent' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok || !res.body) throw new Error(`tarball fetch failed: ${res.status}`);
  const tmp = `${destDir}.incoming`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // Only extract the content dirs we use.
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    tar.x({
      cwd: tmp,
      strip: 1,
      filter: (p) =>
        /\/(agents|skills|commands|rules|memory)\/|\/(VERSION|\.claude-plugin\/plugin\.json)$/.test(
          `/${p}`,
        ),
    }),
  );
  // flatten .claude-plugin/plugin.json → plugin.json
  const nested = path.join(tmp, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(nested)) fs.copyFileSync(nested, path.join(tmp, 'plugin.json'));
  // Atomic-ish swap: keep the previous install as a backup until the new one is in place.
  const backup = `${destDir}.bak`;
  fs.rmSync(backup, { recursive: true, force: true });
  const hadOld = fs.existsSync(destDir);
  if (hadOld) fs.renameSync(destDir, backup);
  try {
    fs.renameSync(tmp, destDir);
  } catch (e) {
    if (hadOld) fs.renameSync(backup, destDir); // restore last good copy
    throw e;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}

export class PackSyncManager {
  constructor(private sources: PackSource[]) {}

  async ensureInstalled(): Promise<void> {
    const seed = getSeedRoot();
    const root = getPluginsRoot();
    fs.mkdirSync(root, { recursive: true });
    for (const s of this.sources) installSeed(seed, root, s.id);
  }

  async checkAndUpdate(): Promise<{ id: string; updated: boolean; sha: string }[]> {
    const root = getPluginsRoot();
    const out: { id: string; updated: boolean; sha: string }[] = [];
    for (const s of this.sources) {
      const dest = path.join(root, s.id);
      const shaFile = path.join(dest, '.sha');
      const remote = await latestSha(s.repo, s.branch);
      if (!remote) {
        out.push({ id: s.id, updated: false, sha: '' });
        continue;
      }
      const local = fs.existsSync(shaFile) ? fs.readFileSync(shaFile, 'utf-8').trim() : '';
      if (remote === local) {
        out.push({ id: s.id, updated: false, sha: remote });
        continue;
      }
      try {
        await updatePack(s, dest);
        fs.writeFileSync(shaFile, remote);
        out.push({ id: s.id, updated: true, sha: remote });
      } catch {
        out.push({ id: s.id, updated: false, sha: local }); // keep last good copy
      }
    }
    return out;
  }
}
