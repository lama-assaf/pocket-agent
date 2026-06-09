import { describe, it, expect, vi } from 'vitest';

// Avoid loading the heavy embeddings model during these tests.
vi.mock('../../src/memory/semantic', () => ({
  embedRollup: vi.fn(async () => {}),
  embedFactAsync: vi.fn(),
  embedSoulAspectAsync: vi.fn(),
}));

import Database from 'better-sqlite3';
import {
  getISOWeek,
  rollUpDailyLogs,
  getDailyLogOnThisDay,
  pruneOldDailyLogs,
} from '../../src/memory/daily-logs';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
    );
    CREATE TABLE daily_log_rollups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_type TEXT NOT NULL CHECK(period_type IN ('week', 'month')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
    );
  `);
  return db;
}

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('getISOWeek', () => {
  it('groups days in the same ISO week under the same Monday start', () => {
    // 2024-01-03 is a Wednesday; week starts Mon 2024-01-01
    const wed = getISOWeek('2024-01-03');
    const fri = getISOWeek('2024-01-05');
    expect(wed.start).toBe('2024-01-01');
    expect(wed.end).toBe('2024-01-07');
    expect(fri.start).toBe(wed.start);
    expect(fri.key).toBe(wed.key);
  });

  it('separates days in different weeks', () => {
    const w1 = getISOWeek('2024-01-05');
    const w2 = getISOWeek('2024-01-12');
    expect(w1.key).not.toBe(w2.key);
  });
});

describe('rollUpDailyLogs (before prune)', () => {
  it('creates a week rollup for old logs and leaves the raw rows until pruned', async () => {
    const db = makeDb();
    const oldDate = dateNDaysAgo(10);
    const olderDate = dateNDaysAgo(11);
    db.prepare('INSERT INTO daily_logs (date, content) VALUES (?, ?)').run(oldDate, 'worked on demo');
    db.prepare('INSERT INTO daily_logs (date, content) VALUES (?, ?)').run(
      olderDate,
      'fixed sleep schedule'
    );

    const summarizer = vi.fn(async () => '- demo work\n- sleep fix');
    const created = await rollUpDailyLogs(db, summarizer);

    expect(created).toBeGreaterThanOrEqual(1);
    expect(summarizer).toHaveBeenCalled();

    const rollups = db
      .prepare("SELECT * FROM daily_log_rollups WHERE period_type = 'week'")
      .all() as Array<{ content: string }>;
    expect(rollups.length).toBe(1);
    expect(rollups[0]!.content).toContain('demo');

    // Raw rows still present before prune
    const before = (db.prepare('SELECT COUNT(*) c FROM daily_logs').get() as { c: number }).c;
    expect(before).toBe(2);

    // Now prune — raw rows gone, rollup persists
    pruneOldDailyLogs(db, 3);
    const after = (db.prepare('SELECT COUNT(*) c FROM daily_logs').get() as { c: number }).c;
    expect(after).toBe(0);
    const rollupsAfter = (
      db.prepare('SELECT COUNT(*) c FROM daily_log_rollups').get() as { c: number }
    ).c;
    expect(rollupsAfter).toBe(1);
  });

  it('is idempotent — re-running does not duplicate the same week rollup', async () => {
    const db = makeDb();
    db.prepare('INSERT INTO daily_logs (date, content) VALUES (?, ?)').run(
      dateNDaysAgo(10),
      'something'
    );
    const summarizer = vi.fn(async () => 'summary');
    await rollUpDailyLogs(db, summarizer);
    await rollUpDailyLogs(db, summarizer);
    const count = (
      db.prepare("SELECT COUNT(*) c FROM daily_log_rollups WHERE period_type='week'").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });
});

describe('getDailyLogOnThisDay', () => {
  it('returns retained logs from a prior year matching today month-day', () => {
    const db = makeDb();
    const today = new Date();
    const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const lastYear = `${today.getFullYear() - 1}-${md}`;
    db.prepare('INSERT INTO daily_logs (date, content) VALUES (?, ?)').run(
      lastYear,
      'a year ago today'
    );
    const { logs } = getDailyLogOnThisDay(db);
    expect(logs.some((l) => l.date === lastYear)).toBe(true);
  });
});
