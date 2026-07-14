/**
 * "How to act" = the active client's behavioral memory, sourced from `facts`
 * rows (category `how_to_act`) rather than only the on-disk voice/guardrail
 * files. This is the single-source-of-truth for in-app edits: change a
 * `how_to_act` fact in the Memory Workbench and behavior shifts immediately —
 * no publish/pull round-trip.
 *
 * Files still matter: when a brain is pulled, its `.atelier/memory/*.md` and
 * `guardrails/` mirror INTO facts (atelier-bridge), so pulled files and in-app
 * edits merge through the same fact set. Callers layer these on top of the
 * marketplace pack + world rules — never replacing them.
 */

import { getMemoryManager } from '../tools/memory-tools';
import { getCurrentSessionId } from '../tools/session-context';
import { resolveVisibleScopes, scopeSpecificity } from '../memory/scope';
import type { SessionContext } from '../memory/sessions';
import type { Fact } from '../memory/facts';

/** Category that marks a fact as behavioral guidance (voice/guardrails/instincts). */
export const HOW_TO_ACT_CATEGORY = 'how_to_act';

/** Subject key whose content is a banned-words list for the tone guard. */
export const BANNED_WORDS_SUBJECT = 'banned_words';

/** Subject keys composed into the brand-voice injection (order is display order). */
export const VOICE_SUBJECT_ORDER = ['voice', 'tone', 'instincts'] as const;

/**
 * The `how_to_act` facts visible for the selected context, scoped so a brand
 * only ever reads its own behavior (client + world, plus project when active).
 * Personal contexts have no brand behavior and return []. Returns [] when no
 * memory store is wired (e.g. before init) so callers degrade to file-only.
 */
export function howToActFacts(context?: SessionContext): Fact[] {
  if (!context || context.contextType === 'personal') return [];
  const memory = getMemoryManager();
  if (!memory) return [];
  let scopes: string[];
  try {
    scopes = resolveVisibleScopes(context, getCurrentSessionId());
  } catch {
    return [];
  }
  const scopeSet = new Set(scopes);
  return memory
    .getAllFacts()
    .filter((f) => f.category === HOW_TO_ACT_CATEGORY && scopeSet.has(f.scope));
}

/**
 * Format the brand-voice/instincts injection from `how_to_act` facts (excluding
 * banned_words, which drives the tone guard, not the prompt). When the same
 * subject exists at multiple scopes, the nearer scope wins (a client's `voice`
 * overrides the agency's). Pure — safe to unit test with hand-built facts.
 */
export function formatBrandVoice(facts: Fact[]): string {
  const relevant = facts.filter((f) => f.subject !== BANNED_WORDS_SUBJECT);
  if (!relevant.length) return '';

  // Nearer scope wins for the same subject (client overrides world).
  const bySubject = new Map<string, Fact>();
  for (const f of relevant) {
    const prev = bySubject.get(f.subject);
    if (!prev || scopeSpecificity(f.scope) > scopeSpecificity(prev.scope)) {
      bySubject.set(f.subject, f);
    }
  }

  const rank = (subject: string): number => {
    const i = VOICE_SUBJECT_ORDER.indexOf(subject as (typeof VOICE_SUBJECT_ORDER)[number]);
    return i === -1 ? VOICE_SUBJECT_ORDER.length : i;
  };
  const entries = [...bySubject.values()].sort(
    (a, b) => rank(a.subject) - rank(b.subject) || a.subject.localeCompare(b.subject)
  );
  return entries
    .map((f) => (f.subject ? `- **${f.subject}**: ${f.content}` : `- ${f.content}`))
    .join('\n');
}

/** True when a `voice`-subject fact exists (so the file voice is redundant). */
export function hasVoiceFact(facts: Fact[]): boolean {
  return facts.some((f) => f.subject === 'voice');
}

/**
 * Banned words/phrases parsed from `how_to_act` facts with subject `banned_words`.
 * Content may be a comma- or newline-separated list (optionally bulleted). Pure.
 */
export function bannedWordsFromFacts(facts: Fact[]): string[] {
  const words = new Set<string>();
  for (const f of facts) {
    if (f.subject !== BANNED_WORDS_SUBJECT) continue;
    for (const raw of f.content.split(/[\n,]/)) {
      const w = raw
        .replace(/^[-*]\s*/, '')
        .replace(/`/g, '')
        .trim()
        .toLowerCase();
      if (w) words.add(w);
    }
  }
  return [...words];
}
