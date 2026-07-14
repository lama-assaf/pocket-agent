#!/usr/bin/env node
/**
 * Pre-test check for native modules.
 *
 * better-sqlite3 is used by both Electron and the Node-based Vitest suite.
 * The Electron runtime and local Node can have different native module ABIs,
 * so a postinstall/electron launch can leave the addon compiled for Electron.
 * Before tests, make sure it loads (and can actually open a database) in the
 * current Node runtime.
 *
 * Uses the same real (open-a-database) check as check-native.cjs — see
 * native-check-lib.cjs's doc comment for why a bare require() is not enough
 * — and a per-ABI binary cache (native-cache.cjs) so switching back from
 * Electron is a fast file copy instead of a full native rebuild.
 */

const { execSync } = require('child_process');
const { canOpenBetterSqlite } = require('./native-check-lib.cjs');
const { restoreFromCache, saveToCache } = require('./native-cache.cjs');

const abi = process.versions.modules;
let result = canOpenBetterSqlite();

if (result.ok) {
  console.log('[check-native-node] better-sqlite3 OK for Node');
  saveToCache(abi); // opportunistic — cheap no-op once already cached
  process.exit(0);
}

if (!result.abiMismatch) {
  console.log(`[check-native-node] Check inconclusive: ${result.message}`);
  process.exit(0);
}

console.log('[check-native-node] better-sqlite3 needs rebuild for Node...');

if (restoreFromCache(abi)) {
  result = canOpenBetterSqlite();
  if (result.ok) {
    console.log('[check-native-node] Restored matching build from cache — no rebuild needed');
    process.exit(0);
  }
}

console.log('[check-native-node] No usable cached build — rebuilding...');
execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
result = canOpenBetterSqlite();
if (!result.ok) {
  console.error('[check-native-node] Rebuild did not fix it:', result.message);
  process.exit(1);
}
saveToCache(abi);
console.log('[check-native-node] Rebuild complete, verified, and cached');
