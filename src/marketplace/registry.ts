import type {
  LaneId,
  PackSource,
  LoadedPack,
  Skill,
  PackAgent,
  RuleFile,
  McpCatalogEntry,
} from './types';
import { readPack } from './loader';

export const PACK_SOURCES: PackSource[] = [
  {
    id: 'atelier',
    name: 'Atelier',
    lanes: ['design', 'product', 'brand'],
    repo: 'lama-assaf/atelier',
    branch: 'main',
  },
  { id: 'salon', name: 'Salon', lanes: ['social'], repo: 'lama-assaf/salon', branch: 'main' },
  // Private repo — syncs only when Settings → GitHub has a token with access
  // (PackSyncManager passes `github.token`); otherwise the bundled seed copy serves.
  {
    id: 'zilliqa-brand-identity',
    name: 'Zilliqa Brand',
    lanes: ['design'],
    repo: 'Zilliqa/zilliqa-brand-plugin',
    branch: 'main',
  },
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
  'zilliqa-brand-identity': { defaultLane: 'design', skills: {}, agents: {} },
  atelier: {
    defaultLane: 'product',
    skills: {
      'design-review': 'design',
      'design-system-audit': 'design',
      'accessibility-audit': 'design',
      'dark-mode-pairing': 'design',
      'component-spec': 'design',
      'data-viz-design': 'design',
      'iconography-system': 'design',
      'motion-direction': 'design',
      'figma-handoff-spec': 'design',
      'responsive-rules': 'design',
      'prd-writing': 'product',
      'spec-writing': 'product',
      'jtbd-framing': 'product',
      'roadmap-planning': 'product',
      'feature-scoping': 'product',
      'metric-design': 'product',
      'ab-test-design': 'product',
      'competitive-analysis': 'product',
      'launch-planning': 'product',
      'research-synthesis': 'product',
      'brand-voice-extraction': 'brand',
      'naming-generation': 'brand',
      'tagline-writing': 'brand',
      'positioning-statement': 'brand',
      'messaging-architecture': 'brand',
      'value-prop-writing': 'brand',
      'microcopy-writing': 'brand',
      'landing-copy': 'brand',
      'case-study-writing': 'brand',
      'release-narrative': 'brand',
      'brand-identity-audit': 'brand',
      'content-calendar': 'brand',
      'email-sequence': 'brand',
    },
    agents: {
      'design-reviewer': 'design',
      'accessibility-reviewer': 'design',
      'design-system-auditor': 'design',
      'product-strategist': 'product',
      'competitor-analyst': 'product',
      'ux-research-synthesizer': 'product',
      'taxonomy-architect': 'product',
      'narrative-architect': 'product',
      'brand-voice-keeper': 'brand',
      copywriter: 'brand',
      'microcopy-writer': 'brand',
      'naming-generator': 'brand',
      'case-study-writer': 'brand',
      'pitch-deck-writer': 'brand',
      'release-narrator': 'brand',
    },
  },
};

function laneMapFor(id: string): LaneMap {
  return (
    LANE_MAPS[id] ?? {
      defaultLane: PACK_SOURCES.find((p) => p.id === id)?.lanes[0] ?? 'product',
      skills: {},
      agents: {},
    }
  );
}

// Which rules subdirs feed each lane (common always included).
const LANE_RULE_DIRS: Record<LaneId, string[]> = {
  design: ['design', 'common'],
  product: ['product', 'common'],
  brand: ['brand', 'copy', 'common'],
  social: ['social', 'brand', 'copy', 'common'],
};

/** Resolve a skill's lane: its own frontmatter `lane:` first, then the hardcoded LANE_MAPS table, then the pack's default. */
function skillLane(s: Skill, lm: LaneMap): LaneId {
  return s.lane ?? lm.skills[s.name] ?? lm.defaultLane;
}

/** Resolve an agent's lane: its own frontmatter `lane:` first, then the hardcoded LANE_MAPS table, then the pack's default. */
function agentLane(a: PackAgent, lm: LaneMap): LaneId {
  return a.lane ?? lm.agents[a.name] ?? lm.defaultLane;
}

const loaded: Map<string, LoadedPack> = new Map();
function ensureLoaded(): void {
  if (loaded.size) return;
  for (const p of PACK_SOURCES) {
    const pack = readPack(p);
    loaded.set(p.id, pack);
    // Drift signal: a skill/agent with neither its own frontmatter `lane:` nor
    // an entry in the hand-maintained LANE_MAPS table silently defaulted to
    // the pack's defaultLane before this warning existed — exactly the
    // "new upstream skill, nobody updated the map" case this closes. Only
    // meaningful for a multi-lane pack (e.g. atelier): a single-lane pack
    // (e.g. salon) has no ambiguity to drift into — defaultLane is always
    // correct there by construction, so warning on it would just be noise.
    const lm = laneMapFor(p.id);
    if (p.lanes.length > 1) {
      for (const s of pack.skills) {
        if (!s.lane && !(s.name in lm.skills)) {
          console.warn(
            `[Marketplace] Skill "${s.name}" (pack ${p.id}) has no lane mapping (no frontmatter lane:, not in LANE_MAPS) — defaulting to "${lm.defaultLane}". Add "lane:" to its SKILL.md frontmatter or update LANE_MAPS in registry.ts.`
          );
        }
      }
      for (const a of pack.agents) {
        if (!a.lane && !(a.name in lm.agents)) {
          console.warn(
            `[Marketplace] Agent "${a.name}" (pack ${p.id}) has no lane mapping (no frontmatter lane:, not in LANE_MAPS) — defaulting to "${lm.defaultLane}". Add "lane:" to its frontmatter or update LANE_MAPS in registry.ts.`
          );
        }
      }
    }
  }
}

export function skillsForLane(lane: LaneId): Skill[] {
  ensureLoaded();
  const out: Skill[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!;
    const lm = laneMapFor(p.id);
    for (const s of lp.skills) if (skillLane(s, lm) === lane) out.push(s);
  }
  return out;
}

export function agentsForLane(lane: LaneId): PackAgent[] {
  ensureLoaded();
  const out: PackAgent[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!;
    const lm = laneMapFor(p.id);
    for (const a of lp.agents) if (agentLane(a, lm) === lane) out.push(a);
  }
  return out;
}

/**
 * Keyword→skill-ref index derived from each skill's own frontmatter
 * `keywords:` field. Merged (as an addition, not a replacement) with the
 * hardcoded KEYWORDS seed in lane-context.ts's buildLaneContextInjection, so
 * a newly-synced skill that declares its own keywords auto-registers its
 * triggers without a hand-maintained table edit; skills that declare none
 * simply aren't in this index and rely entirely on the hardcoded fallback.
 */
export function keywordIndexForLane(lane: LaneId): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const skill of skillsForLane(lane)) {
    if (!skill.keywords?.length) continue;
    const ref = `skill:${skill.name}`;
    for (const kw of skill.keywords) {
      const list = index[kw] ?? (index[kw] = []);
      if (!list.includes(ref)) list.push(ref);
    }
  }
  return index;
}

export interface GroupedAgent {
  packId: string;
  packName: string;
  lane: LaneId;
  agent: PackAgent;
}

/**
 * Every pack agent tagged with its source pack and resolved lane — the join
 * `agentsForLane` doesn't give you, since `PackAgent` itself carries neither.
 * Powers UI/IPC surfaces that need to group agents by pack then lane (browse,
 * detail lookup) without leaking `LANE_MAPS` internals.
 */
export function allAgentsGrouped(): GroupedAgent[] {
  ensureLoaded();
  const out: GroupedAgent[] = [];
  for (const p of PACK_SOURCES) {
    const lp = loaded.get(p.id)!;
    const lm = laneMapFor(p.id);
    for (const a of lp.agents) {
      out.push({
        packId: p.id,
        packName: p.name,
        lane: agentLane(a, lm),
        agent: a,
      });
    }
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

export function commandsForPacks(): {
  ns: string;
  name: string;
  description: string;
  content: string;
}[] {
  ensureLoaded();
  const out: { ns: string; name: string; description: string; content: string }[] = [];
  for (const p of PACK_SOURCES) {
    for (const c of loaded.get(p.id)!.commands) {
      out.push({
        ns: `${p.id}:${c.name}`,
        name: c.name,
        description: c.description,
        content: c.content,
      });
    }
  }
  return out;
}

/** MCP server catalog templates bundled by one pack (empty array if none/not found). */
export function mcpCatalogForPack(id: string): McpCatalogEntry[] {
  ensureLoaded();
  return loaded.get(id)?.mcpCatalog ?? [];
}

/** MCP server catalog templates from all packs, tagged with their source pack id. */
export function allMcpCatalogs(): { packId: string; entry: McpCatalogEntry }[] {
  ensureLoaded();
  const out: { packId: string; entry: McpCatalogEntry }[] = [];
  for (const p of PACK_SOURCES) {
    for (const entry of loaded.get(p.id)!.mcpCatalog) out.push({ packId: p.id, entry });
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
