// e2e/adhoc-embed-remaining.mjs
// Ad-hoc, one-off standalone helper: awaits embedding completion for any
// facts rows still missing an embedding BLOB in the real app DB. Companion to
// adhoc-docs-memory-backfill.mjs, split out so a long-running embed pass can
// be resumed/retried independently of the (fast) mirror step.
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { backfillMissingEmbeddings } from '../dist/memory/semantic.js';

const REAL_USER_DATA = path.join(os.homedir(), 'Library/Application Support/pocket-agent');
const REAL_DB_PATH = path.join(REAL_USER_DATA, 'pocket-agent.db');
const db = new Database(REAL_DB_PATH);
db.pragma('journal_mode = WAL');
await backfillMissingEmbeddings(db);
db.close();
console.log('done');
