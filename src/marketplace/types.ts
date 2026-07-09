export type LaneId = 'design' | 'product' | 'brand' | 'social';

export interface PackSource {
  id: string;          // 'atelier' | 'salon'
  name: string;
  lanes: LaneId[];
  repo: string;        // 'lama-assaf/atelier'
  branch: string;      // 'main'
}

export interface PackAgent {
  name: string;
  description: string;
  tools: string[];     // declared Claude-Code tool names (best-effort mapped later)
  model?: string;
  prompt: string;      // markdown body
  source: string;      // absolute file path
}

export interface RuleFile {
  lane: string;        // subdir under rules/ (design|product|brand|copy|common|social)
  filename: string;
  content: string;
  hash: string;        // sha256 of content, for de-dupe
}

export interface MemoryTemplate {
  relativePath: string; // e.g. 'instincts.md', 'campaigns/README.md'
  content: string;
}

// ggcoder Skill shape (mirror of @kenkaiiii/ggcoder core/skills)
export interface Skill {
  name: string;
  description: string;
  content: string;
  source: string;
}

export interface LoadedPack {
  id: string;
  agents: PackAgent[];
  skills: Skill[];
  commands: { name: string; description: string; filename: string; content: string }[];
  rules: RuleFile[];
  memoryTemplates: MemoryTemplate[];
}
