/**
 * Lane context — composes per-lane operator rules for injection into the
 * system prompt. Rules come from marketplace packs (Atelier/Salon) via the
 * registry, which already de-dupes identical rule content (by hash) across
 * packs and lane rule-dirs (e.g. social pulls in brand + copy + common).
 */

import type { LaneId } from '../marketplace/types';
import { rulesForLane } from '../marketplace/registry';

export function composeLaneRules(lane: LaneId): string {
  const rules = rulesForLane(lane);
  if (!rules.length) return '';
  const body = rules.map((r) => `### ${r.lane}/${r.filename}\n${r.content}`).join('\n\n');
  return `## Operator rules (${lane} lane)\nThese hold across every output in this lane.\n\n${body}`;
}
