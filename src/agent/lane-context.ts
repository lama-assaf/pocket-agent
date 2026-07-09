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
