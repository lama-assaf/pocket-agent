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
 *
 * IMPORTANT: every check below runs in a FRESH child `node` process, never
 * a second require()/Database() call in THIS process. A native addon can't
 * be safely hot-swapped once dlopen'd — after this process's first
 * require('better-sqlite3') touches the addon (even a failed/mismatched
 * one), swapping the underlying .node file on disk and requiring it again
 * IN-PROCESS can crash the whole process instead of throwing a clean JS
 * error (observed: a bare SIGKILL with no stack trace when the first
 * version of this script restored a cached build and re-verified in-process).
 * Spawning a fresh process per check — exactly what check-native.cjs already
 * does via Electron — sidesteps this entirely.
 */

const { execSync } = require('child_process');
const path = require('path');
const { restoreFromCache, saveToCache } = require('./native-cache.cjs');

const CHECK_SCRIPT = path.join(__dirname, '_test-sqlite-node.cjs');

function verifyInChildProcess() {
  try {
    execSync(`node ${JSON.stringify(CHECK_SCRIPT)}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      cwd: path.join(__dirname, '..'),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, stderr: error.stderr || error.message || '' };
  }
}

const abi = process.versions.modules;
let result = verifyInChildProcess();

if (result.ok) {
  console.log('[check-native-node] better-sqlite3 OK for Node');
  saveToCache(abi); // opportunistic — cheap no-op once already cached
  process.exit(0);
}

const isAbiMismatch =
  result.stderr.includes('NODE_MODULE_VERSION') ||
  result.stderr.includes('was compiled against') ||
  result.stderr.includes('Module did not self-register');

if (!isAbiMismatch) {
  console.log(`[check-native-node] Check inconclusive: ${result.stderr}`);
  process.exit(0);
}

console.log('[check-native-node] better-sqlite3 needs rebuild for Node...');

if (restoreFromCache(abi)) {
  result = verifyInChildProcess();
  if (result.ok) {
    console.log('[check-native-node] Restored matching build from cache — no rebuild needed');
    process.exit(0);
  }
}

console.log('[check-native-node] No usable cached build — rebuilding...');
execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
result = verifyInChildProcess();
if (!result.ok) {
  console.error('[check-native-node] Rebuild did not fix it:', result.stderr);
  process.exit(1);
}
saveToCache(abi);
console.log('[check-native-node] Rebuild complete, verified, and cached');
