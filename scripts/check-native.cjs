#!/usr/bin/env node
/**
 * Pre-launch check for native modules.
 * Ensures better-sqlite3 is compiled for Electron's Node ABI (NODE_MODULE_VERSION).
 *
 * The check must actually OPEN a database, not just `require('better-sqlite3')`
 * — see native-check-lib.cjs's doc comment for why a bare require never
 * catches an ABI mismatch (better-sqlite3 lazy-loads its native binding
 * inside the Database constructor). A per-ABI binary cache (native-cache.cjs)
 * makes switching back from `npm test` a fast file copy instead of a full
 * native rebuild.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { restoreFromCache, saveToCache } = require('./native-cache.cjs');

const testScript = path.join(__dirname, '_test-sqlite.cjs');
const electronPath = path.join(__dirname, '../node_modules/.bin/electron');

const CHECK_SCRIPT = `
  const { canOpenBetterSqlite } = require('./native-check-lib.cjs');
  const result = canOpenBetterSqlite();
  if (result.ok) {
    process.exit(0);
  } else {
    console.error(result.message);
    process.exit(1);
  }
`;

function verifyUnderElectron() {
  fs.writeFileSync(testScript, CHECK_SCRIPT);
  try {
    execSync(`${electronPath} ${testScript}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, stderr: error.stderr || error.message || '' };
  } finally {
    try {
      fs.unlinkSync(testScript);
    } catch {}
  }
}

function electronModulesAbi() {
  try {
    return execSync(`${electronPath} -e "console.log(process.versions.modules)"`, {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }).trim();
  } catch {
    return null; // Can't ask Electron directly — cache lookup is skipped, not fatal.
  }
}

const first = verifyUnderElectron();
if (first.ok) {
  console.log('[check-native] better-sqlite3 OK for Electron');
  const abi = electronModulesAbi();
  if (abi) saveToCache(abi); // opportunistic — cheap no-op once already cached
  process.exit(0);
}

if (!(first.stderr.includes('NODE_MODULE_VERSION') || first.stderr.includes('was compiled against'))) {
  // Some other error (Electron itself failed to launch, sandbox/display issue
  // in a headless env, etc.) — not something a rebuild would fix, so don't
  // block the launch on it, but make it visible.
  console.log('[check-native] Check inconclusive, continuing...', first.stderr);
  process.exit(0);
}

console.log('[check-native] better-sqlite3 needs rebuild for Electron...');

const abi = electronModulesAbi();
if (abi && restoreFromCache(abi) && verifyUnderElectron().ok) {
  console.log('[check-native] Restored matching build from cache — no rebuild needed');
  process.exit(0);
}

console.log('[check-native] No usable cached build — rebuilding...');
try {
  execSync('npx electron-rebuild -f -w better-sqlite3', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
} catch (rebuildError) {
  console.error('[check-native] Rebuild failed:', rebuildError.message);
  process.exit(1);
}

const second = verifyUnderElectron();
if (!second.ok) {
  console.error('[check-native] Rebuild complete but still mismatched:', second.stderr);
  process.exit(1);
}
console.log('[check-native] Rebuild complete and verified');
if (abi) saveToCache(abi);
