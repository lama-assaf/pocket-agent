import Database from 'better-sqlite3';
import type { Summarizer } from './summarizer';
import { embedRollup } from './semantic';

/** Hard character budget for daily logs injected into the system prompt (~700 tokens) */
export const DAILY_LOGS_CHAR_BUDGET = 2000;

/** Raw daily logs are kept for this many days before being pruned (after rollup). */
export const DAILY_LOGS_RETENTION_DAYS = 3;

export interface DailyLog {
  id: number;
  date: string;
  content: string;
  updated_at: string;
}

export interface DailyLogRollup {
  id: number;
  period_type: 'week' | 'month';
  period_start: string;
  period_end: string;
  content: string;
  created_at: string;
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
export function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get a daily log by date (defaults to today)
 */
export function getDailyLog(db: Database.Database, date?: string): DailyLog | null {
  const targetDate = date || getTodayDate();
  const row = db
    .prepare(
      `
      SELECT id, date, content, updated_at
      FROM daily_logs
      WHERE date = ?
    `
    )
    .get(targetDate) as DailyLog | undefined;

  return row || null;
}

/**
 * Append an entry to today's daily log
 * Creates the log if it doesn't exist
 */
export function appendToDailyLog(db: Database.Database, entry: string): DailyLog {
  const today = getTodayDate();
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const formattedEntry = `[${timestamp}] ${entry}`;

  const existing = getDailyLog(db, today);

  if (existing) {
    // Append to existing log
    const newContent = existing.content + '\n' + formattedEntry;
    db.prepare(
      `
        UPDATE daily_logs
        SET content = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
        WHERE date = ?
      `
    ).run(newContent, today);
  } else {
    // Create new log for today
    db.prepare(
      `
        INSERT INTO daily_logs (date, content, updated_at)
        VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')))
      `
    ).run(today, formattedEntry);
  }

  return getDailyLog(db, today)!;
}

/**
 * Get daily logs from the last N calendar days
 */
export function getDailyLogsSince(db: Database.Database, days: number = 3): DailyLog[] {
  // Compute the cutoff in local time (not UTC) so timezone doesn't shift the window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const year = cutoff.getFullYear();
  const month = String(cutoff.getMonth() + 1).padStart(2, '0');
  const day = String(cutoff.getDate()).padStart(2, '0');
  const cutoffDate = `${year}-${month}-${day}`;

  return db
    .prepare(
      `
      SELECT id, date, content, updated_at
      FROM daily_logs
      WHERE date >= ?
      ORDER BY date DESC
    `
    )
    .all(cutoffDate) as DailyLog[];
}

/**
 * Delete a daily log by ID
 */
export function deleteDailyLog(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM daily_logs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Prune daily logs older than N days.
 * Called on startup to keep the table clean — only the rolling window is retained.
 */
export function pruneOldDailyLogs(db: Database.Database, days: number = 3): number {
  // Compute cutoff in local time to match how dates are stored
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const year = cutoff.getFullYear();
  const month = String(cutoff.getMonth() + 1).padStart(2, '0');
  const day = String(cutoff.getDate()).padStart(2, '0');
  const cutoffDate = `${year}-${month}-${day}`;

  const result = db.prepare('DELETE FROM daily_logs WHERE date < ?').run(cutoffDate);
  if (result.changes > 0) {
    console.log(`[DailyLogs] Pruned ${result.changes} log(s) older than ${days} days`);
  }
  return result.changes;
}

/**
 * Get daily logs as formatted context string for the agent.
 * Truncates at DAILY_LOGS_CHAR_BUDGET and includes a usage header.
 * Prioritizes most recent logs (today first, then yesterday, etc.).
 */
export function getDailyLogsContext(db: Database.Database, days: number = 3): string {
  const logs = getDailyLogsSince(db, days);
  if (logs.length === 0) {
    return '';
  }

  // Reserve space for the header line
  const headerReserve = 90;
  const contentBudget = DAILY_LOGS_CHAR_BUDGET - headerReserve;

  // Show oldest first (reverse of DESC order from DB)
  const orderedLogs = logs.reverse();

  const includedLines: string[] = [];
  let usedChars = 0;

  for (const log of orderedLogs) {
    const dateLabel = log.date === getTodayDate() ? 'Today' : log.date;
    const logHeader = `\n### ${dateLabel}`;
    const logContent = log.content;
    const additionalChars = logHeader.length + 1 + logContent.length;

    if (usedChars + additionalChars > contentBudget) {
      // Try to include a truncated version of this log
      const remaining = contentBudget - usedChars - logHeader.length - 1;
      if (remaining > 50) {
        includedLines.push(logHeader);
        includedLines.push(logContent.slice(0, remaining) + '...');
      }
      break;
    }

    usedChars += additionalChars;
    includedLines.push(logHeader);
    includedLines.push(logContent);
  }

  // Build header
  const header = `## Recent Daily Logs`;

  return [header, ...includedLines].join('\n');
}

// ============ ISO week helpers ============

/** Parse a 'YYYY-MM-DD' string into a local-midnight Date. */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Format a Date as a local 'YYYY-MM-DD' string. */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Compute the ISO-8601 week key for a date: { year, week, start (Mon), end (Sun) }.
 * Weeks start on Monday; week 1 is the week containing the first Thursday.
 */
export function getISOWeek(dateStr: string): {
  key: string;
  start: string;
  end: string;
} {
  const date = parseLocalDate(dateStr);
  // Monday of this week
  const day = (date.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(date);
  monday.setDate(date.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  // ISO week number: Thursday of this week determines the year
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const isoYear = thursday.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstThursdayDay = (firstThursday.getDay() + 6) % 7;
  const firstMonday = new Date(firstThursday);
  firstMonday.setDate(firstThursday.getDate() - firstThursdayDay);
  const week = Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;

  return {
    key: `${isoYear}-W${String(week).padStart(2, '0')}`,
    start: formatLocalDate(monday),
    end: formatLocalDate(sunday),
  };
}

/** Compute the cutoff date string N days before today (local). */
function cutoffDateString(days: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return formatLocalDate(cutoff);
}

// ============ Rollups ============

/**
 * Roll up raw daily logs older than the retention window into durable weekly
 * summaries, then roll old weekly summaries into monthly ones. Each rollup is
 * summarized via the passed LLM `summarizer` and embedded for semantic recall.
 *
 * Must run BEFORE `pruneOldDailyLogs` so nothing valuable is lost.
 */
export async function rollUpDailyLogs(
  db: Database.Database,
  summarizer: Summarizer
): Promise<number> {
  let created = 0;
  const weekCutoff = cutoffDateString(DAILY_LOGS_RETENTION_DAYS);

  // 1. Group old raw logs by ISO week
  const oldLogs = db
    .prepare(
      'SELECT id, date, content, updated_at FROM daily_logs WHERE date < ? ORDER BY date ASC'
    )
    .all(weekCutoff) as DailyLog[];

  const byWeek = new Map<string, { start: string; end: string; logs: DailyLog[] }>();
  for (const log of oldLogs) {
    const { key, start, end } = getISOWeek(log.date);
    const group = byWeek.get(key) ?? { start, end, logs: [] };
    group.logs.push(log);
    byWeek.set(key, group);
  }

  for (const group of byWeek.values()) {
    // Skip if a week rollup already covers this period
    const existing = db
      .prepare("SELECT id FROM daily_log_rollups WHERE period_type = 'week' AND period_start = ?")
      .get(group.start) as { id: number } | undefined;
    if (existing) continue;

    const rawText = group.logs.map((l) => `## ${l.date}\n${l.content}`).join('\n\n');
    const prompt =
      `Summarize this week of journal entries into a concise digest (4-8 bullet points) ` +
      `capturing what the user did, decided, felt, and any ongoing threads. ` +
      `Be specific; preserve names and concrete details.\n\n${rawText}`;
    const summary = (await summarizer(prompt, 700)) || rawText.slice(0, 1500);

    const result = db
      .prepare(
        `INSERT INTO daily_log_rollups (period_type, period_start, period_end, content)
         VALUES ('week', ?, ?, ?)`
      )
      .run(group.start, group.end, summary);
    const rollupId = result.lastInsertRowid as number;
    await embedRollup(db, rollupId, summary);
    created++;
  }

  // 2. Roll weeks older than ~5 weeks into monthly summaries
  const monthCutoff = cutoffDateString(35);
  const oldWeeks = db
    .prepare(
      "SELECT id, period_start, period_end, content FROM daily_log_rollups WHERE period_type = 'week' AND period_end < ? ORDER BY period_start ASC"
    )
    .all(monthCutoff) as Array<{
    id: number;
    period_start: string;
    period_end: string;
    content: string;
  }>;

  const byMonth = new Map<
    string,
    { ids: number[]; contents: string[]; start: string; end: string }
  >();
  for (const wk of oldWeeks) {
    const month = wk.period_start.slice(0, 7); // YYYY-MM
    const group = byMonth.get(month) ?? {
      ids: [],
      contents: [],
      start: `${month}-01`,
      end: wk.period_end,
    };
    group.ids.push(wk.id);
    group.contents.push(wk.content);
    if (wk.period_end > group.end) group.end = wk.period_end;
    byMonth.set(month, group);
  }

  for (const [month, group] of byMonth) {
    const existing = db
      .prepare("SELECT id FROM daily_log_rollups WHERE period_type = 'month' AND period_start = ?")
      .get(group.start) as { id: number } | undefined;

    const weeksText = group.contents.join('\n\n');
    const prompt =
      `Summarize this month (${month}) of weekly digests into a concise monthly overview ` +
      `(5-10 bullet points): major themes, accomplishments, decisions, and ongoing threads.\n\n${weeksText}`;
    const summary = (await summarizer(prompt, 800)) || weeksText.slice(0, 1800);

    if (existing) {
      db.prepare('UPDATE daily_log_rollups SET content = ?, period_end = ? WHERE id = ?').run(
        summary,
        group.end,
        existing.id
      );
      await embedRollup(db, existing.id, summary);
    } else {
      const result = db
        .prepare(
          `INSERT INTO daily_log_rollups (period_type, period_start, period_end, content)
           VALUES ('month', ?, ?, ?)`
        )
        .run(group.start, group.end, summary);
      await embedRollup(db, result.lastInsertRowid as number, summary);
      created++;
    }

    // Consumed weekly rollups are now represented by the month rollup
    const placeholders = group.ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM daily_log_rollups WHERE id IN (${placeholders})`).run(...group.ids);
  }

  if (created > 0) {
    console.log(`[DailyLogs] Created ${created} rollup(s)`);
  }
  return created;
}

/**
 * Get all rollups (most recent first).
 */
export function getAllRollups(db: Database.Database): DailyLogRollup[] {
  return db
    .prepare(
      'SELECT id, period_type, period_start, period_end, content, created_at FROM daily_log_rollups ORDER BY period_start DESC'
    )
    .all() as DailyLogRollup[];
}

/**
 * Get a compact "Earlier" context string from the most recent rollups, within a budget.
 */
export function getRollupsForContext(db: Database.Database, budgetChars: number = 600): string {
  const rollups = getAllRollups(db);
  if (rollups.length === 0) return '';

  const includedLines: string[] = [];
  let usedChars = 0;
  for (const rollup of rollups) {
    const label =
      rollup.period_type === 'week'
        ? `Week of ${rollup.period_start}`
        : `${rollup.period_start.slice(0, 7)} (month)`;
    const header = `\n### ${label}`;
    const additionalChars = header.length + 1 + rollup.content.length;
    if (usedChars + additionalChars > budgetChars) break;
    usedChars += additionalChars;
    includedLines.push(header);
    includedLines.push(rollup.content);
  }

  if (includedLines.length === 0) return '';
  return ['## Earlier', ...includedLines].join('\n');
}

/**
 * Find rollups and retained raw logs whose period/date matches today's month-day
 * ("On This Day"). Returns the matching rollups plus any retained logs.
 */
export function getDailyLogOnThisDay(db: Database.Database): {
  rollups: DailyLogRollup[];
  logs: DailyLog[];
} {
  const today = getTodayDate();
  const monthDay = today.slice(5); // MM-DD

  const rollups = (
    db
      .prepare(
        'SELECT id, period_type, period_start, period_end, content, created_at FROM daily_log_rollups'
      )
      .all() as DailyLogRollup[]
  ).filter((r) => {
    if (r.period_end >= today) return false; // only past periods
    const startMd = r.period_start.slice(5);
    const endMd = r.period_end.slice(5);
    // Anniversary window: today's month-day falls within the rollup's month-day span
    return startMd <= endMd ? monthDay >= startMd && monthDay <= endMd : false;
  });

  const logs = (
    db.prepare('SELECT id, date, content, updated_at FROM daily_logs').all() as DailyLog[]
  ).filter((l) => l.date.slice(5) === monthDay && l.date < today);

  return { rollups, logs };
}

/**
 * Get memory usage stats for the daily logs budget.
 */
export function getDailyLogsMemoryUsage(
  db: Database.Database,
  days: number = 3
): {
  usedChars: number;
  budgetChars: number;
  pct: number;
} {
  const logs = getDailyLogsSince(db, days);

  const headerReserve = 90;
  const contentBudget = DAILY_LOGS_CHAR_BUDGET - headerReserve;
  let usedChars = 0;

  for (const log of logs.reverse()) {
    const dateLabel = log.date === getTodayDate() ? 'Today' : log.date;
    const logHeader = `\n### ${dateLabel}`;
    const additionalChars = logHeader.length + 1 + log.content.length;
    if (usedChars + additionalChars > contentBudget) {
      // Mirror getDailyLogsContext: count partial inclusion when truncated
      const remaining = contentBudget - usedChars - logHeader.length - 1;
      if (remaining > 50) {
        usedChars = contentBudget; // truncated content fills remaining budget
      }
      break;
    }
    usedChars += additionalChars;
  }

  const totalChars = usedChars + headerReserve;
  const pct = Math.round((totalChars / DAILY_LOGS_CHAR_BUDGET) * 100);
  return { usedChars: totalChars, budgetChars: DAILY_LOGS_CHAR_BUDGET, pct };
}
