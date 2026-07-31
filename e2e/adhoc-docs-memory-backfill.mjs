// e2e/adhoc-docs-memory-backfill.mjs
// Ad-hoc, one-off standalone runner (not part of the committed spec suite):
// backfills memory/vector ingestion for docs that were already copied + git
// committed by a prior standalone run of e2e/adhoc-docs-import-run.mjs (which
// used ingestToMemory:false because no live Electron MemoryManager was
// available). Memory-only — does NOT touch the file copy, secret scan, or
// git steps (docs are already on disk and committed).
//
// Opens a direct better-sqlite3 connection to the real app DB (safe because
// the Electron app is confirmed quit — no SingletonLock, no process — so
// there's no write race) and builds a minimal AtelierBridgeMemory adapter
// straight over src/memory/facts.ts's plain functions (electron-free),
// instead of the full MemoryManager class — MemoryManager transitively
// imports src/memory/summarizer.ts -> src/settings (which does
// `import { safeStorage } from 'electron'` at module top level), which only
// resolves inside the real Electron runtime, not plain Node.
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { AtelierMemoryBridge } from '../dist/memory/atelier-bridge.js';
import { clientScope } from '../dist/memory/scope.js';
import { setClientsRoot, clientPaths } from '../dist/clients/paths.js';
import {
  createFactsCache,
  saveFact as _saveFact,
  getFactsByCategory as _getFactsByCategory,
  deleteFact as _deleteFact,
} from '../dist/memory/facts.js';
import { backfillMissingEmbeddings } from '../dist/memory/semantic.js';

const REAL_USER_DATA = path.join(os.homedir(), 'Library/Application Support/pocket-agent');
const REAL_DB_PATH = path.join(REAL_USER_DATA, 'pocket-agent.db');
setClientsRoot(path.join(REAL_USER_DATA, 'clients'));

const db = new Database(REAL_DB_PATH);
db.pragma('journal_mode = WAL');
const factsCache = createFactsCache();

/** Minimal AtelierBridgeMemory adapter over the real DB's facts table. */
const memoryAdapter = {
  saveFact: (category, subject, content, sensitive, scope) =>
    _saveFact(db, category, subject, content, factsCache, sensitive, scope),
  getFactsByCategory: (category) => _getFactsByCategory(db, category),
  deleteFact: (id) => _deleteFact(db, id, factsCache),
};

const bridge = new AtelierMemoryBridge(memoryAdapter);
const clientIds = ['zilliqa', 'ltin'];

for (const clientId of clientIds) {
  const docsRoot = path.join(clientPaths(clientId).rootDir, 'docs');
  const scope = clientScope(clientId);
  console.log(`\n=== mirrorDocsDir(${clientId}) ===`);
  console.log(`docsRoot: ${docsRoot}`);
  console.log(`scope: ${scope}`);
  const result = await bridge.mirrorDocsDir(docsRoot, scope, 'docs/');
  console.log(`files mirrored: ${result.files}`);
}

// mirrorDocsDir's saveFact calls trigger embedding fire-and-forget
// (embedFactAsync) — explicitly await backfillMissingEmbeddings on the SAME
// connection so the script never exits before every new row's embedding BLOB
// has actually been computed and persisted.
console.log('\n=== awaiting embedding backfill for any rows still missing one ===');
await backfillMissingEmbeddings(db);
db.close();
console.log('Embedding backfill complete.');
