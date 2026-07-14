/**
 * Lane context — composes per-lane operator rules for injection into the
 * system prompt. Rules come from marketplace packs (Atelier/Salon) via the
 * registry, which already de-dupes identical rule content (by hash) across
 * packs and lane rule-dirs (e.g. social pulls in brand + copy + common).
 */

import fs from 'fs';
import type { LaneId } from '../marketplace/types';
import { rulesForLane, skillsForLane } from '../marketplace/registry';
import { voiceFileForContext } from '../clients/registry';
import { howToActFacts, formatBrandVoice, hasVoiceFact } from './how-to-act';
import type { SessionContext } from '../memory/sessions';

/**
 * Read the active client's brand voice (`voice.md`) for the selected context.
 * Returns '' when no client is selected or the file is absent — the voice is a
 * single-owner brand file layered on top of the pack's lane rules.
 */
function activeClientVoice(context?: SessionContext): string {
  if (!context) return '';
  const file = voiceFileForContext(context);
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf-8').trim();
  } catch {
    return '';
  }
}

/**
 * Compose the active client's "how to act" from `how_to_act` facts (voice, tone,
 * instincts) merged with the mirrored `voice.md` file. Facts are the live source
 * so an in-app edit changes behavior immediately; the file is layered in only
 * when no `voice`-subject fact exists (pre-mirror brands), so nothing is lost.
 */
function composeBrandVoice(context?: SessionContext): string {
  const facts = howToActFacts(context);
  const fromFacts = formatBrandVoice(facts);
  const fileVoice = hasVoiceFact(facts) ? '' : activeClientVoice(context);
  return [fromFacts, fileVoice].filter(Boolean).join('\n\n');
}

export function composeLaneRules(lane: LaneId, context?: SessionContext): string {
  const rules = rulesForLane(lane);
  const voice = composeBrandVoice(context);
  if (!rules.length && !voice) return '';

  const sections: string[] = [];
  if (rules.length) {
    const body = rules.map((r) => `### ${r.lane}/${r.filename}\n${r.content}`).join('\n\n');
    sections.push(
      `## Operator rules (${lane} lane)\nThese hold across every output in this lane.\n\n${body}`
    );
  }
  // The active brand's voice overrides generic lane rules for this client.
  if (voice) {
    sections.push(
      `## Brand voice (active client)\nThis brand's voice governs tone and word choice.\n\n${voice}`
    );
  }
  return sections.join('\n\n');
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
