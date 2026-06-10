/**
 * Pulse — proactive check-ins. Scans a session's calendar, tasks, memory, and
 * daily logs for things genuinely worth messaging the user about, and composes
 * a judgment prompt with a HEARTBEAT_OK escape so silence stays the default.
 *
 * Pure-ish: db and clock are injected; no LLM calls happen here.
 */

import type Database from 'better-sqlite3';
import { HEARTBEAT_OK } from '../utils/heartbeat';
import { getDailyLog } from '../memory/daily-logs';
import { getRecentPulses, type PulseEntry } from '../memory/pulse-log';
import { formatForSqlite } from './calendar';

/** Look-ahead window for upcoming calendar events and due tasks. */
const LOOKAHEAD_HOURS = 48;

/** Days a fact must be untouched before Pulse may bring it up. */
const STALE_FACT_DAYS = 14;

/** Skip check-ins when the user messaged this session within this window. */
const ACTIVE_CONVERSATION_MINUTES = 15;

export interface CalendarSignal {
  id: number;
  title: string;
  start_time: string;
  location: string | null;
}

export interface TaskSignal {
  id: number;
  title: string;
  due_date: string | null;
  priority: string;
  status: string;
  overdue: boolean;
}

export interface FactSignal {
  id: number;
  subject: string;
  content: string;
}

export interface PulseSignals {
  sessionId: string;
  upcomingEvents: CalendarSignal[];
  dueTasks: TaskSignal[];
  staleCommitments: FactSignal[];
  yesterdayLog: string | null;
  recentPulses: PulseEntry[];
}

/**
 * Quiet-hours gate. Hours are local (0-23). Supports windows that wrap
 * midnight (e.g. 22 → 8). start === end means no quiet hours.
 */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** ISO timestamp of local midnight for `now` — the start of "today" for caps. */
export function localDayStartIso(now: Date): string {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return midnight.toISOString();
}

/**
 * Active-conversation suppression: true when the user sent a message in this
 * session within the last ACTIVE_CONVERSATION_MINUTES — don't interrupt a
 * live conversation with a proactive nudge.
 */
export function isConversationActive(
  db: Database.Database,
  sessionId: string,
  now: Date = new Date()
): boolean {
  const cutoff = new Date(now.getTime() - ACTIVE_CONVERSATION_MINUTES * 60_000).toISOString();
  const recent = db
    .prepare(
      `SELECT id FROM messages
       WHERE session_id = ? AND role = 'user' AND timestamp > ?
       LIMIT 1`
    )
    .get(sessionId, cutoff) as { id: number } | undefined;
  return recent !== undefined;
}

/**
 * Unanswered-pulse backoff: true when the most recent check-in delivered to
 * this session got NO user message afterwards. In that case the user is being
 * ignored (or is away) and we should stay quiet until they speak again.
 * Both timestamps are ISO-8601 with 'Z', so string comparison is safe.
 */
export function wasLastPulseIgnored(db: Database.Database, sessionId: string): boolean {
  const lastPulse = db
    .prepare(
      `SELECT created_at FROM pulse_log
       WHERE session_id = ? AND kind = 'checkin'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(sessionId) as { created_at: string } | undefined;
  if (!lastPulse) return false;

  const reply = db
    .prepare(
      `SELECT id FROM messages
       WHERE session_id = ? AND role = 'user' AND timestamp > ?
       LIMIT 1`
    )
    .get(sessionId, lastPulse.created_at) as { id: number } | undefined;
  return reply === undefined;
}

/** True when there is at least one actionable signal worth an LLM judgment call. */
export function hasPulseSignals(signals: PulseSignals): boolean {
  return (
    signals.upcomingEvents.length > 0 ||
    signals.dueTasks.length > 0 ||
    signals.staleCommitments.length > 0 ||
    signals.yesterdayLog !== null
  );
}

/**
 * Collect per-session signals for a pulse judgment. Calendar events and tasks
 * are scoped to the session; facts and daily logs are global memory.
 */
export function gatherPulseSignals(
  db: Database.Database,
  sessionId: string,
  now: Date = new Date()
): PulseSignals {
  // Stored timestamps vary in format ('Z' suffix, space vs 'T'), so compare
  // via datetime(replace(x,'Z','')) like the reminder checker in ./calendar.
  const nowSqlite = formatForSqlite(now);
  const horizonSqlite = formatForSqlite(new Date(now.getTime() + LOOKAHEAD_HOURS * 3_600_000));

  // Calendar events starting within the look-ahead window
  const upcomingEvents = db
    .prepare(
      `SELECT id, title, start_time, location
       FROM calendar_events
       WHERE session_id = ?
         AND datetime(replace(start_time, 'Z', '')) >= datetime(?)
         AND datetime(replace(start_time, 'Z', '')) <= datetime(?)
       ORDER BY start_time ASC
       LIMIT 10`
    )
    .all(sessionId, nowSqlite, horizonSqlite) as CalendarSignal[];

  // Open tasks due within the window, or already overdue
  const taskRows = db
    .prepare(
      `SELECT id, title, due_date, priority, status,
              CASE WHEN datetime(replace(due_date, 'Z', '')) < datetime(?) THEN 1 ELSE 0 END as overdue
       FROM tasks
       WHERE session_id = ?
         AND status != 'completed'
         AND due_date IS NOT NULL
         AND datetime(replace(due_date, 'Z', '')) <= datetime(?)
       ORDER BY due_date ASC
       LIMIT 10`
    )
    .all(nowSqlite, sessionId, horizonSqlite) as Array<
    Omit<TaskSignal, 'overdue'> & { overdue: number }
  >;
  const dueTasks: TaskSignal[] = taskRows.map((t) => ({ ...t, overdue: t.overdue === 1 }));

  // High-importance, non-sensitive facts that look like commitments and have
  // not been touched recently (same shape as memory resurfacing)
  const staleCutoff = new Date(now.getTime() - STALE_FACT_DAYS * 86_400_000).toISOString();
  const staleCommitments = db
    .prepare(
      `SELECT id, subject, content
       FROM facts
       WHERE COALESCE(sensitive, 0) = 0
         AND (last_accessed_at IS NULL OR last_accessed_at < ?)
         AND importance >= 70
       ORDER BY importance DESC
       LIMIT 5`
    )
    .all(staleCutoff) as FactSignal[];

  // Yesterday's daily log (open loops / loose ends)
  const yesterday = new Date(now.getTime() - 86_400_000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const yesterdayLog = getDailyLog(db, yesterdayKey)?.content ?? null;

  // Last 7 days of pulses for this session (dedup)
  const recentPulses = getRecentPulses(db, sessionId, 7, now);

  return { sessionId, upcomingEvents, dueTasks, staleCommitments, yesterdayLog, recentPulses };
}

function formatSignals(signals: PulseSignals): string {
  const sections: string[] = [];

  if (signals.upcomingEvents.length > 0) {
    const lines = signals.upcomingEvents.map(
      (e) => `- ${e.title} at ${e.start_time}${e.location ? ` (${e.location})` : ''}`
    );
    sections.push(`Upcoming calendar events (next 48h):\n${lines.join('\n')}`);
  }

  if (signals.dueTasks.length > 0) {
    const lines = signals.dueTasks.map(
      (t) =>
        `- [${t.priority}] ${t.title} — due ${t.due_date}${t.overdue ? ' (OVERDUE)' : ''} (status: ${t.status})`
    );
    sections.push(`Open tasks due soon or overdue:\n${lines.join('\n')}`);
  }

  if (signals.staleCommitments.length > 0) {
    const lines = signals.staleCommitments.map(
      (f) => `- ${f.subject ? `${f.subject}: ` : ''}${f.content}`
    );
    sections.push(`Important remembered facts not discussed recently:\n${lines.join('\n')}`);
  }

  if (signals.yesterdayLog) {
    sections.push(`Yesterday's activity log:\n${signals.yesterdayLog.slice(0, 1500)}`);
  }

  return sections.join('\n\n');
}

function formatRecentPulses(recentPulses: PulseEntry[]): string {
  if (recentPulses.length === 0) return '';
  const lines = recentPulses.map((p) => `- (${p.created_at.slice(0, 10)}) ${p.content}`);
  return `\n\nYou already messaged the user about these in the last 7 days — do NOT repeat any of these topics:\n${lines.join('\n')}`;
}

/**
 * Build the check-in judgment prompt. The model must either produce ONE short
 * first-person message or reply HEARTBEAT_OK (the default outcome).
 */
export function composePulsePrompt(signals: PulseSignals): string {
  return (
    `You are a personal assistant deciding whether to proactively message your user right now. ` +
    `Below are signals from their calendar, tasks, and memory.\n\n` +
    `${formatSignals(signals)}` +
    `${formatRecentPulses(signals.recentPulses)}\n\n` +
    `Is there ONE thing here genuinely worth proactively messaging the user about right now — ` +
    `an imminent deadline, an unkept commitment, or something they'd regret missing? ` +
    `Be very selective: most of the time nothing clears the bar.\n\n` +
    `If something does, write ONE short, warm, first-person message (max 2 sentences). ` +
    `Be specific and natural; no markdown, no preamble.\n` +
    `If nothing clears the bar, reply with only ${HEARTBEAT_OK}.`
  );
}

/**
 * Build the daily brief prompt. Unlike check-ins, the brief always produces
 * output (it is its own opt-in feature with its own once-per-day gate).
 */
export function composeDailyBriefPrompt(signals: PulseSignals): string {
  const body = formatSignals(signals);
  return (
    `Write a short morning brief for your user as their personal assistant, in first person. ` +
    `Cover: today's calendar, tasks due soon or overdue, and any loose ends from yesterday. ` +
    `Keep it under 6 lines, plain text, no markdown headers. ` +
    `If a section has nothing, skip it; if everything is clear, say the day looks clear.\n\n` +
    `${body || '(no calendar events, due tasks, or recent activity on record)'}`
  );
}
