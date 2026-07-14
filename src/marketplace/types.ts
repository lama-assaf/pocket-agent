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

// One entry from a pack's mcp-configs/mcp-servers.json catalog. These are templates —
// opt-in server definitions the pack authors curated, never auto-loaded by us.
export interface McpCatalogEntry {
  id: string;                 // object key, e.g. 'figma-remote'
  kind: 'stdio' | 'url';
  description?: string;       // from the entry's `_comment`, if present
  riskNote?: string;          // same `_comment`, surfaced separately when it reads as a risk/cost flag
  command?: string;           // stdio only
  args?: string[];            // stdio only
  env?: Record<string, string>; // stdio only — values are ${VAR} placeholders, never real secrets
  url?: string;                // url only
  headers?: Record<string, string>; // url only
  /**
   * One-shot command that clears this server's cached OAuth token(s) (stdio
   * only). Present only on catalog entries that delegate OAuth caching to an
   * external CLI (e.g. xurl) — its presence is what makes a server
   * "reauthenticable" in the Settings UI (src/marketplace/mcp-status.ts's
   * McpServerStatus.reauthenticable). `args` may contain the same `${VAR}`
   * placeholders as `env`/`args` above, substituted with the same stored env.
   */
  reauth?: { command: string; args: string[] };
}

export interface LoadedPack {
  id: string;
  agents: PackAgent[];
  skills: Skill[];
  commands: { name: string; description: string; filename: string; content: string }[];
  rules: RuleFile[];
  memoryTemplates: MemoryTemplate[];
  mcpCatalog: McpCatalogEntry[];
}
