#!/usr/bin/env node
/**
 * Per-ABI binary cache for better-sqlite3's compiled addon.
 *
 * Electron and the local Node running Vitest use different native module
 * ABIs (NODE_MODULE_VERSION), but node-gyp only keeps ONE compiled copy in
 * node_modules/better-sqlite3/build/Release — so `npm run electron` and
 * `npm test` kept clobbering each other's build, forcing a full native
 * recompile every time you switched between them.
 *
 * This caches a copy of the compiled .node file per (ABI, platform, arch)
 * under node_modules/.native-cache/ once it's been built, so switching back
 * is a fast file copy instead of a rebuild. node_modules/ is already
 * gitignored, so the cache is never committed.
 */

const fs = require('fs');
const path = require('path');

const ADDON_PATH = path.join(
  __dirname,
  '..',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);

const CACHE_ROOT = path.join(__dirname, '..', 'node_modules', '.native-cache');

function cacheFileFor(abi) {
  return path.join(CACHE_ROOT, `better_sqlite3-abi${abi}-${process.platform}-${process.arch}.node`);
}

/**
 * Copy `src` to `dest` atomically: write to a sibling temp file, then
 * rename over the destination. A plain copyFileSync writes directly into
 * the destination inode, which can hand a partially-written (corrupt)
 * addon to any OTHER process that has that exact path open/mmap'd at the
 * same time (e.g. a real `npm run electron` dev instance still running
 * while this script restores the Node build for a test run) — that
 * process's next `dlopen`/read can then crash instead of cleanly throwing
 * an ABI-mismatch error. rename(2) on the same filesystem is atomic, so
 * every reader only ever sees either the old complete file or the new
 * complete file, never a partial one.
 */
function atomicCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

/** Copy a cached build for `abi` into place, if one exists. Returns true if restored. */
function restoreFromCache(abi) {
  const cached = cacheFileFor(abi);
  if (!fs.existsSync(cached)) return false;
  atomicCopy(cached, ADDON_PATH);
  return true;
}

/** Save the currently-built addon into the cache under `abi`, if it exists on disk. */
function saveToCache(abi) {
  if (!fs.existsSync(ADDON_PATH)) return false;
  atomicCopy(ADDON_PATH, cacheFileFor(abi));
  return true;
}

module.exports = { restoreFromCache, saveToCache, cacheFileFor, ADDON_PATH };
