#!/usr/bin/env node
/**
 * Pre-test check for native modules.
 *
 * better-sqlite3 is used by both Electron and the Node-based Vitest suite.
 * The Electron runtime and local Node can have different native module ABIs,
 * so a postinstall/electron launch can leave the addon compiled for Electron.
 * Before tests, make sure it loads in the current Node runtime and rebuild only
 * when needed.
 */

const { execSync } = require('child_process');

function canLoadBetterSqlite() {
  try {
    require('better-sqlite3');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('NODE_MODULE_VERSION') ||
      message.includes('was compiled against') ||
      message.includes('Module did not self-register')
    ) {
      console.log('[check-native-node] better-sqlite3 needs rebuild for Node...');
      return false;
    }

    console.log(`[check-native-node] Check inconclusive: ${message}`);
    return true;
  }
}

if (!canLoadBetterSqlite()) {
  execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
  require('better-sqlite3');
  console.log('[check-native-node] Rebuild complete');
} else {
  console.log('[check-native-node] better-sqlite3 OK');
}
