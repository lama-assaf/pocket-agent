/**
 * Routing decision log — queryable record of every mode-switch, skill-load,
 * and specialist-spawn attempt (both accepted and rejected), so a misroute is
 * diagnosable after the fact instead of only visible in a live console.
 *
 * Same append-only, JSON-lines, one-file-per-day design as src/utils/audit-log.ts
 * (see that module's doc for the rationale — never touches the app's SQLite
 * connection, atomic appends, cheap day-sharded rotation) and reuses its root
 * configuration (setAuditLogRoot()/AUDIT_LOG_ROOT_OVERRIDE) so this needs no
 * separate wiring: wherever the audit log is configured, this is too.
 */

import fs from 'fs';
import path from 'path';
import { getAuditLogRoot } from './audit-log';

/** What kind of routing decision this entry records. */
export type RoutingKind = 'mode_switch' | 'skill_load' | 'subagent_spawn';

export interface RoutingLogEntry {
  /** ISO-8601 UTC timestamp. */
  ts: string;
  /** App session id the decision happened under (best-effort; 'default' if unknown). */
  sessionId: string;
  kind: RoutingKind;
  /** The mode id / skill name / specialist name that was requested. */
  target: string;
  /** Lane active at decision time, when relevant (skill/specialist dispatch). */
  lane?: string;
  outcome: 'accepted' | 'rejected';
  /** Corrective/explanatory detail — populated on 'rejected', optional on 'accepted'. */
  detail?: string;
}

function todayFileName(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `routing-${y}-${m}-${d}.jsonl`;
}

/**
 * Append one routing-decision entry to today's log file. Never throws — a
 * logging failure must never break the routing/dispatch path it observes.
 * No-op when no audit-log root is configured (same degrade-silently contract
 * as appendAuditLog).
 */
export function recordRoutingDecision(entry: Omit<RoutingLogEntry, 'ts'>): void {
  const root = getAuditLogRoot();
  if (!root) return;
  try {
    fs.mkdirSync(root, { recursive: true });
    const full: RoutingLogEntry = { ts: new Date().toISOString(), ...entry };
    fs.appendFileSync(path.join(root, todayFileName()), JSON.stringify(full) + '\n', 'utf-8');
  } catch (e) {
    console.error('[RoutingLog] Failed to append entry:', e);
  }
}

/**
 * Fetch the most recent `limit` routing-decision entries, newest first. Scans
 * today's file backward, then earlier day-files, same traversal as
 * getRecentAuditLogEntries. Returns [] when unconfigured or no logs exist yet.
 */
export function getRecentRoutingLogEntries(limit: number = 100): RoutingLogEntry[] {
  const root = getAuditLogRoot();
  if (!root) return [];

  let files: string[];
  try {
    files = fs
      .readdirSync(root)
      .filter((f) => /^routing-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  const entries: RoutingLogEntry[] = [];
  for (const file of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(root, file), 'utf-8').split('\n').filter(Boolean);
    } catch {
      continue;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        entries.push(JSON.parse(lines[i]) as RoutingLogEntry);
      } catch {
        // Skip a malformed line rather than aborting the whole read.
      }
      if (entries.length >= limit) return entries;
    }
  }
  return entries;
}
