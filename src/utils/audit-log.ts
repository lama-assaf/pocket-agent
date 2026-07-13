/**
 * Write-audit log — native equivalent of upstream Atelier/Salon's
 * scripts/hooks/post-write.js, extended to cover fact writes too.
 *
 * Append-only, JSON-lines, one file per calendar day (local time):
 *   <root>/audit-YYYY-MM-DD.jsonl
 *
 * JSON-lines-per-day was chosen over a SQLite table for three reasons: (1) it
 * never touches the app's SQLite connection/schema/migrations — a logging
 * failure can't corrupt or lock the primary DB; (2) `fs.appendFileSync` is a
 * single atomic OS-level append, so concurrent writers (scheduler, chat
 * turns, agent tool calls) can't interleave partial writes the way a
 * check-then-insert SQL pattern might without extra locking; (3) day-sharded
 * files give natural, cheap rotation/retention (delete old files) without a
 * DELETE+VACUUM cycle. Entries are read back oldest-file-last so recent
 * activity is cheap to fetch without scanning the whole history.
 *
 * Every recorded entry stores a short content digest (sha256 prefix + byte
 * length), never the raw content — so the log itself can never leak secrets
 * or full fact/file bodies, only "what changed, roughly how much, when, by
 * what tool, in what scope."
 *
 * Like src/utils/transformers-env.ts, this module stays Electron-free (no
 * `app.getPath` import) so it has zero Electron runtime dependency and unit
 * tests never need a mock. The root directory must be explicitly configured
 * via `setAuditLogRoot()` (production: the Electron main process, once at
 * startup) or `AUDIT_LOG_ROOT_OVERRIDE` (tests); until then, logging is a
 * silent no-op. This is a deliberate difference from
 * src/marketplace/paths.ts / src/clients/paths.ts (which fall back to a
 * dev-local directory): those roots hold durable, load-bearing data that
 * must exist somewhere even in dev, while the audit log is pure
 * observability whose absence is harmless — defaulting it to a dev-local
 * directory would silently write real files on every `saveFact`/`write` call
 * made by the hundreds of unit tests that construct a MemoryManager or call
 * the chat-tools write wrapper directly, none of which configure a root.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type AuditLogTool = 'write' | 'edit' | 'saveFact' | 'updateFact';

export interface AuditLogEntry {
  /** ISO-8601 UTC timestamp. */
  ts: string;
  /** App session id the write happened under (best-effort; 'default' if unknown). */
  sessionId: string;
  /** Active memory scope/context at write time (e.g. 'user', 'world', 'client:acme'), or null if unresolved. */
  scope: string | null;
  /** Which write path produced this entry. */
  tool: AuditLogTool;
  /** File path (write/edit) or `scope:category/subject` (saveFact/updateFact). */
  target: string;
  /** Short content digest — never the raw content. See digestContent(). */
  digest: string;
}

let auditLogRootOverride: string | null = null;

/** Called once by the Electron main process at startup with `<userData>/audit-logs`. */
export function setAuditLogRoot(dir: string): void {
  auditLogRootOverride = dir;
}

/**
 * Runtime-canonical audit-log dir, or null when unconfigured (logging is a
 * no-op in that case — see module doc). Resolution order:
 * AUDIT_LOG_ROOT_OVERRIDE (tests) → value injected by main via
 * setAuditLogRoot() (production).
 */
export function getAuditLogRoot(): string | null {
  return process.env.AUDIT_LOG_ROOT_OVERRIDE || auditLogRootOverride || null;
}

/**
 * Short, non-reversible content digest: first 12 hex chars of a sha256 hash,
 * plus the byte length — enough to detect/correlate identical or
 * near-identical writes without ever storing recoverable content.
 */
export function digestContent(content: string): string {
  const hash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 12);
  return `sha256:${hash}:${Buffer.byteLength(content, 'utf-8')}b`;
}

function todayFileName(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `audit-${y}-${m}-${d}.jsonl`;
}

/**
 * Append one entry to today's log file. Never throws — a logging failure
 * must never break the write/fact path it's observing (mirrors upstream
 * post-write.js's "never let a hook crash the harness" policy). No-op when
 * no root is configured.
 */
export function appendAuditLog(entry: Omit<AuditLogEntry, 'ts'>): void {
  const root = getAuditLogRoot();
  if (!root) return;
  try {
    fs.mkdirSync(root, { recursive: true });
    const full: AuditLogEntry = { ts: new Date().toISOString(), ...entry };
    fs.appendFileSync(path.join(root, todayFileName()), JSON.stringify(full) + '\n', 'utf-8');
  } catch (e) {
    console.error('[AuditLog] Failed to append entry:', e);
  }
}

/**
 * Fetch the most recent `limit` entries, newest first. Scans today's file
 * backward, then earlier day-files (sorted by filename, which sorts
 * chronologically) until `limit` is satisfied or history is exhausted.
 * Malformed lines are skipped. Returns [] when unconfigured or no logs exist
 * yet — this is what makes "log survives across sessions" verifiable: the
 * data lives entirely on disk, so a fresh process reading the same root sees
 * every prior entry with no in-memory state to lose.
 */
export function getRecentAuditLogEntries(limit: number = 100): AuditLogEntry[] {
  const root = getAuditLogRoot();
  if (!root) return [];

  let files: string[];
  try {
    files = fs
      .readdirSync(root)
      .filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .reverse(); // most recent day first
  } catch {
    return [];
  }

  const entries: AuditLogEntry[] = [];
  for (const file of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(root, file), 'utf-8').split('\n').filter(Boolean);
    } catch {
      continue;
    }
    // Within a file, later lines are more recent — walk backward.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        entries.push(JSON.parse(lines[i]) as AuditLogEntry);
      } catch {
        // Skip a malformed line rather than aborting the whole read.
      }
      if (entries.length >= limit) return entries;
    }
  }
  return entries;
}
