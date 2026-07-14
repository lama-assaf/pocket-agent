#!/usr/bin/env node
/**
 * Shared ABI-validation helper for better-sqlite3, used by both
 * check-native.cjs (Electron) and check-native-node.cjs (Node/vitest).
 *
 * IMPORTANT: `require('better-sqlite3')` alone NEVER exercises the native
 * binding — better-sqlite3's lib/database.js only calls
 * `require('bindings')('better_sqlite3.node')` lazily, inside the Database
 * constructor. A bare `require()` check reports "OK" even when the compiled
 * addon's NODE_MODULE_VERSION doesn't match the running runtime, because the
 * mismatch only throws once a Database is actually constructed. That bug let
 * `[check-native] better-sqlite3 OK` pass right before a real ABI-mismatch
 * crash. Always validate by opening a real (in-memory) database.
 */

function canOpenBetterSqlite() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAbiMismatch =
      message.includes('NODE_MODULE_VERSION') ||
      message.includes('was compiled against') ||
      message.includes('Module did not self-register');
    return { ok: false, abiMismatch: isAbiMismatch, message };
  }
}

module.exports = { canOpenBetterSqlite };
