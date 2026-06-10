/**
 * Pulse log — persistence for proactive check-ins ("Pulse") and daily briefs.
 * Used for dedup (don't repeat a topic within a week) and daily-cap accounting.
 */

import type Database from 'better-sqlite3';

export type PulseKind = 'checkin' | 'brief';

export interface PulseEntry {
  id: number;
  session_id: string;
  kind: PulseKind;
  content: string;
  created_at: string;
}

/**
 * Record a delivered pulse (check-in or daily brief) for a session.
 * `now` is injectable for deterministic tests.
 */
export function recordPulse(
  db: Database.Database,
  sessionId: string,
  kind: PulseKind,
  content: string,
  now: Date = new Date()
): number {
  const result = db
    .prepare('INSERT INTO pulse_log (session_id, kind, content, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, kind, content, now.toISOString());
  return Number(result.lastInsertRowid);
}

/**
 * Get pulses delivered to a session within the last `days` days (newest first).
 */
export function getRecentPulses(
  db: Database.Database,
  sessionId: string,
  days: number = 7,
  now: Date = new Date()
): PulseEntry[] {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return db
    .prepare(
      `SELECT id, session_id, kind, content, created_at
       FROM pulse_log
       WHERE session_id = ? AND created_at >= ?
       ORDER BY created_at DESC`
    )
    .all(sessionId, cutoff) as PulseEntry[];
}

/**
 * Count pulses of a kind delivered since `sinceIso` across ALL sessions.
 * Callers pass local midnight (as ISO) to implement the global per-day cap.
 */
export function countPulsesSince(db: Database.Database, kind: PulseKind, sinceIso: string): number {
  const row = db
    .prepare('SELECT COUNT(*) as c FROM pulse_log WHERE kind = ? AND created_at >= ?')
    .get(kind, sinceIso) as { c: number };
  return row.c;
}

/**
 * Count pulses of a kind delivered to one session since `sinceIso`.
 * Used to gate the daily brief to once per session per day.
 */
export function countSessionPulsesSince(
  db: Database.Database,
  sessionId: string,
  kind: PulseKind,
  sinceIso: string
): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) as c FROM pulse_log WHERE session_id = ? AND kind = ? AND created_at >= ?'
    )
    .get(sessionId, kind, sinceIso) as { c: number };
  return row.c;
}
