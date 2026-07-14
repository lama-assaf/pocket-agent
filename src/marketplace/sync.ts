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

/**
 * Bump whenever `updatePack`'s tar filter starts extracting a new bucket
 * (e.g. `mcp-configs` was added 2026-07-13). Without this, a pack already
 * extracted by an older filter is stuck missing that bucket forever once
 * upstream's sha stops changing — `checkAndUpdate`'s plain sha-equality
 * check would see "already up to date" and skip re-extracting even though
 * the on-disk copy predates the newer filter. Installs from before this
 * constant existed have no `.extractor-version` file, which reads as `0`
 * (always < current), so every existing pack gets exactly one forced
 * re-sync the next time `checkAndUpdate` runs with network access.
 */
export const EXTRACTOR_VERSION = 1;

/** Filename (sibling to `.sha`) that records which EXTRACTOR_VERSION produced a pack's on-disk content. */
export const EXTRACTOR_VERSION_FILE = '.extractor-version';

/**
 * True when a pack needs re-syncing: its sha is stale, OR its on-disk copy
 * was extracted by an older filter than the one this app version uses (so a
 * bucket like `mcp-configs` may be silently missing even at a matching sha).
 * Pure — no I/O — so it's directly unit-testable without touching the network.
 */
export function needsPackUpdate(
  localSha: string,
  remoteSha: string,
  localExtractorVersion: number
): boolean {
  if (localExtractorVersion < EXTRACTOR_VERSION) return true;
  return localSha !== remoteSha;
}

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
        /\/(agents|skills|commands|rules|memory|mcp-configs)\/|\/(VERSION|\.claude-plugin\/plugin\.json)$/.test(
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
      const extractorFile = path.join(dest, EXTRACTOR_VERSION_FILE);
      const remote = await latestSha(s.repo, s.branch);
      if (!remote) {
        out.push({ id: s.id, updated: false, sha: '' });
        continue;
      }
      const local = fs.existsSync(shaFile) ? fs.readFileSync(shaFile, 'utf-8').trim() : '';
      const localExtractorVersion = fs.existsSync(extractorFile)
        ? parseInt(fs.readFileSync(extractorFile, 'utf-8').trim(), 10) || 0
        : 0;
      if (!needsPackUpdate(local, remote, localExtractorVersion)) {
        out.push({ id: s.id, updated: false, sha: remote });
        continue;
      }
      try {
        await updatePack(s, dest);
        fs.writeFileSync(shaFile, remote);
        fs.writeFileSync(extractorFile, String(EXTRACTOR_VERSION));
        out.push({ id: s.id, updated: true, sha: remote });
      } catch {
        out.push({ id: s.id, updated: false, sha: local }); // keep last good copy
      }
    }
    return out;
  }
}
