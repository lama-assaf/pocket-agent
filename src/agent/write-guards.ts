/**
 * Write-path guards for marketplace operator packs.
 *
 * Ports Atelier/Salon's pre-write "anti-AI-tone / banned-words" hook natively
 * as a non-blocking scan run before writes/edits: it never rejects the write
 * itself (unless a hard-block setting is enabled elsewhere) — it just flags
 * generic-AI-tone or corporate-filler language so the agent (or user) can
 * revise before finalizing.
 */

import { allBannedAndToneRules } from '../marketplace/registry';

let cachedWords: string[] | null = null;

/** Extract banned words/phrases from the vendored banned-words rule (bullet or code list). */
function bannedWords(): string[] {
  if (cachedWords) return cachedWords;
  const words = new Set<string>();
  for (const r of allBannedAndToneRules()) {
    if (!/banned-words/.test(r.filename)) continue;
    for (const line of r.content.split('\n')) {
      const m = line.match(/^[-*]\s+`?([a-zA-Z][a-zA-Z '-]+)`?/);
      if (m) words.add(m[1].trim().toLowerCase());
    }
  }
  cachedWords = [...words];
  return cachedWords;
}

/**
 * Scan text for banned/AI-tone words extracted from the operator pack's
 * banned-words rule. Whole-word, case-insensitive matching.
 *
 * Returns `{ hits: [], warning: null }` for clean text.
 */
export function scanForBannedTone(text: string): { hits: string[]; warning: string | null } {
  const lower = text.toLowerCase();
  const hits = bannedWords().filter((w) =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)
  );
  if (!hits.length) return { hits: [], warning: null };
  return {
    hits,
    warning: `⚠️ tone guard: draft contains banned/AI-tone terms: ${hits.join(', ')}. Revise per the brand voice rules before finalizing.`,
  };
}
