/**
 * Proactive memory resurfacing: occasionally select one relevant past memory
 * to volunteer to the user (e.g. "A month ago you were prepping your demo —
 * how'd it go?"). Selection is rate-limited and excludes sensitive facts.
 */

import type Database from 'better-sqlite3';
import { getDailyLogOnThisDay, getAllRollups } from './daily-logs';

export type ResurfaceCandidate =
  | { kind: 'on_this_day'; text: string; reference: string }
  | { kind: 'fact'; text: string; reference: string; factId: number }
  | { kind: 'rollup'; text: string; reference: string };

interface CandidateFactRow {
  id: number;
  subject: string;
  content: string;
  importance: number;
  last_accessed_at: string | null;
  created_at: string;
}

/**
 * Number of days a fact must be untouched before it's eligible to resurface.
 */
const STALE_FACT_DAYS = 14;

/**
 * Select at most one resurfacing candidate, or null when nothing is worth
 * surfacing. Scoring favors "on this day" anniversaries, then high-importance
 * facts that have not been accessed recently, then recent rollup topics.
 *
 * @param now injected clock for deterministic tests
 */
export function selectResurfaceCandidate(
  db: Database.Database,
  now: Date = new Date()
): ResurfaceCandidate | null {
  // 1. "On this day" — strongest signal when present
  const onThisDay = getDailyLogOnThisDay(db);
  if (onThisDay.rollups.length > 0) {
    const r = onThisDay.rollups[0]!;
    return {
      kind: 'on_this_day',
      text: r.content,
      reference: `${r.period_start}..${r.period_end}`,
    };
  }
  if (onThisDay.logs.length > 0) {
    const l = onThisDay.logs[0]!;
    return { kind: 'on_this_day', text: l.content, reference: l.date };
  }

  // 2. High-importance fact not accessed in a while (excluding sensitive)
  const staleCutoff = new Date(now.getTime() - STALE_FACT_DAYS * 86_400_000).toISOString();
  const facts = db
    .prepare(
      `SELECT id, subject, content, importance, last_accessed_at, created_at
       FROM facts
       WHERE COALESCE(sensitive, 0) = 0
         AND (last_accessed_at IS NULL OR last_accessed_at < ?)
       ORDER BY importance DESC
       LIMIT 20`
    )
    .all(staleCutoff) as CandidateFactRow[];

  if (facts.length > 0) {
    // Score by importance × recency-gap (days since last access)
    let best: CandidateFactRow | null = null;
    let bestScore = -1;
    for (const f of facts) {
      const ref = f.last_accessed_at ?? f.created_at;
      const gapDays = ref ? (now.getTime() - new Date(ref).getTime()) / 86_400_000 : 999;
      const score = (f.importance ?? 50) * Math.min(gapDays, 365);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    if (best) {
      return {
        kind: 'fact',
        text: best.subject ? `${best.subject}: ${best.content}` : best.content,
        reference: String(best.id),
        factId: best.id,
      };
    }
  }

  // 3. A topic from the most recent rollup
  const rollups = getAllRollups(db);
  if (rollups.length > 0) {
    const r = rollups[0]!;
    return { kind: 'rollup', text: r.content, reference: `${r.period_start}..${r.period_end}` };
  }

  return null;
}
