import type { LaneId, PackSource, LoadedPack, Skill, PackAgent, RuleFile } from './types';
import { readPack } from './loader';

export const PACK_SOURCES: PackSource[] = [
  { id: 'atelier', name: 'Atelier', lanes: ['design', 'product', 'brand'], repo: 'lama-assaf/atelier', branch: 'main' },
  { id: 'salon', name: 'Salon', lanes: ['social'], repo: 'lama-assaf/salon', branch: 'main' },
];

interface LaneMap {
  defaultLane: LaneId;
  skills: Record<string, LaneId>;
  agents: Record<string, LaneId>;
}

// Our metadata about the packs (NOT pack content). Verified against seed dirs.
// Note: 'responsive-rules' is not in the original brief's map; it was added here
// after checking src/marketplace/seed/atelier/skills (design = how it looks).
const LANE_MAPS: Record<string, LaneMap> = {
  salon: { defaultLane: 'social', skills: {}, agents: {} },
  atelier: {
    defaultLane: 'product',
    skills: {
      'design-review': 'design', 'design-system-audit': 'design', 'accessibility-audit': 'design',
      'dark-mode-pairing': 'design', 'component-spec': 'design', 'data-viz-design': 'design',
      'iconography-system': 'design', 'motion-direction': 'design', 'figma-handoff-spec': 'design',
      'responsive-rules': 'design',
      'prd-writing': 'product', 'spec-writing': 'product', 'jtbd-framing': 'product',
      'roadmap-planning': 'product', 'feature-scoping': 'product', 'metric-design': 'product',
      'ab-test-design': 'product', 'competitive-analysis': 'product', 'launch-planning': 'product',
      'research-synthesis': 'product',
      'brand-voice-extraction': 'brand', 'naming-generation': 'brand', 'tagline-writing': 'brand',
      'positioning-statement': 'brand', 'messaging-architecture': 'brand', 'value-prop-writing': 'brand',
      'microcopy-writing': 'brand', 'landing-copy': 'brand', 'case-study-writing': 'brand',
      'release-narrative': 'brand', 'brand-identity-audit': 'brand', 'content-calendar': 'brand',
      'email-sequence': 'brand',
    },
    agents: {
      'design-reviewer': 'design', 'accessibility-reviewer': 'design', 'design-system-auditor': 'design',
      'product-strategist': 'product', 'competitor-analyst': 'product', 'ux-research-synthesizer': 'product',
      'taxonomy-architect': 'product', 'narrative-architect': 'product',
      'brand-voice-keeper': 'brand', 'copywriter': 'brand', 'microcopy-writer': 'brand',
      'naming-generator': 'brand', 'case-study-writer': 'brand', 'pitch-deck-writer': 'brand',
      'release-narrator': 'brand',
    },
  },
};

function laneMapFor(id: string): LaneMap {
  return LANE_MAPS[id] ?? { defaultLane: PACK_SOURCES.find((p) => p.id === id)?.lanes[0] ?? 'product', skills: {}, agents: {} };
}

// Which rules subdirs feed each lane (common always included).
const LANE_RULE_DIRS: Record<LaneId, string[]> = {
  design: ['design', 'common'],
  product: ['product', 'common'],
  brand: ['brand', 'copy', 'common'],
  social: ['social', 'brand', 'copy', 'common'],
};

const loaded: Map<string, LoadedPack> = new Map();
function ensureLoaded(): void {
  if (loaded.size) return;
  for (const p of PACK_SOURCES) loaded.set(p.id, readPack(p));
}

export function skillsForLane(lane: LaneId): Skill[] {
  ensureLoaded();
  const out: Skill[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!;
    const lm = laneMapFor(p.id);
    for (const s of lp.skills) if ((lm.skills[s.name] ?? lm.defaultLane) === lane) out.push(s);
  }
  return out;
}

export function agentsForLane(lane: LaneId): PackAgent[] {
  ensureLoaded();
  const out: PackAgent[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!;
    const lm = laneMapFor(p.id);
    for (const a of lp.agents) if ((lm.agents[a.name] ?? lm.defaultLane) === lane) out.push(a);
  }
  return out;
}

export function rulesForLane(lane: LaneId): RuleFile[] {
  ensureLoaded();
  const wanted = new Set(LANE_RULE_DIRS[lane]);
  const seen = new Set<string>();
  const out: RuleFile[] = [];
  for (const p of PACK_SOURCES) {
    for (const r of loaded.get(p.id)!.rules) {
      if (!wanted.has(r.lane)) continue;
      if (seen.has(r.hash)) continue; // de-dupe identical brand/copy rules
      seen.add(r.hash);
      out.push(r);
    }
  }
  return out;
}

export function commandsForPacks(): { ns: string; name: string; description: string; content: string }[] {
  ensureLoaded();
  const out: { ns: string; name: string; description: string; content: string }[] = [];
  for (const p of PACK_SOURCES) {
    for (const c of loaded.get(p.id)!.commands) {
      out.push({ ns: `${p.id}:${c.name}`, name: c.name, description: c.description, content: c.content });
    }
  }
  return out;
}

export function allBannedAndToneRules(): RuleFile[] {
  ensureLoaded();
  const seen = new Set<string>();
  const out: RuleFile[] = [];
  for (const p of PACK_SOURCES) {
    for (const r of loaded.get(p.id)!.rules) {
      if (/banned-words|anti-ai-tone/.test(r.filename) && !seen.has(r.hash)) {
        seen.add(r.hash);
        out.push(r);
      }
    }
  }
  return out;
}
