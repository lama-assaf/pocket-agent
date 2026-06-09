/**
 * Memory export: dump everything the agent remembers (facts, soul, daily logs,
 * rollups) as JSON or human-readable Markdown so the user can inspect and keep
 * their own copy. Embeddings are intentionally excluded from the export.
 */

import type Database from 'better-sqlite3';
import type { Fact } from './facts';
import type { SoulAspect } from './soul';
import type { DailyLog, DailyLogRollup } from './daily-logs';

export interface MemoryExport {
  exportedAt: string;
  facts: Fact[];
  soul: SoulAspect[];
  dailyLogs: DailyLog[];
  rollups: DailyLogRollup[];
}

/**
 * Collect all memory into a plain, serializable object (no embeddings).
 */
export function exportMemory(db: Database.Database): MemoryExport {
  const facts = db
    .prepare(
      `SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
       FROM facts ORDER BY category, subject`
    )
    .all() as Fact[];

  const soul = db
    .prepare('SELECT id, aspect, content, created_at, updated_at FROM soul ORDER BY aspect')
    .all() as SoulAspect[];

  const dailyLogs = db
    .prepare('SELECT id, date, content, updated_at FROM daily_logs ORDER BY date DESC')
    .all() as DailyLog[];

  const rollups = db
    .prepare(
      `SELECT id, period_type, period_start, period_end, content, created_at
       FROM daily_log_rollups ORDER BY period_start DESC`
    )
    .all() as DailyLogRollup[];

  return {
    exportedAt: new Date().toISOString(),
    facts,
    soul,
    dailyLogs,
    rollups,
  };
}

/**
 * Render a memory export as Markdown.
 */
export function exportMemoryMarkdown(data: MemoryExport): string {
  const lines: string[] = [];
  lines.push('# Pocket Agent Memory Export');
  lines.push(`_Exported ${data.exportedAt}_`);
  lines.push('');

  lines.push('## Facts');
  if (data.facts.length === 0) {
    lines.push('_None_');
  } else {
    let currentCategory = '';
    for (const f of data.facts) {
      if (f.category !== currentCategory) {
        currentCategory = f.category;
        lines.push(`\n### ${currentCategory}`);
      }
      lines.push(f.subject ? `- **${f.subject}**: ${f.content}` : `- ${f.content}`);
    }
  }
  lines.push('');

  lines.push('## Soul');
  if (data.soul.length === 0) {
    lines.push('_None_');
  } else {
    for (const s of data.soul) {
      lines.push(`\n### ${s.aspect}`);
      lines.push(s.content);
    }
  }
  lines.push('');

  lines.push('## Daily Logs');
  if (data.dailyLogs.length === 0) {
    lines.push('_None_');
  } else {
    for (const l of data.dailyLogs) {
      lines.push(`\n### ${l.date}`);
      lines.push(l.content);
    }
  }
  lines.push('');

  lines.push('## Earlier (Rollups)');
  if (data.rollups.length === 0) {
    lines.push('_None_');
  } else {
    for (const r of data.rollups) {
      const label =
        r.period_type === 'week'
          ? `Week of ${r.period_start}`
          : `${r.period_start.slice(0, 7)} (month)`;
      lines.push(`\n### ${label} (${r.period_start}..${r.period_end})`);
      lines.push(r.content);
    }
  }

  return lines.join('\n');
}
