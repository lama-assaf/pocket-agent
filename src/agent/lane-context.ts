/**
 * Lane context — composes per-lane operator rules for injection into the
 * system prompt. Rules come from marketplace packs (Atelier/Salon) via the
 * registry, which already de-dupes identical rule content (by hash) across
 * packs and lane rule-dirs (e.g. social pulls in brand + copy + common).
 */

import type { LaneId } from '../marketplace/types';
import { rulesForLane, skillsForLane } from '../marketplace/registry';

export function composeLaneRules(lane: LaneId): string {
  const rules = rulesForLane(lane);
  if (!rules.length) return '';
  const body = rules.map((r) => `### ${r.lane}/${r.filename}\n${r.content}`).join('\n\n');
  return `## Operator rules (${lane} lane)\nThese hold across every output in this lane.\n\n${body}`;
}

/**
 * Format the lane's available skills as a name+description list (not full
 * body) for injection into the system prompt. Full skill content loads
 * on-demand via the `skill` tool (see chat-tools.ts buildLaneSkillTool).
 */
export function formatLaneSkills(lane: LaneId): string {
  const skills = skillsForLane(lane);
  if (!skills.length) return '';
  return skills.map((s) => `- **${s.name}**: ${s.description}`).join('\n');
}

// Ported from atelier/salon scripts/hooks/prompt-context.js KEYWORDS.
// Intentionally a seed of the most common keywords, not full parity with the
// original hook scripts — extending coverage is a documented follow-up.
const KEYWORDS: Record<string, string[]> = {
  'design review': ['skill:design-review', 'rule:spacing', 'rule:type'],
  accessibility: ['skill:accessibility-audit', 'rule:accessibility'],
  a11y: ['skill:accessibility-audit', 'rule:accessibility'],
  wcag: ['skill:accessibility-audit', 'rule:accessibility'],
  'dark mode': ['skill:dark-mode-pairing'],
  prd: ['skill:prd-writing', 'rule:prd-structure'],
  jtbd: ['skill:jtbd-framing', 'rule:jtbd'],
  metric: ['skill:metric-design', 'rule:metrics'],
  'brand voice': ['skill:brand-voice-extraction', 'rule:voice'],
  tagline: ['skill:tagline-writing'],
  positioning: ['skill:positioning-statement'],
  campaign: ['skill:campaign-brief'],
  thread: ['skill:x-thread'],
  linkedin: ['skill:linkedin-post'],
};

/**
 * Keyword-triggered context injector — when the user's message matches a
 * known keyword, surface the FULL text of the relevant lane skill/rule into
 * the system prompt (ported from Atelier/Salon's prompt-context hook).
 */
export function buildLaneContextInjection(userMessage: string, lane: LaneId): string {
  const msg = userMessage.toLowerCase();
  const refs = new Set<string>();
  for (const [kw, targets] of Object.entries(KEYWORDS))
    if (msg.includes(kw)) targets.forEach((t) => refs.add(t));
  if (!refs.size) return '';

  const skills = skillsForLane(lane);
  const rules = rulesForLane(lane);
  const parts: string[] = [];
  for (const ref of refs) {
    const [kind, key] = ref.split(':');
    if (kind === 'skill') {
      const s = skills.find((x) => x.name === key);
      if (s) parts.push(`### skill: ${s.name}\n${s.content}`);
    } else if (kind === 'rule') {
      const r = rules.find((x) => x.filename.includes(key));
      if (r) parts.push(`### rule: ${r.filename}\n${r.content}`);
    }
  }
  if (!parts.length) return '';
  return `## Relevant to this request (auto-surfaced)\n\n${parts.join('\n\n')}`;
}
